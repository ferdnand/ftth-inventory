// Test harness.
//
// Runs against a REAL Postgres, because everything worth testing here is a
// database invariant: a partial unique index, a FOR UPDATE row lock, a CHECK
// constraint. A mocked pg would only test the mock.
//
// TEST_DATABASE_URL must be set and must differ from DATABASE_URL — the suite
// truncates every table between tests, so pointing it at the development
// database would silently delete your data.
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  console.error(
    '\nTEST_DATABASE_URL is not set. Create a throwaway database and add it to apps/api/.env:\n' +
      '  createdb ftth_inventory_test\n' +
      '  TEST_DATABASE_URL=postgres://user:password@localhost:5432/ftth_inventory_test\n'
  );
  process.exit(1);
}
if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
  console.error(
    '\nTEST_DATABASE_URL is the same as DATABASE_URL. The suite truncates every ' +
      'table, so it refuses to run against your development database.\n'
  );
  process.exit(1);
}

// Point the app's own modules at the test database before any of them load and
// build their pool from env.DATABASE_URL.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const db = require('../src/lib/db');
const app = require('../src/app');
const { up } = require('../db/migrate');

// Order matters: children before parents.
const TABLES = [
  'transactions',
  'installation_services',
  'installations',
  'restock_request_lines',
  'restock_requests',
  'work_orders',
  'item_instances',
  'stock_levels',
  'customer_premises',
  'items',
  'services',
  'locations',
  'users',
];

let migrated = false;

async function migrateOnce() {
  if (migrated) return;
  await up();
  migrated = true;
}

async function reset() {
  await migrateOnce();
  await db.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

async function close() {
  await db.pool.end();
}

// --- Fixtures -------------------------------------------------------------

const PASSWORD = 'test-password';
let passwordHash;

async function hashedPassword() {
  if (!passwordHash) passwordHash = await bcrypt.hash(PASSWORD, 4); // low cost: speed
  return passwordHash;
}

async function createUser({ name, email, role, assignedLocationId = null, isActive = true }) {
  const result = await db.query(
    `INSERT INTO users (name, email, role, password_hash, assigned_location_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, email, role, await hashedPassword(), assignedLocationId, isActive]
  );
  return result.rows[0];
}

async function createLocation({ name, type, techId = null }) {
  const result = await db.query(
    'INSERT INTO locations (name, type, tech_id) VALUES ($1, $2, $3) RETURNING *',
    [name, type, techId]
  );
  return result.rows[0];
}

async function createItem({
  name,
  category = 'ONT',
  trackingType = 'serialized',
  unitOfMeasure = 'unit',
  reorderThreshold = null,
}) {
  const result = await db.query(
    `INSERT INTO items (name, category, tracking_type, unit_of_measure, reorder_threshold)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, category, trackingType, unitOfMeasure, reorderThreshold]
  );
  return result.rows[0];
}

async function createService({ name, unitOfMeasure = 'job', isActive = true }) {
  const result = await db.query(
    `INSERT INTO services (name, unit_of_measure, is_active)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, unitOfMeasure, isActive]
  );
  return result.rows[0];
}

async function createInstance({ itemId, serial, mac = null, status = 'in_stock', locationId = null }) {
  const result = await db.query(
    `INSERT INTO item_instances (item_id, serial_number, mac_address, status, current_location_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [itemId, serial, mac, status, locationId]
  );
  return result.rows[0];
}

async function setStock({ itemId, locationId, quantity }) {
  const result = await db.query(
    `INSERT INTO stock_levels (item_id, location_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (item_id, location_id) DO UPDATE SET quantity = $3
     RETURNING *`,
    [itemId, locationId, quantity]
  );
  return result.rows[0];
}

async function getStock({ itemId, locationId }) {
  const result = await db.query(
    'SELECT quantity FROM stock_levels WHERE item_id = $1 AND location_id = $2',
    [itemId, locationId]
  );
  return result.rows[0] ? Number(result.rows[0].quantity) : null;
}

async function createPremises(address = '1 Test Road') {
  const result = await db.query(
    'INSERT INTO customer_premises (address) VALUES ($1) RETURNING *',
    [address]
  );
  return result.rows[0];
}

// A complete, minimal world: a warehouse, a van with a tech, a bulk item and a
// serialized item, and one premises. Most tests only need this.
async function seedWorld() {
  const warehouse = await createLocation({ name: 'Warehouse', type: 'warehouse' });
  const tech = await createUser({
    name: 'Test Tech',
    email: 'tech@test.local',
    role: 'field_tech',
  });
  const van = await createLocation({ name: 'Van 1', type: 'tech_van', techId: tech.id });
  await db.query('UPDATE users SET assigned_location_id = $1 WHERE id = $2', [van.id, tech.id]);
  tech.assigned_location_id = van.id;

  const staff = await createUser({
    name: 'Test Staff',
    email: 'staff@test.local',
    role: 'warehouse_staff',
    assignedLocationId: warehouse.id,
  });
  const pm = await createUser({ name: 'Test PM', email: 'pm@test.local', role: 'pm' });

  const ont = await createItem({ name: 'Test ONT', trackingType: 'serialized', reorderThreshold: 2 });
  const cable = await createItem({
    name: 'Test Cable',
    category: 'Cable',
    trackingType: 'bulk',
    unitOfMeasure: 'meter',
    reorderThreshold: 100,
  });

  const premises = await createPremises();

  return { warehouse, van, tech, staff, pm, ont, cable, premises };
}

// --- HTTP -----------------------------------------------------------------

const jwt = require('jsonwebtoken');
const env = require('../src/lib/env');

function tokenFor(user) {
  return jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: '1h' });
}

// Drives the real Express app over a real socket on an ephemeral port, so
// middleware order, the 404 handler and the error handler are all exercised.
let server;
let baseUrl;

async function startServer() {
  if (server) return baseUrl;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
  baseUrl = null;
}

async function request(method, path, { as, body, token } = {}) {
  const url = (await startServer()) + path;
  const authToken = token ?? (as ? tokenFor(as) : null);

  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, opts) => request('POST', path, opts),
  patch: (path, opts) => request('PATCH', path, opts),
  put: (path, opts) => request('PUT', path, opts),
};

const uniqueKey = () => crypto.randomUUID();

module.exports = {
  db,
  app,
  api,
  request,
  tokenFor,
  reset,
  close,
  startServer,
  stopServer,
  PASSWORD,
  createUser,
  createLocation,
  createItem,
  createInstance,
  createService,
  createPremises,
  setStock,
  getStock,
  seedWorld,
  uniqueKey,
};
