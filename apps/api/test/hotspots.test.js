// PPPoE or hotspot, plots and flats, several routers at a hotspot, and
// premises that stop being clients.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');

let world;
let bungoma;
let units;

beforeEach(async () => {
  await h.reset();
  world = await h.seedWorld();
  bungoma = await h.siteId('Bungoma');
  units = [];
  for (const serial of ['H-1', 'H-2', 'H-3']) {
    units.push(
      await h.createInstance({ itemId: world.ont.id, serial, locationId: world.van.id })
    );
  }
});

after(async () => {
  await h.stopServer();
  await h.close();
});

const create = (body, as = world.tech) => h.api.post('/api/premises', { as, body });
const patch = (id, body, as = world.staff) => h.api.patch(`/api/premises/${id}`, { as, body });
const install = (premisesId, unit, as = world.tech) =>
  h.api.post('/api/installations', {
    as,
    body: { customer_premises_id: premisesId, item_instance_id: unit.id },
  });
const replace = (premisesId, body, as = world.tech) =>
  h.api.post(`/api/installations/${premisesId}/replace`, { as, body });

const makeHotspot = async (extra = {}) =>
  (
    await create({
      landmark: 'Mama Pima’s kiosk',
      customer_name: 'Pima Wafula', // the contact person
      customer_phone: '0712000111',
      site_id: bungoma,
      connection_type: 'hotspot',
      hotspot_arrangement: 'token',
      ...extra,
    })
  ).body.premises;

// --- Classification -------------------------------------------------------

test('a premises is PPPoE unless it says otherwise', async () => {
  const res = await create({ landmark: 'By the dam', site_id: bungoma });
  assert.equal(res.status, 201);
  assert.equal(res.body.premises.connection_type, 'pppoe');
  assert.equal(res.body.premises.hotspot_arrangement, null);
});

test('plots and flats are premises types', async () => {
  for (const premises_type of ['plot', 'flat']) {
    const res = await create({ landmark: `A ${premises_type}`, premises_type, site_id: bungoma });
    assert.equal(res.status, 201);
    assert.equal(res.body.premises.premises_type, premises_type);
  }
});

test('a hotspot has to say whether its host gets a token or a voucher', async () => {
  const missing = await create({ landmark: 'Kiosk', connection_type: 'hotspot' });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /token.*voucher/);

  for (const hotspot_arrangement of ['token', 'voucher']) {
    const ok = await create({ landmark: 'Kiosk', connection_type: 'hotspot', hotspot_arrangement });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.premises.hotspot_arrangement, hotspot_arrangement);
  }

  const bad = await create({
    landmark: 'Kiosk',
    connection_type: 'hotspot',
    hotspot_arrangement: 'cash',
  });
  assert.equal(bad.status, 400);
});

