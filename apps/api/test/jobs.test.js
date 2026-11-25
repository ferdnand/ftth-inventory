// The job as the unit of record: who may open one, what it can be opened
// against, and the three kinds of line it owns.
//
// The material tests are the ones that matter most. Those lines move real stock
// out of a real van, and the write is a replace rather than an append, so the
// interesting cases are all about the difference between two lists.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');

let world;
let unit;
let splicing;
let cableRun;
let sleeves;

beforeEach(async () => {
  await h.reset();
  world = await h.seedWorld();
  unit = await h.createInstance({
    itemId: world.ont.id,
    serial: 'JOB-1',
    locationId: world.van.id,
  });
  splicing = await h.createService({ name: 'Splicing', unitRate: 500 });
  cableRun = await h.createService({ name: 'Cable Run', unitOfMeasure: 'meter', unitRate: 15 });
  sleeves = await h.createItem({
    name: 'Sleeves',
    category: 'Consumable',
    trackingType: 'bulk',
    unitOfMeasure: 'unit',
    unitCost: 20,
  });
  await h.setStock({ itemId: world.cable.id, locationId: world.van.id, quantity: 500 });
  await h.setStock({ itemId: sleeves.id, locationId: world.van.id, quantity: 40 });
});

after(async () => {
  await h.stopServer();
  await h.close();
});

const openJob = (body, as = world.tech) => h.api.post('/api/work-orders', { as, body });
// Most of the material tests are about quantities, not about where the stock is,
// so they draw from the van explicitly. The default — the job's site — has its
// own tests further down.
const putMaterials = (id, materials, as = world.tech, fromLocationId = world.van.id) =>
  h.api.put(`/api/work-orders/${id}/materials`, {
    as,
    body: { materials, from_location_id: fromLocationId },
  });
const putExpenses = (id, expenses, as = world.tech) =>
  h.api.put(`/api/work-orders/${id}/expenses`, { as, body: { expenses } });
const putJobServices = (id, services, as = world.tech) =>
  h.api.put(`/api/work-orders/${id}/services`, { as, body: { services } });
const getJob = (id, as = world.tech) => h.api.get(`/api/work-orders/${id}`, { as });

const vanStock = (itemId) => h.getStock({ itemId, locationId: world.van.id });

// --- Opening a job --------------------------------------------------------

test('a field tech can open their own job, in progress and dated today', async () => {
  const res = await openJob({ customer_premises_id: world.premises.id, type: 'repair' });

  assert.equal(res.status, 201);
  const job = res.body.work_order;
  assert.equal(job.status, 'in_progress');
  assert.equal(Number(job.assigned_tech_id), world.tech.id);
  assert.equal(Number(job.created_by), world.tech.id);
  assert.equal(job.performed_on, new Date().toISOString().slice(0, 10));
});

// The manager is planning, not doing: their ticket is open until someone goes,
// and it has no performed_on until the work actually happens.
test('a manager-opened job starts open with no date of work', async () => {
  const res = await openJob(
    { customer_premises_id: world.premises.id, type: 'new_install' },
    world.staff
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.work_order.status, 'open');
  assert.equal(res.body.work_order.performed_on, null);
});

test('a tech cannot dispatch a job to another tech', async () => {
  const other = await h.createUser({
    name: 'Other Tech',
    email: 'other@test.local',
    role: 'field_tech',
  });

  const res = await openJob({
    customer_premises_id: world.premises.id,
    type: 'repair',
    assigned_tech_id: other.id,
  });

  // Not an error — silently their own, because a tech opening a job is
  // recording work they are doing.
  assert.equal(res.status, 201);
  assert.equal(Number(res.body.work_order.assigned_tech_id), world.tech.id);
});

