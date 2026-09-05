// The admin role: what it can correct, and what it still cannot.
//
// The interesting cases are the two edges. One is reach — an admin passes every
// requireRole check without being named in one, so a route added tomorrow does
// not quietly lock them out. The other is the limit: admin is a role check, not
// a way around the invariants the rest of the schema hangs off.
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

// --- Reach ----------------------------------------------------------------

test('an admin passes role checks that name only warehouse staff and pms', async () => {
  const item = await h.api.post('/api/items', {
    as: world.admin,
    body: {
      name: 'Admin Item',
      category: 'ONT',
      tracking_type: 'serialized',
      unit_of_measure: 'unit',
    },
  });
  assert.equal(item.status, 201);

  const reports = await h.api.get('/api/reports/low-stock', { as: world.admin });
  assert.equal(reports.status, 200);

  const users = await h.api.post('/api/users', {
    as: world.admin,
    body: {
      name: 'New Tech',
      email: 'new.tech@test.local',
      role: 'field_tech',
      password: 'a-long-enough-password',
    },
  });
  assert.equal(users.status, 201);
});

test('every table with a correction path accepts one from an admin', async () => {
  const location = await h.api.patch(`/api/locations/${world.warehouse.id}`, {
    as: world.admin,
    body: { name: 'Central Warehouse', address: 'Industrial Area' },
  });
  assert.equal(location.status, 200);
  assert.equal(location.body.location.name, 'Central Warehouse');

  const premises = await h.api.patch(`/api/premises/${world.premises.id}`, {
    as: world.admin,
    body: { address: '14B Ngong Road', customer_account_id: 'KE-77291' },
  });
  assert.equal(premises.status, 200);
  assert.equal(premises.body.premises.address, '14B Ngong Road');

  const service = await h.api.post('/api/services', {
    as: world.admin,
    body: { name: 'Splicing', unit_of_measure: 'job' },
  });
  const renamed = await h.api.patch(`/api/services/${service.body.service.id}`, {
    as: world.admin,
    body: { name: 'Fibre Splicing' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.service.name, 'Fibre Splicing');

  const workOrder = await h.api.post('/api/work-orders', {
    as: world.admin,
    body: { customer_premises_id: world.premises.id, type: 'new_install' },
  });
  const progressed = await h.api.patch(`/api/work-orders/${workOrder.body.work_order.id}`, {
    as: world.admin,
    body: { status: 'in_progress' },
  });
  assert.equal(progressed.status, 200);
  assert.equal(progressed.body.work_order.status, 'in_progress');
});

test('a van can be reassigned to another tech without recreating the van', async () => {
  const other = await h.createUser({
    name: 'Second Tech',
    email: 'tech2@test.local',
    role: 'field_tech',
  });

  const res = await h.api.patch(`/api/locations/${world.van.id}`, {
    as: world.admin,
    body: { tech_id: other.id },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.location.tech_id, other.id);
});

// A location's type is what every stock row already booked there was booked
// against, the same reason items.tracking_type is frozen.
test('a location type cannot be changed, by an admin or anyone else', async () => {
  const res = await h.api.patch(`/api/locations/${world.warehouse.id}`, {
    as: world.admin,
    body: { type: 'tech_van' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /type cannot be changed/);
});

test('a van cannot be left without a tech, and a non-tech cannot be given one', async () => {
  const orphaned = await h.api.patch(`/api/locations/${world.van.id}`, {
    as: world.admin,
    body: { tech_id: null },
  });
  assert.equal(orphaned.status, 400);

  const wrongRole = await h.api.patch(`/api/locations/${world.van.id}`, {
    as: world.admin,
    body: { tech_id: world.staff.id },
  });
  assert.equal(wrongRole.status, 400);
  assert.match(wrongRole.body.error, /field_tech/);
});

// --- Serialized unit corrections ------------------------------------------

test('an admin fixes a serial keyed wrong at receiving, and it is auditable', async () => {
  const instance = await h.createInstance({
    itemId: world.ont.id,
    serial: 'TYPO-0O0',
    locationId: world.warehouse.id,
  });

  const res = await h.api.patch(`/api/item-instances/${instance.id}`, {
    as: world.admin,
    body: { serial_number: 'REAL-000', notes: 'Keyed wrong off the carton' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.item_instance.serial_number, 'REAL-000');

  const audit = await h.api.get(`/api/transactions?item_instance_id=${instance.id}`, {
    as: world.admin,
  });
  const adjustment = audit.body.transactions.find((t) => t.type === 'adjustment');
  assert.ok(adjustment, 'the correction should leave an audit row');
  assert.equal(adjustment.notes, 'Keyed wrong off the carton');
  assert.equal(Number(adjustment.performed_by), world.admin.id);
});

test('warehouse staff still cannot rewrite a unit — only retire it', async () => {
  const instance = await h.createInstance({
    itemId: world.ont.id,
    serial: 'STAFF-1',
    locationId: world.warehouse.id,
  });

  const rewrite = await h.api.patch(`/api/item-instances/${instance.id}`, {
    as: world.staff,
    body: { serial_number: 'STAFF-2' },
  });
  assert.equal(rewrite.status, 400);
  assert.match(rewrite.body.error, /administrator/);

  const retire = await h.api.patch(`/api/item-instances/${instance.id}`, {
    as: world.staff,
    body: { status: 'retired' },
  });
  assert.equal(retire.status, 200);
  assert.equal(retire.body.item_instance.status, 'retired');
  assert.equal(retire.body.item_instance.current_location_id, null);
});

// The limit that matters: an installed unit is one half of a live installation.
test('not even an admin can edit a unit out from under a live installation', async () => {
  const instance = await h.createInstance({
    itemId: world.ont.id,
    serial: 'IN-SERVICE',
    locationId: world.van.id,
  });
  const install = await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: instance.id },
  });
  assert.equal(install.status, 201);

  const res = await h.api.patch(`/api/item-instances/${instance.id}`, {
    as: world.admin,
    body: { status: 'faulty' },
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /remove it first/);
});

test('installed cannot be set by hand — it would have no installation behind it', async () => {
  const instance = await h.createInstance({
    itemId: world.ont.id,
    serial: 'NOT-INSTALLED',
    locationId: world.warehouse.id,
  });

  const res = await h.api.patch(`/api/item-instances/${instance.id}`, {
    as: world.admin,
    body: { status: 'installed' },
  });
  assert.equal(res.status, 400);
});

// --- Stock adjustments ----------------------------------------------------

test('a physical count corrects a bulk stock level and records the difference', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 500 });

  const res = await h.api.post('/api/stock/adjustments', {
    as: world.admin,
    body: {
      item_id: world.cable.id,
      location_id: world.warehouse.id,
      counted_quantity: 480,
      notes: 'Physical count, quarter end',
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.adjusted, true);
  assert.equal(res.body.delta, -20);
  assert.equal(res.body.quantity, 480);
  assert.equal(Number(res.body.transaction.quantity), 20);
  assert.equal(res.body.transaction.type, 'adjustment');
  assert.equal(Number(res.body.transaction.from_location_id), world.warehouse.id);

  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.warehouse.id }), 480);
});

test('a count that agrees with the record writes nothing', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 120 });

  const res = await h.api.post('/api/stock/adjustments', {
    as: world.admin,
    body: {
      item_id: world.cable.id,
      location_id: world.warehouse.id,
      counted_quantity: 120,
      notes: 'Counted, matches',
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.adjusted, false);
  assert.equal(res.body.transaction, null);

  const audit = await h.api.get('/api/transactions?type=adjustment', { as: world.admin });
  assert.equal(audit.body.transactions.length, 0);
});

