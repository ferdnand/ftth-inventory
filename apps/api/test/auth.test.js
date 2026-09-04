// Authentication and role/location scoping.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const h = require('./helpers');
const env = require('../src/lib/env');

let world;

beforeEach(async () => {
  await h.reset();
  world = await h.seedWorld();
});

after(async () => {
  await h.stopServer();
  await h.close();
});

test('health check needs no token', async () => {
  const res = await h.api.get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('a request with no token is rejected', async () => {
  const res = await h.api.get(`/api/stock?location_id=${world.van.id}`);
  assert.equal(res.status, 401);
});

test('a request with a garbage token is rejected', async () => {
  const res = await h.api.get('/api/items', { token: 'not-a-jwt' });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /Invalid token/);
});

test('an expired token is rejected with a message that says so', async () => {
  const expired = jwt.sign({ sub: world.tech.id }, env.JWT_SECRET, { expiresIn: '-1s' });
  const res = await h.api.get('/api/items', { token: expired });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /expired/i);
});

test('login returns a working token', async () => {
  const res = await h.api.post('/api/auth/login', {
    body: { email: 'tech@test.local', password: h.PASSWORD },
  });

  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, 'tech@test.local');
  assert.equal(res.body.user.role, 'field_tech');
  assert.equal(res.body.user.password_hash, undefined, 'must never return the hash');

  const me = await h.api.get('/api/auth/me', { token: res.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, world.tech.id);
});

test('login is case-insensitive on the email', async () => {
  const res = await h.api.post('/api/auth/login', {
    body: { email: 'TECH@Test.Local', password: h.PASSWORD },
  });
  assert.equal(res.status, 200);
});

test('login gives the same message for a wrong password and an unknown email', async () => {
  const wrongPassword = await h.api.post('/api/auth/login', {
    body: { email: 'tech@test.local', password: 'nope' },
  });
  const unknownEmail = await h.api.post('/api/auth/login', {
    body: { email: 'nobody@test.local', password: h.PASSWORD },
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.body.error, unknownEmail.body.error);
});

test('a user with no password set cannot log in', async () => {
  await h.db.query('UPDATE users SET password_hash = NULL WHERE id = $1', [world.tech.id]);
  const res = await h.api.post('/api/auth/login', {
    body: { email: 'tech@test.local', password: h.PASSWORD },
  });
  assert.equal(res.status, 401);
});

// The reason requireAuth re-reads the user on every request instead of trusting
// the token's claims: a deactivated account must lose access immediately, not at
// the next token expiry.
test('deactivating a user invalidates their existing token immediately', async () => {
  const token = h.tokenFor(world.tech);

  const before = await h.api.get('/api/items', { token });
  assert.equal(before.status, 200);

  await h.db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [world.tech.id]);

  const afterDeactivation = await h.api.get('/api/items', { token });
  assert.equal(afterDeactivation.status, 401);
  assert.match(afterDeactivation.body.error, /no longer active/);
});

test('changing a role takes effect on the next request', async () => {
  const token = h.tokenFor(world.tech);

  const denied = await h.api.get('/api/users', { token });
  assert.equal(denied.status, 403);

  await h.db.query("UPDATE users SET role = 'pm' WHERE id = $1", [world.tech.id]);

  const allowed = await h.api.get('/api/users', { token });
  assert.equal(allowed.status, 200);
});

test('a field tech cannot read another location stock', async () => {
  const res = await h.api.get(`/api/stock?location_id=${world.warehouse.id}`, {
    as: world.tech,
  });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /own assigned location/);
});

test('a field tech can read their own van stock', async () => {
  const res = await h.api.get(`/api/stock?location_id=${world.van.id}`, { as: world.tech });
  assert.equal(res.status, 200);
});

test('warehouse staff can read any location stock', async () => {
  for (const location of [world.warehouse, world.van]) {
    const res = await h.api.get(`/api/stock?location_id=${location.id}`, { as: world.staff });
    assert.equal(res.status, 200);
  }
});

test('only a pm can create users', async () => {
  const body = {
    name: 'New Tech',
    email: 'new@test.local',
    role: 'field_tech',
    password: 'a-long-enough-password',
  };

  assert.equal((await h.api.post('/api/users', { as: world.tech, body })).status, 403);
  assert.equal((await h.api.post('/api/users', { as: world.staff, body })).status, 403);
  assert.equal((await h.api.post('/api/users', { as: world.pm, body })).status, 201);
});

test('only warehouse staff or a pm can create items', async () => {
  const body = {
    name: 'Splitter 1:8',
    category: 'Splitter',
    tracking_type: 'bulk',
    unit_of_measure: 'unit',
  };

  assert.equal((await h.api.post('/api/items', { as: world.tech, body })).status, 403);
  assert.equal((await h.api.post('/api/items', { as: world.staff, body })).status, 201);
});

test('a field tech cannot record a receive', async () => {
  const res = await h.api.post('/api/transactions', {
    as: world.tech,
    body: {
      item_id: world.cable.id,
      quantity: 10,
      to_location_id: world.van.id,
      type: 'receive',
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /restock request/);
});

test('a field tech cannot record a movement that does not involve their van', async () => {
  const otherVanTech = await h.createUser({
    name: 'Other Tech',
    email: 'other@test.local',
    role: 'field_tech',
  });
  const otherVan = await h.createLocation({
    name: 'Van 2',
    type: 'tech_van',
    techId: otherVanTech.id,
  });
  await h.setStock({ itemId: world.cable.id, locationId: otherVan.id, quantity: 100 });

  const res = await h.api.post('/api/transactions', {
    as: world.tech,
    body: {
      item_id: world.cable.id,
      quantity: 10,
      from_location_id: otherVan.id,
      type: 'issue',
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /own van/);
});

// performed_by used to be a client-supplied field. Silently ignoring it would
// leave a client believing it had written as someone else.
test('sending performed_by is rejected outright', async () => {
  const res = await h.api.post('/api/transactions', {
    as: world.staff,
    body: {
      item_id: world.cable.id,
      quantity: 10,
      to_location_id: world.warehouse.id,
      type: 'receive',
      performed_by: world.pm.id,
    },
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /access token/);
});

test('a transaction is attributed to the token holder', async () => {
  const res = await h.api.post('/api/transactions', {
    as: world.staff,
    body: {
      item_id: world.cable.id,
      quantity: 10,
      to_location_id: world.warehouse.id,
      type: 'receive',
    },
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.transaction.performed_by, world.staff.id);
});

test('an unknown route returns a JSON 404, not HTML', async () => {
  const res = await h.api.get('/api/nope', { as: world.pm });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'Not found' });
});
