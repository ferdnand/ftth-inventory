require('dotenv').config();
const db = require('../src/lib/db');

async function seed() {
  // Users
  const users = await db.query(`
    INSERT INTO users (name, email, role) VALUES
      ('John Kamau', 'john.kamau@ftth.local', 'field_tech'),
      ('Mary Otieno', 'mary.otieno@ftth.local', 'field_tech'),
      ('Sarah Wanjiru', 'sarah.wanjiru@ftth.local', 'field_tech'),
      ('Grace Njeri', 'grace.njeri@ftth.local', 'warehouse_staff'),
      ('Peter Mwangi', 'peter.mwangi@ftth.local', 'pm')
    RETURNING id, name
  `);
  const johnId = users.rows.find(u => u.name === 'John Kamau').id;
  console.log('Seeded users:', users.rows.length);

  // Locations
  const warehouse = await db.query(`
    INSERT INTO locations (name, type) VALUES ('Central Warehouse - Nairobi', 'warehouse')
    RETURNING id
  `);
  const van = await db.query(`
    INSERT INTO locations (name, type, tech_id) VALUES ('Tech Van JK-04', 'tech_van', $1)
    RETURNING id
  `, [johnId]);
  console.log('Seeded locations');

  // Items catalog
  const items = await db.query(`
    INSERT INTO items (name, category, tracking_type, unit_of_measure, manufacturer, model, reorder_threshold) VALUES
      ('ONT HG8245Q2', 'ONT', 'serialized', 'unit', 'Huawei', 'HG8245Q2', 5),
      ('ONT F663N', 'ONT', 'serialized', 'unit', 'ZTE', 'F663N', 5),
      ('Media Converter 1G SFP', 'Media Converter', 'serialized', 'unit', 'Generic', 'SFP-1G', 3),
      ('Drop Cable 1-core', 'Cable', 'bulk', 'meter', 'Generic', NULL, 100),
      ('Heat-shrink Sleeves', 'Consumable', 'bulk', 'unit', 'Generic', NULL, 20),
      ('Fast Connector SC/APC', 'Connector', 'bulk', 'unit', 'Generic', NULL, 15)
    RETURNING id, name
  `);
  const ontHwId = items.rows.find(i => i.name === 'ONT HG8245Q2').id;
  const dropCableId = items.rows.find(i => i.name === 'Drop Cable 1-core').id;
  const heatShrinkId = items.rows.find(i => i.name === 'Heat-shrink Sleeves').id;
  const connectorId = items.rows.find(i => i.name === 'Fast Connector SC/APC').id;
  console.log('Seeded items:', items.rows.length);

  // Serialized item instances - some in the van, one already installed
  const instances = await db.query(`
    INSERT INTO item_instances (item_id, serial_number, mac_address, status, current_location_id) VALUES
      ($1, 'HW8245Q2-991A', 'F0:9E:63:22:8B:C1', 'in_stock', $2),
      ($1, 'HW8245Q2-991B', 'F0:9E:63:22:8B:C2', 'in_stock', $2)
    RETURNING id, serial_number
  `, [ontHwId, van.rows[0].id]);
  console.log('Seeded item instances:', instances.rows.length);

  // Bulk stock in the van
  await db.query(`
    INSERT INTO stock_levels (item_id, location_id, quantity) VALUES
      ($1, $4, 180),
      ($2, $4, 6),
      ($3, $4, 22)
  `, [dropCableId, heatShrinkId, connectorId, van.rows[0].id]);
  console.log('Seeded stock levels');

  // Customer premises
  const premises = await db.query(`
    INSERT INTO customer_premises (address, customer_account_id) VALUES
      ('14B Ngong Road, Nairobi', 'KE-77291')
    RETURNING id
  `);
  console.log('Seeded premises:', premises.rows[0].id);

  // Pre-existing router at that address (already installed, active)
  const existingInstance = await db.query(`
    INSERT INTO item_instances (item_id, serial_number, mac_address, status) VALUES
      ($1, 'ZTE60912F7A3B', 'A4:B1:C2:3D:44:5E', 'installed')
    RETURNING id
  `, [items.rows.find(i => i.name === 'ONT F663N').id]);

  await db.query(`
    INSERT INTO installations (customer_premises_id, item_instance_id, installed_by, installed_at) VALUES
      ($1, $2, $3, now() - interval '4 months')
  `, [premises.rows[0].id, existingInstance.rows[0].id, johnId]);
  console.log('Seeded active installation at premises', premises.rows[0].id);

  console.log('\n--- Reference IDs for smoke testing ---');
  console.log('van_location_id:', van.rows[0].id);
  console.log('premises_id:', premises.rows[0].id);
  console.log('john_kamau_user_id:', johnId);
  console.log('new_ont_instance_id (in van, ready to install):', instances.rows[0].id);

  await db.pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
