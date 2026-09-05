// The services catalog, and the guarantee that a service is not stock.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');

let world;

beforeEach(async () => {
  await h.reset();
  world = await h.seedWorld();
});

after(async () => {
  await h.stopServer();
  await h.close();
});

const createService = (body, as) => h.api.post('/api/services', { as: as ?? world.staff, body });

test('warehouse staff add a service and it comes back in the list', async () => {
  const res = await createService({ name: 'Splicing', unit_of_measure: 'job' });
  assert.equal(res.status, 201);
  assert.equal(res.body.service.name, 'Splicing');
  assert.equal(res.body.service.is_active, true);

  const list = await h.api.get('/api/services', { as: world.tech });
  assert.deepEqual(
    list.body.services.map((s) => s.name),
    ['Splicing']
  );
});

// The reason services moved out of items: an item is something a location holds
// a quantity of. Nothing about a service can be stocked, transferred or issued.
test('a service is not an item, so it never appears in the item catalog or in stock', async () => {
  await createService({ name: 'Cable Run', unit_of_measure: 'meter' });

  const items = await h.api.get('/api/items', { as: world.tech });
  assert.equal(
    items.body.items.some((i) => i.name === 'Cable Run'),
    false
  );

  const stock = await h.api.get(`/api/stock?location_id=${world.warehouse.id}`, {
    as: world.staff,
  });
  const stocked = [...stock.body.serialized, ...stock.body.bulk];
  assert.equal(
    stocked.some((row) => row.item_name === 'Cable Run'),
    false
  );
});

// items.name has no unique constraint, which is how 'Sleeves' and 'Heat-shrink
// Sleeves' both got in. services.name does, so the same mistake is not possible.
test('a duplicate service name is rejected rather than silently created twice', async () => {
  assert.equal((await createService({ name: 'Splicing', unit_of_measure: 'job' })).status, 201);

  const again = await createService({ name: 'Splicing', unit_of_measure: 'job' });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already exists/);
});

test('a field tech cannot change the services catalog', async () => {
  const res = await createService({ name: 'Splicing', unit_of_measure: 'job' }, world.tech);
  assert.equal(res.status, 403);
});

test('a service can be renamed and deactivated, and drops out of the default list', async () => {
  const created = await createService({ name: 'PPOE Client Setup', unit_of_measure: 'job' });

  const patched = await h.api.patch(`/api/services/${created.body.service.id}`, {
    as: world.pm,
    body: { name: 'PPPoE Client Setup', is_active: false },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.service.name, 'PPPoE Client Setup');

  const list = await h.api.get('/api/services', { as: world.staff });
  assert.equal(list.body.services.length, 0);

  const all = await h.api.get('/api/services?include_inactive=true', { as: world.staff });
  assert.equal(all.body.services.length, 1);
});

test('patching a service that does not exist is a 404', async () => {
  const res = await h.api.patch('/api/services/999999', {
    as: world.staff,
    body: { name: 'Nothing' },
  });
  assert.equal(res.status, 404);
});
