// Restock requests, reports, and the migration runner's immutability check.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const h = require('./helpers');
const { up, readMigrations } = require('../db/migrate');

let world;

beforeEach(async () => {
  await h.reset();
  world = await h.seedWorld();
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 1000 });
});

after(async () => {
  await h.stopServer();
  await h.close();
});

// --- Restock requests -----------------------------------------------------

const createRequest = (body, as = world.tech) =>
  h.api.post('/api/restock-requests', { as, body });

test('a tech requests stock into their own van', async () => {
  const res = await createRequest({
    from_location_id: world.warehouse.id,
    lines: [{ item_id: world.cable.id, quantity_requested: 200 }],
    notes: 'Running low',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.restock_request.status, 'requested');
  assert.equal(res.body.restock_request.requesting_user_id, world.tech.id);
  assert.equal(res.body.restock_request.to_location_id, world.van.id);
  assert.equal(res.body.restock_request.lines.length, 1);
  assert.equal(Number(res.body.restock_request.lines[0].quantity_requested), 200);
});

// The whole reason this feature exists: without it, the only write available to
// a tech would be a warehouse -> van transfer, i.e. self-issuing.
test('warehouse staff cannot raise a restock request; only techs can', async () => {
  const res = await createRequest(
    {
      from_location_id: world.warehouse.id,
      lines: [{ item_id: world.cable.id, quantity_requested: 10 }],
    },
    world.staff
  );
  assert.equal(res.status, 403);
});

test('a request must draw from a warehouse, not another van', async () => {
  const res = await createRequest({
    from_location_id: world.van.id,
    lines: [{ item_id: world.cable.id, quantity_requested: 10 }],
  });
  assert.equal(res.status, 400);
});

test('a request needs at least one line, with a positive quantity', async () => {
  assert.equal(
    (await createRequest({ from_location_id: world.warehouse.id, lines: [] })).status,
    400
  );
  assert.equal(
    (
      await createRequest({
        from_location_id: world.warehouse.id,
        lines: [{ item_id: world.cable.id, quantity_requested: 0 }],
      })
    ).status,
    400
  );
});

test('the same item cannot appear twice in one request', async () => {
  const res = await createRequest({
    from_location_id: world.warehouse.id,
    lines: [
      { item_id: world.cable.id, quantity_requested: 10 },
      { item_id: world.cable.id, quantity_requested: 20 },
    ],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /more than once/);
});

test('fulfilling a request moves the stock and writes the transfer', async () => {
  const created = await createRequest({
    from_location_id: world.warehouse.id,
    lines: [{ item_id: world.cable.id, quantity_requested: 200 }],
  });
  const id = created.body.restock_request.id;

  const res = await h.api.patch(`/api/restock-requests/${id}`, {
    as: world.staff,
    body: { status: 'fulfilled' },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.restock_request.status, 'fulfilled');
  assert.equal(res.body.restock_request.resolved_by, world.staff.id);
  assert.ok(res.body.restock_request.resolved_at);

  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.warehouse.id }), 800);
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.van.id }), 200);

  const txn = await h.db.query(
    "SELECT * FROM transactions WHERE type = 'transfer' AND item_id = $1",
    [world.cable.id]
  );
  assert.equal(txn.rows.length, 1);
  assert.equal(Number(txn.rows[0].quantity), 200);
  assert.equal(txn.rows[0].from_location_id, world.warehouse.id);
  assert.equal(txn.rows[0].to_location_id, world.van.id);
  assert.equal(txn.rows[0].performed_by, world.staff.id);
});

test('a partial fulfilment moves only what was actually available', async () => {
  const created = await createRequest({
    from_location_id: world.warehouse.id,
    lines: [{ item_id: world.cable.id, quantity_requested: 200 }],
  });
  const id = created.body.restock_request.id;

  const res = await h.api.patch(`/api/restock-requests/${id}`, {
    as: world.staff,
    body: {
      status: 'fulfilled',
      fulfilments: [{ item_id: world.cable.id, quantity_fulfilled: 120 }],
    },
  });

  assert.equal(res.status, 200);
  assert.equal(Number(res.body.restock_request.lines[0].quantity_fulfilled), 120);
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.van.id }), 120);
});