// The whole point of the premises change: a tech at a compound nobody has
// recorded must not have to create it, lose signal, and come back to it.
test('a job can be opened at a premises captured in the same request', async () => {
  const res = await openJob({
    type: 'new_install',
    premises: {
      customer_name: 'Nekesa Wanyonyi',
      village: 'Nasianda',
      landmark: 'Third compound past the borehole',
      gps_lat: 0.5635,
      gps_lng: 34.5606,
      gps_accuracy_m: 8,
      site_id: await h.siteId('Bungoma'),
    },
  });

  assert.equal(res.status, 201);
  const job = res.body.work_order;
  assert.ok(job.customer_premises_id);
  assert.equal(job.premises.village, 'Nasianda');
  assert.equal(job.premises.gps_lat, 0.5635);
  assert.equal(job.site_name, 'Bungoma');
  // No address, so the label falls back to the landmark, qualified by village.
  assert.equal(job.label, 'Third compound past the borehole, Nasianda');
});

test('a job cannot name both an existing premises and a new one', async () => {
  const res = await openJob({
    type: 'repair',
    customer_premises_id: world.premises.id,
    premises: { landmark: 'Somewhere else' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not both/);
});

test('a repair with no premises at all is rejected', async () => {
  const res = await openJob({ type: 'repair' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /needs a premises/);
});

// If the premises is unusable the job must not exist either: both writes share
// one transaction.
test('an unfindable premises rolls back the job with it', async () => {
  const before = await h.db.query('SELECT count(*)::int AS n FROM work_orders');
  const res = await openJob({ type: 'repair', premises: { customer_name: 'No idea where' } });

  assert.equal(res.status, 400);
  const after = await h.db.query('SELECT count(*)::int AS n FROM work_orders');
  assert.equal(after.rows[0].n, before.rows[0].n);
});

// --- Seeing jobs ----------------------------------------------------------

test("a tech sees only their own jobs, and open=true covers both live statuses", async () => {
  const mine = await openJob({ customer_premises_id: world.premises.id, type: 'repair' });
  const dispatched = await openJob(
    {
      customer_premises_id: world.premises.id,
      type: 'new_install',
      assigned_tech_id: world.tech.id,
    },
    world.staff
  );
  const other = await h.createUser({
    name: 'Other Tech',
    email: 'other2@test.local',
    role: 'field_tech',
  });
  await openJob({ customer_premises_id: world.premises.id, type: 'repair' }, other);

  const res = await h.api.get('/api/work-orders?open=true', { as: world.tech });
  assert.equal(res.status, 200);
  const ids = res.body.work_orders.map((job) => job.id).sort();
  assert.deepEqual(ids, [mine.body.work_order.id, dispatched.body.work_order.id].sort());
});

test("another tech's job is not readable", async () => {
  const other = await h.createUser({
    name: 'Other Tech',
    email: 'other3@test.local',
    role: 'field_tech',
  });
  const theirs = await openJob({ customer_premises_id: world.premises.id, type: 'repair' }, other);

  const res = await getJob(theirs.body.work_order.id, world.tech);
  assert.equal(res.status, 403);
});

// --- Materials ------------------------------------------------------------

test('recording materials draws them out of the van and leaves an audit row', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  const res = await putMaterials(job.id, [
    { item_id: world.cable.id, quantity: 120 },
    { item_id: sleeves.id, quantity: 6 },
  ]);

  assert.equal(res.status, 200);
  assert.equal(await vanStock(world.cable.id), 380);
  assert.equal(await vanStock(sleeves.id), 34);

  const moves = await h.api.get(`/api/transactions?work_order_id=${job.id}`, { as: world.staff });
  assert.equal(moves.body.transactions.length, 2);
  assert.ok(moves.body.transactions.every((t) => t.type === 'install'));
});

// The list is complete, not additive, so a retry is a no-op. This is what
// replaces an idempotency key on a connection that drops mid-save.
test('re-sending the same material list moves no further stock', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;
  const lines = [{ item_id: world.cable.id, quantity: 120 }];

  await putMaterials(job.id, lines);
  await putMaterials(job.id, lines);
  await putMaterials(job.id, lines);

  assert.equal(await vanStock(world.cable.id), 380);
  const detail = await getJob(job.id);
  assert.equal(detail.body.work_order.materials.length, 1);
});

test('correcting a line down puts the difference back in the van', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  await putMaterials(job.id, [{ item_id: world.cable.id, quantity: 120 }]);
  await putMaterials(job.id, [{ item_id: world.cable.id, quantity: 45 }]);

  assert.equal(await vanStock(world.cable.id), 455);

  const returns = await h.api.get(`/api/transactions?work_order_id=${job.id}&type=return`, {
    as: world.staff,
  });
  assert.equal(returns.body.transactions.length, 1);
  assert.equal(Number(returns.body.transactions[0].quantity), 75);
});

