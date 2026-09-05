// Labour recorded against an installation: what an install writes, what the
// premises views read back, and who is allowed to amend it afterwards.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');

let world;
let unitA;
let unitB;
let splicing;
let cableRun;

beforeEach(async () => {
  await h.reset();
  world = await h.seedWorld();
  unitA = await h.createInstance({
    itemId: world.ont.id,
    serial: 'SVC-A',
    locationId: world.van.id,
  });
  unitB = await h.createInstance({
    itemId: world.ont.id,
    serial: 'SVC-B',
    locationId: world.van.id,
  });
  splicing = await h.createService({ name: 'Splicing' });
  cableRun = await h.createService({ name: 'Cable Run', unitOfMeasure: 'meter' });
});

after(async () => {
  await h.stopServer();
  await h.close();
});

const install = (body, as = world.tech) => h.api.post('/api/installations', { as, body });
const putServices = (id, services, as = world.tech) =>
  h.api.put(`/api/installations/${id}/services`, { as, body: { services } });

const baseInstall = () => ({
  customer_premises_id: world.premises.id,
  item_instance_id: unitA.id,
});

test('an install records the labour performed alongside the hardware', async () => {
  const res = await install({
    ...baseInstall(),
    services: [
      { service_id: splicing.id },
      { service_id: cableRun.id, quantity: 40, notes: 'Along the back fence' },
    ],
  });

  assert.equal(res.status, 201);
  assert.deepEqual(
    res.body.installation.services.map((s) => [s.name, s.quantity, s.unit_of_measure]),
    [
      ['Cable Run', 40, 'meter'],
      ['Splicing', 1, 'job'],
    ]
  );

  // quantity defaults to 1 for flat-rate work, so a 'job' service needs no
  // number typed on a phone.
  const current = await h.api.get(`/api/premises/${world.premises.id}/current`, {
    as: world.staff,
  });
  assert.equal(current.body.current.services.length, 2);
  assert.equal(
    current.body.current.services.find((s) => s.name === 'Cable Run').notes,
    'Along the back fence'
  );
});

test('an install with no services is normal and records none', async () => {
  const res = await install(baseInstall());
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.installation.services, []);
});

// The UNIQUE (installation_id, service_id) would turn this into a 409 about a
// constraint. The client sent one request and should be told which line is wrong.
test('the same service twice in one request is rejected with an explanation', async () => {
  const res = await install({
    ...baseInstall(),
    services: [
      { service_id: cableRun.id, quantity: 40 },
      { service_id: cableRun.id, quantity: 40 },
    ],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /twice/);
});

test('an unknown or retired service cannot be recorded', async () => {
  const unknown = await install({ ...baseInstall(), services: [{ service_id: 999999 }] });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /No service exists/);

  const retired = await h.createService({ name: 'Old Method', isActive: false });
  const res = await install({ ...baseInstall(), services: [{ service_id: retired.id }] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /no longer offered/);
});

test('a zero or negative quantity is rejected', async () => {
  const res = await install({
    ...baseInstall(),
    services: [{ service_id: cableRun.id, quantity: 0 }],
  });
  assert.equal(res.status, 400);
});

// Nothing is recorded if the request fails: the services write shares the
// transaction that creates the installation.
test('a bad service line rolls back the whole install', async () => {
  const res = await install({ ...baseInstall(), services: [{ service_id: 999999 }] });
  assert.equal(res.status, 400);

  const current = await h.api.get(`/api/premises/${world.premises.id}/current`, {
    as: world.staff,
  });
  assert.equal(current.body.current, null);

  const unit = await h.db.query('SELECT status FROM item_instances WHERE id = $1', [unitA.id]);
  assert.equal(unit.rows[0].status, 'in_stock');
});

test('PUT replaces the recorded work, and an empty list clears it', async () => {
  const created = await install({ ...baseInstall(), services: [{ service_id: splicing.id }] });
  const id = created.body.installation.id;

  const updated = await putServices(id, [{ service_id: cableRun.id, quantity: 55 }]);
  assert.equal(updated.status, 200);
  assert.deepEqual(
    updated.body.services.map((s) => [s.name, s.quantity]),
    [['Cable Run', 55]]
  );

  const cleared = await putServices(id, []);
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.services, []);
});

test('a tech cannot amend an installation someone else performed', async () => {
  const created = await install(baseInstall());
  const otherTech = await h.createUser({
    name: 'Other Tech',
    email: 'other@test.local',
    role: 'field_tech',
  });

  const res = await putServices(created.body.installation.id, [{ service_id: splicing.id }], otherTech);
  assert.equal(res.status, 403);

  // The warehouse is the back office for exactly this.
  const staffRes = await putServices(
    created.body.installation.id,
    [{ service_id: splicing.id }],
    world.staff
  );
  assert.equal(staffRes.status, 200);
});