test('fulfilment fails as a whole if the warehouse cannot cover it', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 50 });
  const created = await createRequest({
    from_location_id: world.warehouse.id,
    lines: [{ item_id: world.cable.id, quantity_requested: 200 }],
  });
  const id = created.body.restock_request.id;

  const res = await h.api.patch(`/api/restock-requests/${id}`, {
    as: world.staff,
    body: { status: 'fulfilled' },
  });

  assert.equal(res.status, 409);
  // Nothing moved, and the request is still open for a partial fulfilment.
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.warehouse.id }), 50);
  const request = await h.db.query('SELECT status FROM restock_requests WHERE id = $1', [id]);
  assert.equal(request.rows[0].status, 'requested');
});

test('a fulfilled request cannot change status again', async () => {
  const created = await createRequest({
    from_location_id: world.warehouse.id,
    lines: [{ item_id: world.cable.id, quantity_requested: 10 }],
  });
  const id = created.body.restock_request.id;

  await h.api.patch(`/api/restock-requests/${id}`, {
    as: world.staff,
    body: { status: 'fulfilled' },
  });
  const again = await h.api.patch(`/api/restock-requests/${id}`, {
    as: world.staff,
    body: { status: 'rejected' },
  });

  assert.equal(again.status, 400);
  assert.match(again.body.error, /cannot change status/);
});