test('dropping a line altogether returns all of it', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  await putMaterials(job.id, [
    { item_id: world.cable.id, quantity: 120 },
    { item_id: sleeves.id, quantity: 6 },
  ]);
  await putMaterials(job.id, [{ item_id: world.cable.id, quantity: 120 }]);

  assert.equal(await vanStock(sleeves.id), 40);
  assert.equal(await vanStock(world.cable.id), 380);
});

test('a job cannot use more than the van is carrying', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  const res = await putMaterials(job.id, [{ item_id: world.cable.id, quantity: 900 }]);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Not enough stock/);
  assert.equal(await vanStock(world.cable.id), 500);
});

// A router is traced to the premises through installations. Counting it here as
// well would double it in every cost total.
test('a serialized item is refused as a material', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  const res = await putMaterials(job.id, [{ item_id: world.ont.id, quantity: 1 }]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /serialized/);
});

test('the same item twice in one list is rejected with an explanation', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  const res = await putMaterials(job.id, [
    { item_id: world.cable.id, quantity: 40 },
    { item_id: world.cable.id, quantity: 40 },
  ]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /twice/);
});

test('a tech cannot record materials out of a van that is not theirs', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;
  const otherVan = await h.createLocation({ name: 'Van 2', type: 'tech_van' });

  const res = await h.api.put(`/api/work-orders/${job.id}/materials`, {
    as: world.tech,
    body: {
      from_location_id: otherVan.id,
      materials: [{ item_id: world.cable.id, quantity: 10 }],
    },
  });
  assert.equal(res.status, 403);
});

// --- Expenses -------------------------------------------------------------

test('expenses are recorded, and two of one category are two facts', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  const res = await putExpenses(job.id, [
    { category: 'transport', amount: 300, description: 'Boda out' },
    { category: 'transport', amount: 300, description: 'Boda back' },
    { category: 'casual_labour', amount: 500, description: 'Help digging' },
  ]);

  assert.equal(res.status, 200);
  assert.equal(res.body.expenses.length, 3);
  assert.equal(res.body.costs.expenses_total, 1100);
});

test('an unknown expense category is rejected', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  const res = await putExpenses(job.id, [{ category: 'lunch', amount: 200 }]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /must be one of/);
});

// --- Labour with no hardware ---------------------------------------------

// The case 009 could not express: a tech drives out, re-splices a cut cable,
// fits nothing, and has done a day's billable work.
test('a job that installs nothing can still record labour and cost', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'repair' })).body
    .work_order;

  const res = await putJobServices(job.id, [
    { service_id: splicing.id },
    { service_id: cableRun.id, quantity: 30 },
  ]);

  assert.equal(res.status, 200);
  // Rates come off the catalog: 500 for the splice, 30 m at 15.
  assert.equal(res.body.costs.labour_total, 950);
  assert.equal(res.body.costs.hardware_total, 0);
});

// --- Costs ----------------------------------------------------------------