test('the same count submitted twice adjusts once', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 500 });
  const body = {
    item_id: world.cable.id,
    location_id: world.warehouse.id,
    counted_quantity: 450,
    notes: 'Recount',
    idempotency_key: h.uniqueKey(),
  };

  const first = await h.api.post('/api/stock/adjustments', { as: world.admin, body });
  assert.equal(first.status, 201);
  const second = await h.api.post('/api/stock/adjustments', { as: world.admin, body });
  assert.equal(second.status, 200);
  assert.equal(second.body.replayed, true);

  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.warehouse.id }), 450);
});

test('an adjustment needs a reason, and is admin-only', async () => {
  const noReason = await h.api.post('/api/stock/adjustments', {
    as: world.admin,
    body: { item_id: world.cable.id, location_id: world.warehouse.id, counted_quantity: 10 },
  });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /notes/);

  for (const user of [world.staff, world.pm, world.tech]) {
    const res = await h.api.post('/api/stock/adjustments', {
      as: user,
      body: {
        item_id: world.cable.id,
        location_id: world.warehouse.id,
        counted_quantity: 10,
        notes: 'Trying it on',
      },
    });
    assert.equal(res.status, 403, `${user.role} should not be able to adjust stock`);
  }
});

test('a serialized item is corrected per unit, not by counting it', async () => {
  const res = await h.api.post('/api/stock/adjustments', {
    as: world.admin,
    body: {
      item_id: world.ont.id,
      location_id: world.warehouse.id,
      counted_quantity: 3,
      notes: 'Counted the shelf',
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /serialized/);
});

// --- Installation record corrections --------------------------------------

test('an admin backdates an install that was entered days late', async () => {
  const instance = await h.createInstance({
    itemId: world.ont.id,
    serial: 'BACKDATE-1',
    locationId: world.van.id,
  });
  const install = await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: instance.id },
  });

  const res = await h.api.patch(`/api/installations/${install.body.installation.id}`, {
    as: world.admin,
    body: { installed_at: '2026-01-15T09:00:00Z' },
  });
  assert.equal(res.status, 200);
  assert.equal(new Date(res.body.installation.installed_at).getUTCFullYear(), 2026);
});