test('a serialized item cannot be fulfilled by quantity', async () => {
  const created = await createRequest({
    from_location_id: world.warehouse.id,
    lines: [{ item_id: world.ont.id, quantity_requested: 3 }],
  });
  const id = created.body.restock_request.id;

  const res = await h.api.patch(`/api/restock-requests/${id}`, {
    as: world.staff,
    body: { status: 'fulfilled' },
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /serialized/);
});

test('a tech only sees their own requests', async () => {
  const otherTech = await h.createUser({
    name: 'Other Tech',
    email: 'other@test.local',
    role: 'field_tech',
  });
  const otherVan = await h.createLocation({
    name: 'Van 2',
    type: 'tech_van',
    techId: otherTech.id,
  });
  await h.db.query('UPDATE users SET assigned_location_id = $1 WHERE id = $2', [
    otherVan.id,
    otherTech.id,
  ]);
  otherTech.assigned_location_id = otherVan.id;

  await createRequest({
    from_location_id: world.warehouse.id,
    lines: [{ item_id: world.cable.id, quantity_requested: 10 }],
  });
  await createRequest(
    {
      from_location_id: world.warehouse.id,
      lines: [{ item_id: world.cable.id, quantity_requested: 20 }],
    },
    otherTech
  );

  const mine = await h.api.get('/api/restock-requests', { as: world.tech });
  assert.equal(mine.body.restock_requests.length, 1);
  assert.equal(mine.body.restock_requests[0].requesting_user_id, world.tech.id);

  const all = await h.api.get('/api/restock-requests', { as: world.staff });
  assert.equal(all.body.restock_requests.length, 2);
});

// --- Item instances -------------------------------------------------------

test('serialized stock can be received in a batch', async () => {
  const res = await h.api.post('/api/item-instances', {
    as: world.staff,
    body: {
      item_id: world.ont.id,
      location_id: world.warehouse.id,
      units: [
        { serial_number: 'BATCH-1', mac_address: '11:11:11:11:11:11' },
        { serial_number: 'BATCH-2' },
      ],
    },
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.created, 2);

  // One audit row per unit, so each serial's history starts where it entered.
  const txns = await h.db.query(
    "SELECT * FROM transactions WHERE type = 'receive' AND item_id = $1",
    [world.ont.id]
  );
  assert.equal(txns.rows.length, 2);
  assert.equal(txns.rows[0].to_location_id, world.warehouse.id);
});

test('a duplicate serial rejects the whole batch', async () => {
  await h.createInstance({
    itemId: world.ont.id,
    serial: 'DUP-1',
    locationId: world.warehouse.id,
  });

  const res = await h.api.post('/api/item-instances', {
    as: world.staff,
    body: {
      item_id: world.ont.id,
      location_id: world.warehouse.id,
      units: [{ serial_number: 'NEW-1' }, { serial_number: 'DUP-1' }],
    },
  });

  assert.equal(res.status, 409);
  const created = await h.db.query(
    "SELECT COUNT(*)::int AS n FROM item_instances WHERE serial_number = 'NEW-1'"
  );
  assert.equal(created.rows[0].n, 0, 'the batch must be all-or-nothing');
});

test('a serial repeated inside one request is caught before the database', async () => {
  const res = await h.api.post('/api/item-instances', {
    as: world.staff,
    body: {
      item_id: world.ont.id,
      location_id: world.warehouse.id,
      units: [{ serial_number: 'SAME' }, { serial_number: 'same' }],
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /more than once/);
});

test('bulk items cannot be received as instances', async () => {
  const res = await h.api.post('/api/item-instances', {
    as: world.staff,
    body: {
      item_id: world.cable.id,
      location_id: world.warehouse.id,
      units: [{ serial_number: 'NOPE' }],
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /bulk-tracked/);
});

test('a serial lookup finds a unit by prefix', async () => {
  await h.createInstance({
    itemId: world.ont.id,
    serial: 'FIND-ME-123',
    locationId: world.warehouse.id,
  });

  const res = await h.api.get('/api/item-instances?serial=FIND-ME', { as: world.staff });
  assert.equal(res.status, 200);
  assert.equal(res.body.item_instances.length, 1);
  assert.equal(res.body.item_instances[0].current_location_name, 'Warehouse');
});

// --- Work orders ----------------------------------------------------------

test('a work order moves open -> in_progress -> completed and stamps completed_at', async () => {
  const created = await h.api.post('/api/work-orders', {
    as: world.staff,
    body: {
      customer_premises_id: world.premises.id,
      type: 'new_install',
      assigned_tech_id: world.tech.id,
    },
  });
  assert.equal(created.status, 201);
  const id = created.body.work_order.id;

  const inProgress = await h.api.patch(`/api/work-orders/${id}`, {
    as: world.tech,
    body: { status: 'in_progress' },
  });
  assert.equal(inProgress.status, 200);
  assert.equal(inProgress.body.work_order.completed_at, null);

  const completed = await h.api.patch(`/api/work-orders/${id}`, {
    as: world.tech,
    body: { status: 'completed' },
  });
  assert.equal(completed.status, 200);
  assert.ok(completed.body.work_order.completed_at);

  const reopened = await h.api.patch(`/api/work-orders/${id}`, {
    as: world.staff,
    body: { status: 'open' },
  });
  assert.equal(reopened.status, 400);
});

test('a tech cannot reassign a job, only progress it', async () => {
  const created = await h.api.post('/api/work-orders', {
    as: world.staff,
    body: {
      customer_premises_id: world.premises.id,
      type: 'repair',
      assigned_tech_id: world.tech.id,
    },
  });
  const id = created.body.work_order.id;

  const res = await h.api.patch(`/api/work-orders/${id}`, {
    as: world.tech,
    body: { assigned_tech_id: world.pm.id },
  });
  assert.equal(res.status, 403);
});

test('a tech cannot touch a job assigned to someone else', async () => {
  const created = await h.api.post('/api/work-orders', {
    as: world.staff,
    body: { customer_premises_id: world.premises.id, type: 'repair' },
  });
  const id = created.body.work_order.id;

  assert.equal(
    (await h.api.get(`/api/work-orders/${id}`, { as: world.tech })).status,
    403
  );
});

// --- Reports --------------------------------------------------------------

// The blind spot the cross join exists to close: a location that ran out of an
// item completely has no stock_levels or item_instances row to group by, so a
// naive aggregate hides exactly the item that most needs reordering.
test('low stock reports an item a location holds none of', async () => {
  // The van has never held cable, and cable's threshold is 100.
  const res = await h.api.get('/api/reports/low-stock', { as: world.staff });
  assert.equal(res.status, 200);

  const vanCable = res.body.low_stock.find(
    (r) => r.location_id === world.van.id && r.item_id === world.cable.id
  );
  assert.ok(vanCable, 'a van holding zero cable must still be reported');
  assert.equal(Number(vanCable.quantity), 0);
});

test('low stock counts only installable serialized units', async () => {
  // ONT threshold is 2. Two in stock plus one faulty is not three in stock.
  await h.createInstance({ itemId: world.ont.id, serial: 'LS-1', locationId: world.van.id });
  await h.createInstance({ itemId: world.ont.id, serial: 'LS-2', locationId: world.van.id });
  await h.createInstance({
    itemId: world.ont.id,
    serial: 'LS-3',
    status: 'faulty',
    locationId: world.van.id,
  });

  const res = await h.api.get(`/api/reports/low-stock?location_id=${world.van.id}`, {
    as: world.staff,
  });
  const vanOnt = res.body.low_stock.find((r) => r.item_id === world.ont.id);
  assert.ok(vanOnt);
  assert.equal(Number(vanOnt.quantity), 2);
});

test('a field tech cannot read reports', async () => {
  const res = await h.api.get('/api/reports/summary', { as: world.tech });
  assert.equal(res.status, 403);
});

test('the summary counts active installations and open work orders', async () => {
  const unit = await h.createInstance({
    itemId: world.ont.id,
    serial: 'SUM-1',
    locationId: world.van.id,
  });
  await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: unit.id },
  });
  await h.api.post('/api/work-orders', {
    as: world.staff,
    body: { customer_premises_id: world.premises.id, type: 'repair' },
  });

  const res = await h.api.get('/api/reports/summary', { as: world.staff });
  assert.equal(res.status, 200);
  assert.equal(res.body.summary.active_installations, 1);
  assert.equal(res.body.summary.open_work_orders, 1);
  assert.equal(res.body.summary.installs_this_month, 1);
});

test('consumption attributes installs to the item and ignores transfers', async () => {
  const unit = await h.createInstance({
    itemId: world.ont.id,
    serial: 'CONS-1',
    locationId: world.van.id,
  });
  await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: unit.id },
  });
  // A transfer is movement, not consumption — it must not be counted.
  await h.api.post('/api/transactions', {
    as: world.staff,
    body: {
      item_id: world.cable.id,
      quantity: 300,
      from_location_id: world.warehouse.id,
      to_location_id: world.van.id,
      type: 'transfer',
    },
  });
  // An issue out of the van is consumption.
  await h.api.post('/api/transactions', {
    as: world.tech,
    body: {
      item_id: world.cable.id,
      quantity: 40,
      from_location_id: world.van.id,
      type: 'issue',
    },
  });

  const res = await h.api.get('/api/reports/consumption', { as: world.staff });
  assert.equal(res.status, 200);

  const ont = res.body.consumption.find((r) => r.item_id === world.ont.id);
  const cable = res.body.consumption.find((r) => r.item_id === world.cable.id);
  assert.equal(Number(ont.quantity), 1);
  assert.equal(Number(cable.quantity), 40, 'the 300 m transfer must not be counted');
});