test('the job total is materials plus labour plus expenses plus hardware', async () => {
  await h.db.query('UPDATE items SET unit_cost = 3500 WHERE id = $1', [world.ont.id]);
  await h.db.query('UPDATE items SET unit_cost = 25 WHERE id = $1', [world.cable.id]);

  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  await h.api.post('/api/installations', {
    as: world.tech,
    body: {
      customer_premises_id: world.premises.id,
      item_instance_id: unit.id,
      work_order_id: job.id,
    },
  });
  await putMaterials(job.id, [
    { item_id: world.cable.id, quantity: 40 },
    { item_id: sleeves.id, quantity: 4 },
  ]);
  await putJobServices(job.id, [{ service_id: splicing.id }]);
  await putExpenses(job.id, [{ category: 'transport', amount: 300 }]);

  const detail = await getJob(job.id);
  const costs = detail.body.work_order.costs;

  assert.equal(costs.currency, 'KES');
  assert.equal(costs.materials_total, 1080); // 40 x 25 + 4 x 20
  assert.equal(costs.labour_total, 500);
  assert.equal(costs.expenses_total, 300);
  assert.equal(costs.hardware_total, 3500);
  assert.equal(costs.total, 5380);
  assert.equal(costs.unpriced_lines, 0);
});

// A total sitting next to unpriced lines is a floor, not a cost. Saying so is
// the difference between a useful number and a misleading one.
test('unpriced lines are counted rather than silently treated as free', async () => {
  const unpriced = await h.createItem({
    name: 'Tie Wraps',
    category: 'Consumable',
    trackingType: 'bulk',
    unitOfMeasure: 'unit',
  });
  await h.setStock({ itemId: unpriced.id, locationId: world.van.id, quantity: 100 });

  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;
  await putMaterials(job.id, [
    { item_id: sleeves.id, quantity: 2 },
    { item_id: unpriced.id, quantity: 10 },
  ]);

  const detail = await getJob(job.id);
  assert.equal(detail.body.work_order.costs.materials_total, 40);
  assert.equal(detail.body.work_order.costs.unpriced_lines, 1);

  const line = detail.body.work_order.materials.find((m) => m.item_id === unpriced.id);
  assert.equal(line.unit_cost, null);
  assert.equal(line.line_total, null);
});

// A cost given on the line beats the catalog, and is what the job keeps: the
// price the tech actually paid for something is the fact, not the list price.
test('a cost sent on the line overrides the catalog and is kept', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  await putMaterials(job.id, [{ item_id: sleeves.id, quantity: 3, unit_cost: 35 }]);
  await h.db.query('UPDATE items SET unit_cost = 999 WHERE id = $1', [sleeves.id]);

  const detail = await getJob(job.id);
  assert.equal(detail.body.work_order.materials[0].unit_cost, 35);
  assert.equal(detail.body.work_order.costs.materials_total, 105);
});

// --- Completing and cancelling -------------------------------------------

test('completing a job stamps the day it was done', async () => {
  const job = (
    await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }, world.staff)
  ).body.work_order;
  assert.equal(job.performed_on, null);

  const res = await h.api.patch(`/api/work-orders/${job.id}`, {
    as: world.staff,
    body: { status: 'completed' },
  });

  assert.equal(res.status, 200);
  assert.ok(res.body.work_order.completed_at);
  assert.equal(res.body.work_order.performed_on, new Date().toISOString().slice(0, 10));
});

test('a tech can say which day they did the work but not reschedule it', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'repair' })).body
    .work_order;

  const ok = await h.api.patch(`/api/work-orders/${job.id}`, {
    as: world.tech,
    body: { performed_on: '2026-09-01', notes: 'Done Monday, sent Wednesday' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.work_order.performed_on, '2026-09-01');

  const refused = await h.api.patch(`/api/work-orders/${job.id}`, {
    as: world.tech,
    body: { scheduled_date: '2026-09-20' },
  });
  assert.equal(refused.status, 403);
});