test('a correction cannot rewrite who installed what, or revive a removed unit', async () => {
  const instance = await h.createInstance({
    itemId: world.ont.id,
    serial: 'CORRECT-1',
    locationId: world.van.id,
  });
  const install = await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: instance.id },
  });
  const id = install.body.installation.id;

  const rewrite = await h.api.patch(`/api/installations/${id}`, {
    as: world.admin,
    body: { installed_by: world.staff.id },
  });
  assert.equal(rewrite.status, 400);

  // Still live, so there is no removal to correct — use the removal endpoint.
  const reason = await h.api.patch(`/api/installations/${id}`, {
    as: world.admin,
    body: { removal_reason: 'faulty' },
  });
  assert.equal(reason.status, 400);
});

test('the installation correction endpoint is admin-only', async () => {
  const instance = await h.createInstance({
    itemId: world.ont.id,
    serial: 'ADMIN-ONLY-1',
    locationId: world.van.id,
  });
  const install = await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: instance.id },
  });

  const res = await h.api.patch(`/api/installations/${install.body.installation.id}`, {
    as: world.pm,
    body: { installed_at: '2026-01-15T09:00:00Z' },
  });
  assert.equal(res.status, 403);
});

// --- Keeping an admin ------------------------------------------------------

test('the last active admin cannot be demoted or deactivated', async () => {
  const demote = await h.api.patch(`/api/users/${world.admin.id}`, {
    as: world.pm,
    body: { role: 'pm' },
  });
  assert.equal(demote.status, 400);
  assert.match(demote.body.error, /last active administrator/);

  const deactivate = await h.api.patch(`/api/users/${world.admin.id}`, {
    as: world.pm,
    body: { is_active: false },
  });
  assert.equal(deactivate.status, 400);
  assert.match(deactivate.body.error, /last active administrator/);
});

test('an admin cannot remove their own admin access even when another admin exists', async () => {
  await h.createUser({ name: 'Second Admin', email: 'admin2@test.local', role: 'admin' });

  const res = await h.api.patch(`/api/users/${world.admin.id}`, {
    as: world.admin,
    body: { role: 'pm' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /your own administrator access/);
});

test('an admin can be demoted once another one is in place', async () => {
  const second = await h.createUser({
    name: 'Second Admin',
    email: 'admin2@test.local',
    role: 'admin',
  });

  const res = await h.api.patch(`/api/users/${world.admin.id}`, {
    as: second,
    body: { role: 'pm' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'pm');
});

test('a deactivated admin loses access on their very next request', async () => {
  const second = await h.createUser({
    name: 'Second Admin',
    email: 'admin2@test.local',
    role: 'admin',
  });
  const token = h.tokenFor(second);

  assert.equal((await h.api.get('/api/auth/me', { token })).status, 200);

  await h.api.patch(`/api/users/${second.id}`, {
    as: world.admin,
    body: { is_active: false },
  });

  const after = await h.api.get('/api/auth/me', { token });
  assert.equal(after.status, 401);
});