// Work belongs to the visit, not the address: replacing a router years later
// must not fold the two jobs together.
test('a replacement records its own labour and leaves the earlier visit alone', async () => {
  const first = await install({ ...baseInstall(), services: [{ service_id: splicing.id }] });

  const replaced = await h.api.post(`/api/installations/${world.premises.id}/replace`, {
    as: world.tech,
    body: {
      new_item_instance_id: unitB.id,
      removal_reason: 'faulty',
      services: [{ service_id: cableRun.id, quantity: 12 }],
    },
  });
  assert.equal(replaced.status, 201);

  const history = await h.api.get(`/api/premises/${world.premises.id}/history`, {
    as: world.staff,
  });
  const byId = Object.fromEntries(
    history.body.timeline.map((row) => [row.id, row.services.map((s) => s.name)])
  );
  assert.deepEqual(byId[first.body.installation.id], ['Splicing']);
  assert.deepEqual(byId[replaced.body.installation.id], ['Cable Run']);
});

test('recorded work disappears with the installation it describes', async () => {
  const created = await install({ ...baseInstall(), services: [{ service_id: splicing.id }] });
  await h.db.query('DELETE FROM installations WHERE id = $1', [created.body.installation.id]);

  const left = await h.db.query(
    'SELECT count(*)::int AS n FROM installation_services WHERE installation_id = $1',
    [created.body.installation.id]
  );
  assert.equal(left.rows[0].n, 0);
});

// --- Reporting ------------------------------------------------------------

const servicesReport = (params = '', as = world.staff) =>
  h.api.get(`/api/reports/services${params}`, { as });

test('the services report totals quantity per service and counts the visits', async () => {
  await install({
    ...baseInstall(),
    services: [
      { service_id: splicing.id },
      { service_id: cableRun.id, quantity: 40 },
    ],
  });
  await h.api.post(`/api/installations/${world.premises.id}/replace`, {
    as: world.tech,
    body: {
      new_item_instance_id: unitB.id,
      removal_reason: 'faulty',
      services: [{ service_id: cableRun.id, quantity: 60 }],
    },
  });

  const res = await servicesReport();
  assert.equal(res.status, 200);

  const byName = Object.fromEntries(res.body.services.map((r) => [r.label, r]));
  assert.equal(Number(byName['Cable Run'].quantity), 100);
  assert.equal(byName['Cable Run'].visits, 2);
  assert.equal(Number(byName.Splicing.quantity), 1);
  assert.equal(byName.Splicing.visits, 1);

  // Two visits, three lines of work between them.
  assert.equal(res.body.totals.visits, 2);
  assert.equal(res.body.totals.services_performed, 3);
});

// 40 m + 1 splice = 41 of nothing. The totals stay split by unit so the number
// on the tile always has a unit attached to it.
test('report totals are split by unit rather than summed across them', async () => {
  await install({
    ...baseInstall(),
    services: [
      { service_id: splicing.id },
      { service_id: cableRun.id, quantity: 40 },
    ],
  });

  const res = await servicesReport();
  const byUnit = Object.fromEntries(
    res.body.totals.by_unit.map((r) => [r.unit_of_measure, Number(r.quantity)])
  );
  assert.deepEqual(byUnit, { job: 1, meter: 40 });
});

test('grouped by tech, the report counts work but reports no mixed-unit quantity', async () => {
  await install({
    ...baseInstall(),
    services: [{ service_id: splicing.id }, { service_id: cableRun.id, quantity: 40 }],
  });

  const res = await servicesReport('?group_by=tech');
  assert.equal(res.body.services.length, 1);
  assert.equal(res.body.services[0].label, world.tech.name);
  assert.equal(res.body.services[0].services_performed, 2);
  assert.equal(res.body.services[0].visits, 1);
  assert.equal(res.body.services[0].quantity, null);
});

// The window is on when the work was DONE, not when it was typed in.
test('the report window follows the installation date, not the recording date', async () => {
  const created = await install({ ...baseInstall(), services: [{ service_id: splicing.id }] });
  await h.db.query(
    "UPDATE installations SET installed_at = now() - interval '90 days' WHERE id = $1",
    [created.body.installation.id]
  );

  const recent = await servicesReport(
    `?from=${new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)}`
  );
  assert.equal(recent.body.services.length, 0);
  assert.equal(recent.body.totals.visits, 0);

  const all = await servicesReport();
  assert.equal(all.body.services.length, 1);
});

test('a field tech cannot read the services report', async () => {
  const res = await servicesReport('', world.tech);
  assert.equal(res.status, 403);
});