test('a cancelled job will not take any more lines', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'repair' })).body
    .work_order;
  await h.api.patch(`/api/work-orders/${job.id}`, {
    as: world.staff,
    body: { status: 'cancelled' },
  });

  const materials = await putMaterials(job.id, [{ item_id: world.cable.id, quantity: 10 }]);
  assert.equal(materials.status, 409);
  const expenses = await putExpenses(job.id, [{ category: 'transport', amount: 100 }]);
  assert.equal(expenses.status, 409);
  assert.equal(await vanStock(world.cable.id), 500);
});

// A cost remembered on the drive home has to have somewhere to go, so a
// completed job stays editable. Only cancellation freezes the lines.
test('a completed job still accepts a cost recorded afterwards', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'repair' })).body
    .work_order;
  await h.api.patch(`/api/work-orders/${job.id}`, {
    as: world.tech,
    body: { status: 'completed' },
  });

  const res = await putExpenses(job.id, [{ category: 'transport', amount: 250 }]);
  assert.equal(res.status, 200);
  assert.equal(res.body.costs.expenses_total, 250);
});

// --- Installations and their jobs ----------------------------------------

test('an install that names no job opens one for itself', async () => {
  const res = await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: unit.id },
  });

  assert.equal(res.status, 201);
  const jobId = res.body.installation.work_order_id;
  assert.ok(jobId);

  const job = await getJob(jobId);
  assert.equal(job.body.work_order.type, 'new_install');
  assert.equal(job.body.work_order.status, 'in_progress');
  assert.equal(Number(job.body.work_order.assigned_tech_id), world.tech.id);
});

