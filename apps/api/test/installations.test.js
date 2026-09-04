// Install / replace: the single-active-installation invariant, the required
// removal reason, and idempotent retries.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');

let world;
let unitA;
let unitB;

beforeEach(async () => {
  await h.reset();
  world = await h.seedWorld();
  unitA = await h.createInstance({
    itemId: world.ont.id,
    serial: 'UNIT-A',
    mac: 'AA:AA:AA:AA:AA:AA',
    locationId: world.van.id,
  });
  unitB = await h.createInstance({
    itemId: world.ont.id,
    serial: 'UNIT-B',
    mac: 'BB:BB:BB:BB:BB:BB',
    locationId: world.van.id,
  });
});

after(async () => {
  await h.stopServer();
  await h.close();
});

const install = (body, as = world.tech) => h.api.post('/api/installations', { as, body });
const replace = (premisesId, body, as = world.tech) =>
  h.api.post(`/api/installations/${premisesId}/replace`, { as, body });

test('a first install records the installation and takes the unit out of the van', async () => {
  const res = await install({
    customer_premises_id: world.premises.id,
    item_instance_id: unitA.id,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.installation.installed_by, world.tech.id);
  assert.equal(res.body.installation.removed_at, null);

  const instance = await h.db.query('SELECT * FROM item_instances WHERE id = $1', [unitA.id]);
  assert.equal(instance.rows[0].status, 'installed');
  assert.equal(instance.rows[0].current_location_id, null);

  // The audit row records which van the unit left — a customer premises is not
  // a location, so there is no destination.
  const txn = await h.db.query(
    "SELECT * FROM transactions WHERE item_instance_id = $1 AND type = 'install'",
    [unitA.id]
  );
  assert.equal(txn.rows.length, 1);
  assert.equal(txn.rows[0].from_location_id, world.van.id);
  assert.equal(txn.rows[0].to_location_id, null);
  assert.equal(txn.rows[0].performed_by, world.tech.id);
});

test('installing twice at the same premises conflicts', async () => {
  assert.equal((await install({
    customer_premises_id: world.premises.id,
    item_instance_id: unitA.id,
  })).status, 201);

  const second = await install({
    customer_premises_id: world.premises.id,
    item_instance_id: unitB.id,
  });

  assert.equal(second.status, 409);
  assert.match(second.body.error, /already exists/);

  // The second unit must not have been touched.
  const instance = await h.db.query('SELECT status FROM item_instances WHERE id = $1', [unitB.id]);
  assert.equal(instance.rows[0].status, 'in_stock');
});

// The partial unique index is the actual guarantee; the app's 409 is only a
// friendly path to it.
test('the database refuses a second active installation even without the app check', async () => {
  await install({ customer_premises_id: world.premises.id, item_instance_id: unitA.id });

  await assert.rejects(
    () =>
      h.db.query(
        `INSERT INTO installations (customer_premises_id, item_instance_id, installed_by)
         VALUES ($1, $2, $3)`,
        [world.premises.id, unitB.id, world.tech.id]
      ),
    (err) => err.constraint === 'uq_active_installation_per_premises'
  );
});

test('a unit that is not in_stock cannot be installed', async () => {
  const faulty = await h.createInstance({
    itemId: world.ont.id,
    serial: 'UNIT-FAULTY',
    status: 'faulty',
    locationId: world.van.id,
  });

  const res = await install({
    customer_premises_id: world.premises.id,
    item_instance_id: faulty.id,
  });

  assert.equal(res.status, 409);
  assert.match(res.body.error, /not 'in_stock'/);
});

test('a unit installed elsewhere cannot be installed again', async () => {
  const otherPremises = await h.createPremises('2 Other Road');
  await install({ customer_premises_id: otherPremises.id, item_instance_id: unitA.id });

  const res = await install({
    customer_premises_id: world.premises.id,
    item_instance_id: unitA.id,
  });
  assert.equal(res.status, 409);
});

test('a tech cannot install a unit that is not in their van', async () => {
  const warehouseUnit = await h.createInstance({
    itemId: world.ont.id,
    serial: 'UNIT-WH',
    locationId: world.warehouse.id,
  });

  const res = await install({
    customer_premises_id: world.premises.id,
    item_instance_id: warehouseUnit.id,
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /not in your van/);
});

test('installing at an unknown premises is a 404', async () => {
  const res = await install({ customer_premises_id: 9999, item_instance_id: unitA.id });
  assert.equal(res.status, 404);
});

test('sending installed_by is rejected outright', async () => {
  const res = await install({
    customer_premises_id: world.premises.id,
    item_instance_id: unitA.id,
    installed_by: world.pm.id,
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /access token/);
});

test('a replacement closes out the old installation and parks the old unit in the van', async () => {
  await install({ customer_premises_id: world.premises.id, item_instance_id: unitA.id });

  const res = await replace(world.premises.id, {
    new_item_instance_id: unitB.id,
    removal_reason: 'faulty',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.installation.item_instance_id, unitB.id);

  const old = await h.db.query('SELECT * FROM item_instances WHERE id = $1', [unitA.id]);
  assert.equal(old.rows[0].status, 'faulty');
  // Parked back in the tech's van rather than left with a NULL location, so it
  // still shows up as something to run to the warehouse.
  assert.equal(old.rows[0].current_location_id, world.van.id);

  const installations = await h.db.query(
    'SELECT * FROM installations WHERE customer_premises_id = $1 ORDER BY installed_at',
    [world.premises.id]
  );
  assert.equal(installations.rows.length, 2);
  assert.equal(installations.rows[0].removal_reason, 'faulty');
  assert.equal(installations.rows[0].removed_by, world.tech.id);
  assert.ok(installations.rows[0].removed_at);
  assert.equal(installations.rows[1].removed_at, null);
});

test('a non-faulty removal marks the old unit returned, not faulty', async () => {
  await install({ customer_premises_id: world.premises.id, item_instance_id: unitA.id });
  await replace(world.premises.id, {
    new_item_instance_id: unitB.id,
    removal_reason: 'upgrade',
  });

  const old = await h.db.query('SELECT status FROM item_instances WHERE id = $1', [unitA.id]);
  assert.equal(old.rows[0].status, 'returned');
});

test('a replacement without a removal reason is rejected', async () => {
  await install({ customer_premises_id: world.premises.id, item_instance_id: unitA.id });

  const res = await replace(world.premises.id, { new_item_instance_id: unitB.id });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /removal_reason/);
});

test('an unrecognised removal reason is rejected', async () => {
  await install({ customer_premises_id: world.premises.id, item_instance_id: unitA.id });

  const res = await replace(world.premises.id, {
    new_item_instance_id: unitB.id,
    removal_reason: 'because',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /must be one of/);
});

// The app returns a 400 first; this is the constraint behind it.
test('the database refuses a removal with no reason', async () => {
  await install({ customer_premises_id: world.premises.id, item_instance_id: unitA.id });

  await assert.rejects(
    () =>
      h.db.query(
        'UPDATE installations SET removed_at = now(), removed_by = $1 WHERE customer_premises_id = $2',
        [world.tech.id, world.premises.id]
      ),
    (err) => err.constraint === 'removal_reason_required_if_removed'
  );
});

test('replacing at a premises with no active router is a 404', async () => {
  const res = await replace(world.premises.id, {
    new_item_instance_id: unitA.id,
    removal_reason: 'faulty',
  });
  assert.equal(res.status, 404);
  assert.match(res.body.error, /No active router/);
});

test('replacing a unit with itself is rejected', async () => {
  await install({ customer_premises_id: world.premises.id, item_instance_id: unitA.id });

  const res = await replace(world.premises.id, {
    new_item_instance_id: unitA.id,
    removal_reason: 'faulty',
  });
  assert.equal(res.status, 409); // caught by the in_stock check first
});

test('the history endpoint counts replacements, not routers', async () => {
  await install({ customer_premises_id: world.premises.id, item_instance_id: unitA.id });
  await replace(world.premises.id, {
    new_item_instance_id: unitB.id,
    removal_reason: 'upgrade',
  });

  const res = await h.api.get(`/api/premises/${world.premises.id}/history`, { as: world.tech });
  assert.equal(res.status, 200);
  assert.equal(res.body.total_routers, 2);
  assert.equal(res.body.replacement_count, 1);
  // Newest first.
  assert.equal(res.body.timeline[0].serial_number, 'UNIT-B');
  assert.equal(res.body.timeline[1].removal_reason, 'upgrade');
  assert.equal(res.body.timeline[1].removed_by_name, 'Test Tech');
});

test('current returns null with a 200 when nothing is installed, but history 404s on a bad id', async () => {
  const current = await h.api.get(`/api/premises/${world.premises.id}/current`, {
    as: world.tech,
  });
  assert.equal(current.status, 200);
  assert.equal(current.body.current, null);

  const history = await h.api.get('/api/premises/9999/history', { as: world.tech });
  assert.equal(history.status, 404);
});

// --- Idempotency ----------------------------------------------------------

test('replaying an install with the same key returns the original, not a second row', async () => {
  const key = h.uniqueKey();
  const body = {
    customer_premises_id: world.premises.id,
    item_instance_id: unitA.id,
    idempotency_key: key,
  };

  const first = await install(body);
  assert.equal(first.status, 201);

  const replay = await install(body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.installation.id, first.body.installation.id);

  const count = await h.db.query('SELECT COUNT(*)::int AS n FROM installations');
  assert.equal(count.rows[0].n, 1);
});

test('replaying a replacement with the same key does not double-swap', async () => {
  await install({ customer_premises_id: world.premises.id, item_instance_id: unitA.id });

  const key = h.uniqueKey();
  const body = {
    new_item_instance_id: unitB.id,
    removal_reason: 'faulty',
    idempotency_key: key,
  };

  const first = await replace(world.premises.id, body);
  assert.equal(first.status, 201);

  const replay = await replace(world.premises.id, body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);

  const count = await h.db.query('SELECT COUNT(*)::int AS n FROM installations');
  assert.equal(count.rows[0].n, 2);
});

test('a transaction replay returns the original transaction', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 500 });
  const body = {
    item_id: world.cable.id,
    quantity: 100,
    from_location_id: world.warehouse.id,
    to_location_id: world.van.id,
    type: 'transfer',
    idempotency_key: h.uniqueKey(),
  };

  const first = await h.api.post('/api/transactions', { as: world.staff, body });
  assert.equal(first.status, 201);

  const replay = await h.api.post('/api/transactions', { as: world.staff, body });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.transaction.id, first.body.transaction.id);

  // Critically: the stock moved once, not twice.
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.warehouse.id }), 400);
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.van.id }), 100);
});

test('install is not an accepted type on POST /api/transactions', async () => {
  const res = await h.api.post('/api/transactions', {
    as: world.staff,
    body: { item_instance_id: unitA.id, type: 'install', to_location_id: world.van.id },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /must be one of/);
});
