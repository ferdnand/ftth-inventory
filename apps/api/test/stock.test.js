// The non-negative stock rule and the row lock behind it.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');
const { applyMove } = require('../src/lib/stock');

let world;

before(async () => {
  await h.reset();
});

beforeEach(async () => {
  await h.reset();
  world = await h.seedWorld();
});

after(async () => {
  await h.stopServer();
  await h.close();
});

test('applyMove transfers between locations', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 500 });

  const client = await h.db.pool.connect();
  try {
    await client.query('BEGIN');
    await applyMove(client, {
      itemId: world.cable.id,
      fromLocationId: world.warehouse.id,
      toLocationId: world.van.id,
      quantity: 120,
    });
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.warehouse.id }), 380);
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.van.id }), 120);
});

test('applyMove creates the destination row on first use', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 50 });
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.van.id }), null);

  const client = await h.db.pool.connect();
  try {
    await client.query('BEGIN');
    await applyMove(client, {
      itemId: world.cable.id,
      fromLocationId: world.warehouse.id,
      toLocationId: world.van.id,
      quantity: 50,
    });
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.van.id }), 50);
});

test('applyMove refuses a decrement larger than what is on hand', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 10 });

  const client = await h.db.pool.connect();
  try {
    await client.query('BEGIN');
    await assert.rejects(
      () =>
        applyMove(client, {
          itemId: world.cable.id,
          fromLocationId: world.warehouse.id,
          quantity: 11,
        }),
      /Not enough stock/
    );
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.warehouse.id }), 10);
});

test('applyMove refuses a decrement from a location that holds nothing', async () => {
  const client = await h.db.pool.connect();
  try {
    await client.query('BEGIN');
    await assert.rejects(
      () =>
        applyMove(client, {
          itemId: world.cable.id,
          fromLocationId: world.van.id,
          quantity: 1,
        }),
      /Not enough stock/
    );
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

// The reason applyMove takes a FOR UPDATE lock. Without it both transactions
// read 100, both decide 60 is available, and the row ends at -20.
//
// Deterministic rather than timing-dependent: A locks the row and holds it,
// B blocks on the same row, A commits, then B's SELECT sees the committed 40.
test('concurrent decrements cannot drive stock negative', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 100 });

  const a = await h.db.pool.connect();
  const b = await h.db.pool.connect();
  try {
    await a.query('BEGIN');
    await b.query('BEGIN');

    await applyMove(a, {
      itemId: world.cable.id,
      fromLocationId: world.warehouse.id,
      quantity: 60,
    });

    // B blocks inside applyMove's SELECT ... FOR UPDATE until A commits.
    const bMove = applyMove(b, {
      itemId: world.cable.id,
      fromLocationId: world.warehouse.id,
      quantity: 60,
    });

    await a.query('COMMIT');

    await assert.rejects(() => bMove, /Not enough stock/);
    await b.query('ROLLBACK');
  } finally {
    a.release();
    b.release();
  }

  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.warehouse.id }), 40);
});

test('the database rejects a negative quantity even if the app rule is bypassed', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 5 });

  await assert.rejects(
    () =>
      h.db.query(
        'UPDATE stock_levels SET quantity = -1 WHERE item_id = $1 AND location_id = $2',
        [world.cable.id, world.warehouse.id]
      ),
    (err) => err.constraint === 'stock_quantity_non_negative'
  );
});

test('POST /api/transactions refuses a transfer that would overdraw the source', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.warehouse.id, quantity: 30 });

  const res = await h.api.post('/api/transactions', {
    as: world.staff,
    body: {
      item_id: world.cable.id,
      quantity: 50,
      from_location_id: world.warehouse.id,
      to_location_id: world.van.id,
      type: 'transfer',
    },
  });

  assert.equal(res.status, 409);
  assert.match(res.body.error, /Not enough stock/);
  assert.equal(await h.getStock({ itemId: world.cable.id, locationId: world.warehouse.id }), 30);
});

test('POST /api/transactions rejects a zero or negative quantity', async () => {
  for (const quantity of [0, -5]) {
    const res = await h.api.post('/api/transactions', {
      as: world.staff,
      body: {
        item_id: world.cable.id,
        quantity,
        to_location_id: world.warehouse.id,
        type: 'receive',
      },
    });
    assert.equal(res.status, 400, `quantity ${quantity} should be rejected`);
  }
});

test('POST /api/transactions rejects both a serial and a quantity', async () => {
  const instance = await h.createInstance({
    itemId: world.ont.id,
    serial: 'SER-1',
    locationId: world.warehouse.id,
  });

  const res = await h.api.post('/api/transactions', {
    as: world.staff,
    body: {
      item_instance_id: instance.id,
      item_id: world.cable.id,
      quantity: 5,
      to_location_id: world.van.id,
      type: 'transfer',
    },
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /not both/);
});

test('POST /api/transactions rejects a bulk quantity for a serialized item', async () => {
  const res = await h.api.post('/api/transactions', {
    as: world.staff,
    body: {
      item_id: world.ont.id,
      quantity: 3,
      to_location_id: world.warehouse.id,
      type: 'receive',
    },
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /serialized/);
});

test('GET /api/stock reports is_low_stock as false, not null, with no threshold set', async () => {
  const noThreshold = await h.createItem({
    name: 'Untracked Consumable',
    category: 'Consumable',
    trackingType: 'bulk',
    reorderThreshold: null,
  });
  await h.setStock({ itemId: noThreshold.id, locationId: world.van.id, quantity: 1 });

  const res = await h.api.get(`/api/stock?location_id=${world.van.id}`, { as: world.staff });
  assert.equal(res.status, 200);

  const row = res.body.bulk.find((r) => r.item_id === noThreshold.id);
  assert.equal(row.is_low_stock, false);
});

test('GET /api/stock flags an item at or below its threshold', async () => {
  await h.setStock({ itemId: world.cable.id, locationId: world.van.id, quantity: 100 });

  const res = await h.api.get(`/api/stock?location_id=${world.van.id}`, { as: world.staff });
  const row = res.body.bulk.find((r) => r.item_id === world.cable.id);
  assert.equal(row.is_low_stock, true);
});

test('GET /api/stock includes reorder_threshold on serialized rows', async () => {
  await h.createInstance({
    itemId: world.ont.id,
    serial: 'SER-2',
    locationId: world.van.id,
  });

  const res = await h.api.get(`/api/stock?location_id=${world.van.id}`, { as: world.staff });
  assert.equal(res.body.serialized.length, 1);
  assert.equal(Number(res.body.serialized[0].reorder_threshold), 2);
});

test('GET /api/stock/summary separates installable units from units awaiting return', async () => {
  await h.createInstance({ itemId: world.ont.id, serial: 'S-A', locationId: world.van.id });
  await h.createInstance({ itemId: world.ont.id, serial: 'S-B', locationId: world.van.id });
  await h.createInstance({
    itemId: world.ont.id,
    serial: 'S-C',
    status: 'faulty',
    locationId: world.van.id,
  });

  const res = await h.api.get(`/api/stock/summary?location_id=${world.van.id}`, {
    as: world.staff,
  });

  assert.equal(res.status, 200);
  const row = res.body.serialized.find((r) => r.item_id === world.ont.id);
  assert.equal(row.installable_count, 2);
  assert.equal(row.to_return_count, 1);
  assert.equal(row.total_count, 3);
  assert.equal(res.body.totals.installable_units, 2);
  assert.equal(res.body.totals.to_return_units, 1);
});