test('an install cannot be attached to a job at a different premises', async () => {
  const elsewhere = await h.createPremises('2 Other Road');
  const job = (await openJob({ customer_premises_id: elsewhere.id, type: 'new_install' })).body
    .work_order;

  const res = await h.api.post('/api/installations', {
    as: world.tech,
    body: {
      customer_premises_id: world.premises.id,
      item_instance_id: unit.id,
      work_order_id: job.id,
    },
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /different premises/);
});

// The trigger behind the check above, in case a path ever forgets it.
test('the database refuses an installation whose job is at another premises', async () => {
  const elsewhere = await h.createPremises('3 Other Road');
  const job = await h.createJob({ premisesId: elsewhere.id, techId: world.tech.id });

  await assert.rejects(
    () =>
      h.db.query(
        `INSERT INTO installations
           (customer_premises_id, item_instance_id, installed_by, work_order_id)
         VALUES ($1, $2, $3, $4)`,
        [world.premises.id, unit.id, world.tech.id, job.id]
      ),
    (err) => err.constraint === 'installation_job_same_premises'
  );
});

// --- Cost reporting -------------------------------------------------------

test('the job-cost report splits spend by site and flags what is unpriced', async () => {
  const bungoma = await h.siteId('Bungoma');
  const premises = await h.createPremises({ landmark: 'By the mill', site_id: bungoma });

  const job = (await openJob({ customer_premises_id: premises.id, type: 'new_install' })).body
    .work_order;
  await putMaterials(job.id, [{ item_id: sleeves.id, quantity: 5 }]);
  await putExpenses(job.id, [{ category: 'transport', amount: 400 }]);
  await putJobServices(job.id, [{ service_id: splicing.id }]);

  const res = await h.api.get('/api/reports/job-costs?group_by=site', { as: world.staff });
  assert.equal(res.status, 200);

  const row = res.body.job_costs.find((r) => r.label === 'Bungoma');
  assert.equal(row.jobs, 1);
  assert.equal(row.materials_total, 100);
  assert.equal(row.expenses_total, 400);
  assert.equal(row.labour_total, 500);
  assert.equal(row.total, 1000);
  assert.equal(row.average_per_job, 1000);
  assert.equal(res.body.currency, 'KES');
});

test('a field tech cannot read the job-cost report', async () => {
  const res = await h.api.get('/api/reports/job-costs', { as: world.tech });
  assert.equal(res.status, 403);
});

// --- Sites ----------------------------------------------------------------

test('a job takes the site its premises is filed under', async () => {
  const res = await openJob({ customer_premises_id: world.premises.id, type: 'repair' });

  assert.equal(res.status, 201);
  assert.equal(res.body.work_order.site_name, 'Bungoma');
  assert.equal(res.body.work_order.site_id, await h.siteId('Bungoma'));
});

test('a job at a premises with no site is refused until a site is named', async () => {
  const unsited = await h.createPremises({ landmark: 'By the old mill', site_id: null });

  const without = await openJob({ customer_premises_id: unsited.id, type: 'repair' });
  assert.equal(without.status, 400);
  assert.match(without.body.error, /site_id is required/);

  const kisumu = await h.siteId('Kisumu');
  const withSite = await openJob({
    customer_premises_id: unsited.id,
    site_id: kisumu,
    type: 'repair',
  });
  assert.equal(withSite.status, 201);
  assert.equal(withSite.body.work_order.site_name, 'Kisumu');

  // The premises is filed under the job's site, so a site's list finds it.
  const filed = await h.api.get(`/api/premises/${unsited.id}`, { as: world.tech });
  assert.equal(filed.body.premises.site_id, kisumu);
});

test('a job cannot be at a different site from its premises', async () => {
  const kisumu = await h.siteId('Kisumu');
  const res = await openJob({
    customer_premises_id: world.premises.id, // Bungoma
    site_id: kisumu,
    type: 'repair',
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /Bungoma/);
});

test('a new premises is filed under the site the job is opened at', async () => {
  const kisumu = await h.siteId('Kisumu');
  const res = await openJob({
    type: 'new_install',
    site_id: kisumu,
    premises: { landmark: 'Opposite the dispensary', village: 'Kadibo' },
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.work_order.site_id, kisumu);
  assert.equal(res.body.work_order.premises.site_id, kisumu);
});

test('a new premises with no site anywhere is refused', async () => {
  const res = await openJob({
    type: 'new_install',
    premises: { landmark: 'Opposite the dispensary' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /site_id is required/);
});

test('jobs can be listed for one site', async () => {
  const kisumu = await h.siteId('Kisumu');
  const kisumuHouse = await h.createPremises({ landmark: 'By the lake', site_id: kisumu });
  await openJob({ customer_premises_id: world.premises.id, type: 'repair' });
  await openJob({ customer_premises_id: kisumuHouse.id, type: 'repair' });

  const res = await h.api.get(`/api/work-orders?site_id=${kisumu}`, { as: world.staff });
  assert.equal(res.status, 200);
  assert.equal(res.body.work_orders.length, 1);
  assert.equal(res.body.work_orders[0].site_name, 'Kisumu');
});

test('re-filing a premises under another site moves its jobs with it', async () => {
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'repair' })).body
    .work_order;
  const kisumu = await h.siteId('Kisumu');

  const moved = await h.api.patch(`/api/premises/${world.premises.id}`, {
    as: world.staff,
    body: { site_id: kisumu },
  });
  assert.equal(moved.status, 200);

  const after = await getJob(job.id, world.staff);
  assert.equal(after.body.work_order.site_id, kisumu);
});

// --- Materials come out of the job's site ---------------------------------

test('materials default to the stock at the job’s site', async () => {
  const bungoma = await h.siteId('Bungoma');
  await h.setStock({ itemId: world.cable.id, locationId: bungoma, quantity: 300 });
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  // No from_location_id: the job's site is the source.
  const res = await h.api.put(`/api/work-orders/${job.id}/materials`, {
    as: world.tech,
    body: { materials: [{ item_id: world.cable.id, quantity: 40 }] },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.materials[0].from_location_id, bungoma);
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: bungoma }), 260);
  assert.equal(await vanStock(world.cable.id), 500); // the van is untouched
});

test('a job cannot use more than its site holds', async () => {
  const bungoma = await h.siteId('Bungoma');
  await h.setStock({ itemId: world.cable.id, locationId: bungoma, quantity: 30 });
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;

  const res = await h.api.put(`/api/work-orders/${job.id}/materials`, {
    as: world.tech,
    body: { materials: [{ item_id: world.cable.id, quantity: 40 }] },
  });

  assert.equal(res.status, 409);
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: bungoma }), 30);
});

