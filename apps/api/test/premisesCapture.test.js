// Capturing a premises in a place where addresses do not exist.
//
// The rule under test throughout: a premises has to be findable again, and a
// GPS fix counts as findable. An address does not have to.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');

let world;
let bungoma;
let kisumu;

beforeEach(async () => {
  await h.reset();
  world = await h.seedWorld();
  bungoma = await h.siteId('Bungoma');
  kisumu = await h.siteId('Kisumu');
});

after(async () => {
  await h.stopServer();
  await h.close();
});

const create = (body, as = world.tech) => h.api.post('/api/premises', { as, body });
const search = (query, as = world.tech) => h.api.get(`/api/premises/search?${query}`, { as });

// --- The two sites --------------------------------------------------------

test('the migration seeds Bungoma and Kisumu as sites', async () => {
  const res = await h.api.get('/api/locations?type=site', { as: world.staff });
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.locations.map((l) => l.name).sort(),
    ['Bungoma', 'Kisumu']
  );
});

test('a premises cannot be filed under a van instead of a site', async () => {
  const res = await create({ landmark: 'By the dam', site_id: world.van.id });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /is a tech_van, not a site/);
});

// --- What counts as findable ---------------------------------------------

test('a GPS fix and a landmark are enough, with no address at all', async () => {
  const res = await create({
    customer_name: 'Otieno Ochieng',
    customer_phone: '0722000111',
    village: 'Kadibo',
    landmark: 'Behind the maize store',
    premises_type: 'household',
    site_id: kisumu,
    gps_lat: -0.0917,
    gps_lng: 34.7679,
    gps_accuracy_m: 6,
  });

  assert.equal(res.status, 201);
  const premises = res.body.premises;
  assert.equal(premises.address, null);
  assert.equal(premises.site_name, 'Kisumu');
  assert.equal(premises.gps_lat, -0.0917);
  assert.equal(Number(premises.created_by), world.tech.id);
  // The fix was taken now, because the client did not say otherwise.
  assert.ok(premises.gps_captured_at);
});

test('a single household in its own compound is the default kind of premises', async () => {
  const res = await create({ landmark: 'The compound with the blue gate' });
  assert.equal(res.status, 201);
  assert.equal(res.body.premises.premises_type, 'household');
});