test('tech activity credits the remover, not the installer', async () => {
  const a = await h.createInstance({ itemId: world.ont.id, serial: 'TA-1', locationId: world.van.id });
  const b = await h.createInstance({ itemId: world.ont.id, serial: 'TA-2', locationId: world.van.id });

  await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: a.id },
  });
  await h.api.post(`/api/installations/${world.premises.id}/replace`, {
    as: world.tech,
    body: { new_item_instance_id: b.id, removal_reason: 'faulty' },
  });

  const res = await h.api.get('/api/reports/tech-activity', { as: world.staff });
  const row = res.body.tech_activity.find((r) => r.user_id === world.tech.id);
  assert.equal(row.installs, 2);
  assert.equal(row.removals, 1);
});

test('installation trends fill empty buckets rather than skipping them', async () => {
  const unit = await h.createInstance({
    itemId: world.ont.id,
    serial: 'TR-1',
    locationId: world.van.id,
  });
  await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: unit.id },
  });
  // Backdate it two months so there is a gap to fill.
  await h.db.query("UPDATE installations SET installed_at = now() - interval '2 months'");

  const res = await h.api.get('/api/reports/installation-trends?interval=month', {
    as: world.staff,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.trends.length, 3, 'two months ago, last month, this month');
  assert.equal(res.body.trends[0].installs, 1);
  assert.equal(res.body.trends[1].installs, 0);
});

// --- Migration runner -----------------------------------------------------

test('migrate up is a no-op when everything is applied', async () => {
  assert.equal(await up(), 0);
});

test('editing an applied migration is rejected instead of silently diverging', async () => {
  const migrations = readMigrations();
  const target = path.join(__dirname, '../db/migrations', migrations[0].filename);
  const original = fs.readFileSync(target, 'utf8');

  try {
    fs.writeFileSync(target, `${original}\n-- tampered\n`);
    await assert.rejects(() => up(), /contents have changed/);
  } finally {
    fs.writeFileSync(target, original);
  }

  // And the runner is happy again once the file is restored.
  assert.equal(await up(), 0);
});

test('migration filenames must be numbered', async () => {
  const stray = path.join(__dirname, '../db/migrations', 'not-numbered.sql');
  try {
    fs.writeFileSync(stray, '-- nothing\n');
    assert.throws(() => readMigrations(), /must be <number>_<name>\.sql/);
  } finally {
    fs.unlinkSync(stray);
  }
});