test('a tech cannot record materials out of a different site', async () => {
  const kisumu = await h.siteId('Kisumu');
  await h.setStock({ itemId: world.cable.id, locationId: kisumu, quantity: 300 });
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order; // a Bungoma job

  const res = await h.api.put(`/api/work-orders/${job.id}/materials`, {
    as: world.tech,
    body: { from_location_id: kisumu, materials: [{ item_id: world.cable.id, quantity: 10 }] },
  });
  assert.equal(res.status, 403);
});

test('a correction puts material back at the site it came from', async () => {
  const bungoma = await h.siteId('Bungoma');
  await h.setStock({ itemId: world.cable.id, locationId: bungoma, quantity: 300 });
  const job = (await openJob({ customer_premises_id: world.premises.id, type: 'new_install' }))
    .body.work_order;
  const siteLines = (quantity) =>
    h.api.put(`/api/work-orders/${job.id}/materials`, {
      as: world.tech,
      body: { materials: [{ item_id: world.cable.id, quantity }] },
    });

  await siteLines(100);
  const fixed = await siteLines(60);

  assert.equal(fixed.status, 200);
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: bungoma }), 240);
});

test('a tech can read the stock at a site, but not at another tech’s van', async () => {
  const bungoma = await h.siteId('Bungoma');
  await h.setStock({ itemId: world.cable.id, locationId: bungoma, quantity: 300 });
  const otherVan = await h.createLocation({ name: 'Van 2', type: 'tech_van' });

  const site = await h.api.get(`/api/stock?location_id=${bungoma}`, { as: world.tech });
  assert.equal(site.status, 200);
  assert.equal(Number(site.body.bulk[0].quantity), 300);

  const van = await h.api.get(`/api/stock?location_id=${otherVan.id}`, { as: world.tech });
  assert.equal(van.status, 403);
});

// --- A new install can be dispatched before the premises is known ---------

test('a new install can be dispatched with a site and a rough location, but no premises', async () => {
  const bungoma = await h.siteId('Bungoma');
  const res = await openJob(
    {
      type: 'new_install',
      site_id: bungoma,
      notes: 'Somewhere past Nasianda market, ask for Mama Pima',
    },
    world.staff
  );

  assert.equal(res.status, 201);
  const job = res.body.work_order;
  assert.equal(job.customer_premises_id, null);
  assert.equal(job.site_name, 'Bungoma');
  assert.equal(job.label, 'Location to be confirmed');
  assert.equal(job.notes, 'Somewhere past Nasianda market, ask for Mama Pima');

  // It still lists and opens like any other job.
  const list = await h.api.get('/api/work-orders', { as: world.staff });
  assert.equal(list.body.work_orders.length, 1);
  const detail = await getJob(job.id, world.staff);
  assert.equal(detail.status, 200);
});

test('with no premises, the notes have to say roughly where it is', async () => {
  const bungoma = await h.siteId('Bungoma');
  const res = await openJob({ type: 'new_install', site_id: bungoma }, world.staff);

  assert.equal(res.status, 400);
  assert.match(res.body.error, /roughly where/);
});

test('with no premises, the site is still required', async () => {
  const res = await openJob({ type: 'new_install', notes: 'Near the market' }, world.staff);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /site_id is required/);
});

test('a repair, upgrade or removal needs a premises', async () => {
  const bungoma = await h.siteId('Bungoma');
  for (const type of ['repair', 'upgrade', 'removal']) {
    const res = await openJob({ type, site_id: bungoma, notes: 'Near the market' }, world.staff);
    assert.equal(res.status, 400, type);
    assert.match(res.body.error, /needs a premises/);
  }
});