test('a premises nobody could find again is refused', async () => {
  const res = await create({ customer_name: 'Someone', customer_phone: '0700000000' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /findable again/);
});

test('the database refuses an unfindable premises even if the app rule is bypassed', async () => {
  await assert.rejects(
    () => h.db.query(`INSERT INTO customer_premises (customer_name) VALUES ('Nobody')`),
    (err) => err.constraint === 'premises_must_be_locatable'
  );
});

// --- Coordinates ----------------------------------------------------------

test('half a GPS fix is refused', async () => {
  const res = await create({ landmark: 'Somewhere', gps_lat: 0.5635 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /together/);
});

test('coordinates outside the world are refused', async () => {
  const lat = await create({ landmark: 'Somewhere', gps_lat: 95, gps_lng: 34 });
  assert.equal(lat.status, 400);
  assert.match(lat.body.error, /between -90 and 90/);

  const lng = await create({ landmark: 'Somewhere', gps_lat: 0.5, gps_lng: 200 });
  assert.equal(lng.status, 400);
  assert.match(lng.body.error, /between -180 and 180/);
});

test('the database refuses half a fix even if the app rule is bypassed', async () => {
  await assert.rejects(
    () =>
      h.db.query(
        `INSERT INTO customer_premises (landmark, gps_lat) VALUES ('Somewhere', 0.5635)`
      ),
    (err) => err.constraint === 'premises_gps_pair_together'
  );
});

// --- Improving a fix ------------------------------------------------------

// A tech who saved a premises indoors on a 200 m fix and walks outside to a 6 m
// one is correcting the most useful field on the record. Making them phone the
// warehouse to do it means it never gets done.
test('a tech may improve the GPS fix but not rewrite the address', async () => {
  const created = await create({
    address: 'Near the market',
    gps_lat: 0.56,
    gps_lng: 34.56,
    gps_accuracy_m: 180,
  });
  const id = created.body.premises.id;

  const better = await h.api.patch(`/api/premises/${id}`, {
    as: world.tech,
    body: { gps_lat: 0.5635, gps_lng: 34.5606, gps_accuracy_m: 6 },
  });
  assert.equal(better.status, 200);
  assert.equal(better.body.premises.gps_accuracy_m, 6);

  const renamed = await h.api.patch(`/api/premises/${id}`, {
    as: world.tech,
    body: { address: 'Somewhere else entirely' },
  });
  assert.equal(renamed.status, 403);
  assert.match(renamed.body.error, /Only the warehouse/);
});

test('a GPS fix can be replaced but not taken away', async () => {
  const created = await create({ landmark: 'By the dam', gps_lat: 0.56, gps_lng: 34.56 });

  const res = await h.api.patch(`/api/premises/${created.body.premises.id}`, {
    as: world.staff,
    body: { gps_lat: null, gps_lng: null },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /cannot be cleared/);
});

// The locatable rule holds on edits too, or the warehouse could clear the one
// field a GPS-less premises was findable by.
test('the warehouse cannot edit a premises into being unfindable', async () => {
  const created = await create({ landmark: 'By the dam' });

  const res = await h.api.patch(`/api/premises/${created.body.premises.id}`, {
    as: world.staff,
    body: { landmark: null },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /findable again/);
});

// --- Finding one again ----------------------------------------------------

test('search finds a premises by name, village, landmark or phone', async () => {
  await create({
    customer_name: 'Nekesa Wanyonyi',
    customer_phone: '0733123456',
    village: 'Nasianda',
    landmark: 'Third compound past the borehole',
    site_id: bungoma,
    gps_lat: 0.5635,
    gps_lng: 34.5606,
  });

  for (const term of ['Nekesa', 'Nasianda', 'borehole', '0733123456', '33123']) {
    const res = await search(`q=${encodeURIComponent(term)}`);
    assert.equal(res.status, 200, term);
    assert.equal(res.body.results.length, 1, `expected a hit for "${term}"`);
  }
});

test('search can be narrowed to one site', async () => {
  await create({ landmark: 'Mill compound', village: 'Nasianda', site_id: bungoma });
  await create({ landmark: 'Mill compound', village: 'Kadibo', site_id: kisumu });

  const all = await search('q=Mill');
  assert.equal(all.body.results.length, 2);

  const narrowed = await search(`q=Mill&site_id=${kisumu}`);
  assert.equal(narrowed.body.results.length, 1);
  assert.equal(narrowed.body.results[0].village, 'Kadibo');
});

// Under two characters the API answers with a hint and a 200, which both
// clients render as "keep typing". Do not turn this into a 400.
test('a one-character search is a hint, not an error', async () => {
  const res = await search('q=N');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, []);
  assert.match(res.body.hint, /2 characters/);
});

// A compound recorded as a pin and a landmark is invisible to a search box the
// tech has nothing to type into, so the list has to exist.
test('a site can be browsed without searching', async () => {
  await create({ landmark: 'By the dam', site_id: bungoma });
  await create({ landmark: 'By the school', site_id: bungoma });
  await create({ landmark: 'By the lake', site_id: kisumu });

  const res = await h.api.get(`/api/premises?site_id=${bungoma}`, { as: world.tech });
  assert.equal(res.status, 200);
  // The two just made, plus the fixture premises the helper files under Bungoma.
  assert.equal(res.body.premises.length, 3);
  assert.ok(res.body.premises.every((p) => p.site_id === bungoma));
});

// --- Labelling ------------------------------------------------------------

// Three clients need to title a screen for a premises that may have no
// address. Doing it in each of them separately is how two of them end up
// showing "Premises 41" for a house with a perfectly good landmark.
test('the API says what to call a premises, however little it knows', async () => {
  const withAddress = await create({ address: '14B Ngong Road', village: 'Nairobi' });
  assert.equal(withAddress.body.premises.label, '14B Ngong Road, Nairobi');

  const withLandmark = await create({ landmark: 'By the dam', village: 'Nasianda' });
  assert.equal(withLandmark.body.premises.label, 'By the dam, Nasianda');

  const pinOnly = await create({ gps_lat: 0.5635, gps_lng: 34.5606 });
  assert.equal(pinOnly.body.premises.label, 'Pin at 0.56350, 34.56060');
});