test('only a hotspot may carry an arrangement', async () => {
  const res = await create({ landmark: 'By the dam', hotspot_arrangement: 'voucher' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /only applies to a hotspot/);
});

test('a hotspot can be captured with its job in one request', async () => {
  const res = await h.api.post('/api/work-orders', {
    as: world.tech,
    body: {
      type: 'new_install',
      site_id: bungoma,
      premises: {
        landmark: 'Stage hotspot',
        connection_type: 'hotspot',
        hotspot_arrangement: 'voucher',
      },
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.work_order.premises.connection_type, 'hotspot');
  assert.equal(res.body.work_order.premises.hotspot_arrangement, 'voucher');
});

test('reclassifying a hotspot as PPPoE drops its arrangement', async () => {
  const hotspot = await makeHotspot();
  const res = await patch(hotspot.id, { connection_type: 'pppoe' });

  assert.equal(res.status, 200);
  assert.equal(res.body.premises.connection_type, 'pppoe');
  assert.equal(res.body.premises.hotspot_arrangement, null);
});

test('reclassifying as a hotspot needs an arrangement', async () => {
  const res = await patch(world.premises.id, { connection_type: 'hotspot' });
  assert.equal(res.status, 400);

  const ok = await patch(world.premises.id, {
    connection_type: 'hotspot',
    hotspot_arrangement: 'voucher',
  });
  assert.equal(ok.status, 200);
});

// --- Several routers ------------------------------------------------------

test('a hotspot takes several routers; a PPPoE premises still takes one', async () => {
  const hotspot = await makeHotspot();

  assert.equal((await install(hotspot.id, units[0])).status, 201);
  assert.equal((await install(hotspot.id, units[1])).status, 201);

  const current = await h.api.get(`/api/premises/${hotspot.id}/current`, { as: world.tech });
  assert.equal(current.body.installations.length, 2);
  assert.equal(current.body.current.installation_id, current.body.installations[0].installation_id);

  const pppoe = await h.api.post('/api/installations', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, item_instance_id: units[2].id },
  });
  assert.equal(pppoe.status, 201);
  const second = await install(world.premises.id, units[0]);
  assert.equal(second.status, 409);
});

test('the database itself refuses a second router at a PPPoE premises', async () => {
  await install(world.premises.id, units[0]);
  const job = await h.createJob({ premisesId: world.premises.id, techId: world.tech.id });

  await assert.rejects(
    () =>
      h.db.query(
        `INSERT INTO installations
           (customer_premises_id, item_instance_id, installed_by, work_order_id)
         VALUES ($1, $2, $3, $4)`,
        [world.premises.id, units[1].id, world.tech.id, job.id]
      ),
    (err) => err.constraint === 'uq_active_installation_per_premises'
  );
});

test('replacing at a hotspot with several routers has to say which one', async () => {
  const hotspot = await makeHotspot();
  await install(hotspot.id, units[0]);
  await install(hotspot.id, units[1]);

  const unsure = await replace(hotspot.id, {
    new_item_instance_id: units[2].id,
    removal_reason: 'faulty',
  });
  assert.equal(unsure.status, 400);
  assert.match(unsure.body.error, /installation_id/);

  const live = await h.api.get(`/api/premises/${hotspot.id}/current`, { as: world.tech });
  const second = live.body.installations[1];

  const done = await replace(hotspot.id, {
    new_item_instance_id: units[2].id,
    removal_reason: 'faulty',
    installation_id: second.installation_id,
  });
  assert.equal(done.status, 201);

  // The other router is untouched, and the third now stands in for the second.
  const after = await h.api.get(`/api/premises/${hotspot.id}/current`, { as: world.tech });
  const serials = after.body.installations.map((r) => r.serial_number).sort();
  assert.deepEqual(serials, ['H-1', 'H-3']);
});

test('a router from another premises cannot be named in a replacement', async () => {
  const hotspot = await makeHotspot();
  await install(hotspot.id, units[0]);
  await install(world.premises.id, units[1]);
  const elsewhere = await h.db.query(
    'SELECT id FROM installations WHERE customer_premises_id = $1',
    [world.premises.id]
  );

  const res = await replace(hotspot.id, {
    new_item_instance_id: units[2].id,
    removal_reason: 'faulty',
    installation_id: elsewhere.rows[0].id,
  });
  assert.equal(res.status, 404);
});

test('a hotspot with several routers cannot become PPPoE', async () => {
  const hotspot = await makeHotspot();
  await install(hotspot.id, units[0]);
  await install(hotspot.id, units[1]);

  const res = await patch(hotspot.id, { connection_type: 'pppoe' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /2 routers/);
});

test('a hotspot’s extra routers are additions, not replacements', async () => {
  const hotspot = await makeHotspot();
  await install(hotspot.id, units[0]);
  await install(hotspot.id, units[1]);

  const history = await h.api.get(`/api/premises/${hotspot.id}/history`, { as: world.tech });
  assert.equal(history.body.total_routers, 2);
  assert.equal(history.body.replacement_count, 0);
});

// --- Former clients and deletion ------------------------------------------

test('an admin can delete a premises that has no history', async () => {
  const fresh = (await create({ landmark: 'Added by mistake', site_id: bungoma })).body.premises;

  const res = await h.api.delete(`/api/premises/${fresh.id}`, { as: world.admin });
  assert.equal(res.status, 200);

  const gone = await h.api.get(`/api/premises/${fresh.id}`, { as: world.admin });
  assert.equal(gone.status, 404);
});

test('only an admin can delete a premises', async () => {
  const fresh = (await create({ landmark: 'Added by mistake', site_id: bungoma })).body.premises;
  for (const as of [world.staff, world.pm, world.tech]) {
    const res = await h.api.delete(`/api/premises/${fresh.id}`, { as });
    assert.equal(res.status, 403);
  }
});

test('a premises with history is not deleted — it is marked a former client', async () => {
  await install(world.premises.id, units[0]);

  const refused = await h.api.delete(`/api/premises/${world.premises.id}`, { as: world.admin });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /former client/);

  const retired = await patch(world.premises.id, { is_active: false });
  assert.equal(retired.status, 200);
  assert.equal(retired.body.premises.is_active, false);
});

test('a former client leaves the lists, but the record is still there', async () => {
  const gone = (await create({ landmark: 'Left us', village: 'Nasianda', site_id: bungoma }))
    .body.premises;
  await patch(gone.id, { is_active: false });

  const list = await h.api.get(`/api/premises?site_id=${bungoma}`, { as: world.staff });
  assert.ok(!list.body.premises.some((p) => p.id === gone.id));

  const search = await h.api.get('/api/premises/search?q=Nasianda', { as: world.staff });
  assert.equal(search.body.results.length, 0);

  const withFormer = await h.api.get(`/api/premises?site_id=${bungoma}&include_inactive=true`, {
    as: world.staff,
  });
  assert.ok(withFormer.body.premises.some((p) => p.id === gone.id));

  const direct = await h.api.get(`/api/premises/${gone.id}`, { as: world.staff });
  assert.equal(direct.status, 200);
});

test('nothing new can be started at a former client', async () => {
  await patch(world.premises.id, { is_active: false });

  const job = await h.api.post('/api/work-orders', {
    as: world.tech,
    body: { customer_premises_id: world.premises.id, type: 'repair' },
  });
  assert.equal(job.status, 409);

  const fit = await install(world.premises.id, units[0]);
  assert.equal(fit.status, 409);

  // Reinstated, it works again.
  await patch(world.premises.id, { is_active: true });
  assert.equal((await install(world.premises.id, units[0])).status, 201);
});

test('a field tech cannot mark a premises a former client', async () => {
  const res = await patch(world.premises.id, { is_active: false }, world.tech);
  assert.equal(res.status, 403);
});