test('the database refuses a premises-less job that is not a new install', async () => {
  const bungoma = await h.siteId('Bungoma');
  await assert.rejects(
    () =>
      h.db.query(
        `INSERT INTO work_orders (site_id, type, status, notes)
         VALUES ($1, 'repair', 'open', 'Near the market')`,
        [bungoma]
      ),
    (err) => err.constraint === 'job_premises_required_unless_new_install'
  );
});

test('the premises can be attached afterwards, once, at the job’s site', async () => {
  const bungoma = await h.siteId('Bungoma');
  const job = (
    await openJob(
      { type: 'new_install', site_id: bungoma, notes: 'Past Nasianda market' },
      world.staff
    )
  ).body.work_order;

  const attached = await h.api.patch(`/api/work-orders/${job.id}`, {
    as: world.staff,
    body: { customer_premises_id: world.premises.id },
  });
  assert.equal(attached.status, 200);
  assert.equal(attached.body.work_order.customer_premises_id, world.premises.id);
  assert.equal(attached.body.work_order.site_id, bungoma);

  const again = await h.api.patch(`/api/work-orders/${job.id}`, {
    as: world.staff,
    body: { customer_premises_id: world.premises.id },
  });
  assert.equal(again.status, 409);
});

test('a premises at another site cannot be attached', async () => {
  const bungoma = await h.siteId('Bungoma');
  const kisumuHouse = await h.createPremises({
    landmark: 'By the lake',
    site_id: await h.siteId('Kisumu'),
  });
  const job = (
    await openJob({ type: 'new_install', site_id: bungoma, notes: 'Near the market' }, world.staff)
  ).body.work_order;

  const res = await h.api.patch(`/api/work-orders/${job.id}`, {
    as: world.staff,
    body: { customer_premises_id: kisumuHouse.id },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Kisumu/);
});

test('a tech can capture the premises on the spot and attach it to a dispatched job', async () => {
  const bungoma = await h.siteId('Bungoma');
  const job = (
    await openJob(
      {
        type: 'new_install',
        site_id: bungoma,
        notes: 'Past Nasianda market',
        assigned_tech_id: world.tech.id,
      },
      world.staff
    )
  ).body.work_order;

  const res = await h.api.patch(`/api/work-orders/${job.id}`, {
    as: world.tech,
    body: { premises: { landmark: 'Third compound past the borehole', village: 'Nasianda' } },
  });

  assert.equal(res.status, 200);
  const done = res.body.work_order;
  assert.ok(done.customer_premises_id);
  assert.equal(done.premises.village, 'Nasianda');
  assert.equal(done.premises.site_id, bungoma);
});

test('installing a router against a premises-less job attaches the premises', async () => {
  const bungoma = await h.siteId('Bungoma');
  const job = (
    await openJob(
      {
        type: 'new_install',
        site_id: bungoma,
        notes: 'Past Nasianda market',
        assigned_tech_id: world.tech.id,
      },
      world.staff
    )
  ).body.work_order;

  const res = await h.api.post('/api/installations', {
    as: world.tech,
    body: {
      customer_premises_id: world.premises.id,
      item_instance_id: unit.id,
      work_order_id: job.id,
    },
  });
  assert.equal(res.status, 201);

  const after = await getJob(job.id, world.staff);
  assert.equal(after.body.work_order.customer_premises_id, world.premises.id);
  assert.equal(after.body.work_order.installations.length, 1);
});

test('premises-less jobs still count in the job-cost report', async () => {
  const bungoma = await h.siteId('Bungoma');
  const job = (
    await openJob({ type: 'new_install', site_id: bungoma, notes: 'Near the market' }, world.staff)
  ).body.work_order;
  await putExpenses(job.id, [{ category: 'transport', amount: 300 }], world.staff);

  const res = await h.api.get('/api/reports/job-costs?group_by=site', { as: world.staff });
  assert.equal(res.status, 200);
  const row = res.body.job_costs.find((r) => r.label === 'Bungoma');
  assert.equal(row.expenses_total, 300);
});
