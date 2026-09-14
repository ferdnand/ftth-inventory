const bcrypt = require('bcryptjs');
const db = require('../src/lib/db');

// Every seeded user gets the same throwaway password so the tutorial can show
// one login for any role. Fine for a local development database; a real
// deployment creates its first admin with db/create-admin.js and everyone else
// through POST /api/users, with real passwords.
const DEV_PASSWORD = 'ftth-dev-password';

async function seed() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  // Users
  const users = await db.query(
    `
    INSERT INTO users (name, email, role, password_hash) VALUES
      ('John Kamau', 'john.kamau@ftth.local', 'field_tech', $1),
      ('Mary Otieno', 'mary.otieno@ftth.local', 'field_tech', $1),
      ('Sarah Wanjiru', 'sarah.wanjiru@ftth.local', 'field_tech', $1),
      ('Grace Njeri', 'grace.njeri@ftth.local', 'warehouse_staff', $1),
      ('Peter Mwangi', 'peter.mwangi@ftth.local', 'pm', $1),
      ('Alice Wambui', 'alice.wambui@ftth.local', 'admin', $1)
    RETURNING id, name
  `,
    [passwordHash]
  );
  const johnId = users.rows.find((u) => u.name === 'John Kamau').id;
  const maryId = users.rows.find((u) => u.name === 'Mary Otieno').id;
  const graceId = users.rows.find((u) => u.name === 'Grace Njeri').id;
  console.log('Seeded users:', users.rows.length);

  // Locations. The two sites are created by
  // 011_sites_and_premises_capture.sql, not here — they are operational
  // reference data, not a development fixture — so this looks them up.
  const warehouse = await db.query(`
    INSERT INTO locations (name, type) VALUES ('Central Warehouse - Bungoma', 'warehouse')
    RETURNING id
  `);
  const sites = await db.query(
    `SELECT id, name FROM locations WHERE type = 'site' ORDER BY name`
  );
  const siteId = (name) => sites.rows.find((s) => s.name === name)?.id ?? null;
  if (sites.rows.length === 0) {
    throw new Error('No sites found — run `npm run migrate` before seeding');
  }

  const van = await db.query(
    `
    INSERT INTO locations (name, type, tech_id) VALUES ('Tech Van JK-04', 'tech_van', $1)
    RETURNING id
  `,
    [johnId]
  );
  const maryVan = await db.query(
    `
    INSERT INTO locations (name, type, tech_id) VALUES ('Tech Van MO-02', 'tech_van', $1)
    RETURNING id
  `,
    [maryId]
  );
  console.log('Seeded locations, alongside sites:', sites.rows.map((s) => s.name).join(', '));

  // The mobile app finds "my stock" through the tech's assigned_location_id, so
  // a tech without one sees an empty van however much stock is really there.
  await db.query('UPDATE users SET assigned_location_id = $1 WHERE id = $2', [
    van.rows[0].id,
    johnId,
  ]);
  await db.query('UPDATE users SET assigned_location_id = $1 WHERE id = $2', [
    maryVan.rows[0].id,
    maryId,
  ]);
  await db.query('UPDATE users SET assigned_location_id = $1 WHERE id = $2', [
    warehouse.rows[0].id,
    graceId,
  ]);

  // Items catalog, with costs in KES so the job totals in the tutorial are not
  // all zero. Real figures come from the warehouse, through the dashboard.
  const items = await db.query(`
    INSERT INTO items (name, category, tracking_type, unit_of_measure, manufacturer, model, reorder_threshold, unit_cost) VALUES
      ('ONT HG8245Q2', 'ONT', 'serialized', 'unit', 'Huawei', 'HG8245Q2', 5, 4200),
      ('ONT F663N', 'ONT', 'serialized', 'unit', 'ZTE', 'F663N', 5, 3800),
      ('Media Converter 1G SFP', 'Media Converter', 'serialized', 'unit', 'Generic', 'SFP-1G', 3, 2600),
      ('Drop Cable 1-core', 'Cable', 'bulk', 'meter', 'Generic', NULL, 100, 22),
      ('Heat-shrink Sleeves', 'Consumable', 'bulk', 'unit', 'Generic', NULL, 20, 15),
      ('Fast Connector SC/APC', 'Connector', 'bulk', 'unit', 'Generic', NULL, 15, 60)
    RETURNING id, name
  `);
  const ontHwId = items.rows.find((i) => i.name === 'ONT HG8245Q2').id;
  const dropCableId = items.rows.find((i) => i.name === 'Drop Cable 1-core').id;
  const heatShrinkId = items.rows.find((i) => i.name === 'Heat-shrink Sleeves').id;
  const connectorId = items.rows.find((i) => i.name === 'Fast Connector SC/APC').id;
  console.log('Seeded items:', items.rows.length);

  // Billable labour, with rates. 007 moved these out of `items`; the field
  // catalog's list is created by 006/007 on a migrated database, so these are
  // the development fixtures with prices on them.
  const services = await db.query(`
    INSERT INTO services (name, unit_of_measure, unit_rate, description) VALUES
      ('Splicing', 'job', 500, 'One fusion splice, including the sleeve'),
      ('Cable Run', 'meter', 15, 'Pulling and dressing drop cable'),
      ('PPPoE Client Setup', 'job', 300, 'Router configured against the billing system')
    ON CONFLICT (name) DO UPDATE SET unit_rate = EXCLUDED.unit_rate
    RETURNING id, name
  `);
  const splicingId = services.rows.find((s) => s.name === 'Splicing').id;
  const cableRunId = services.rows.find((s) => s.name === 'Cable Run').id;
  console.log('Seeded services:', services.rows.length);

  // Serialized item instances - some in the van, one already installed
  const instances = await db.query(
    `
    INSERT INTO item_instances (item_id, serial_number, mac_address, status, current_location_id) VALUES
      ($1, 'HW8245Q2-991A', 'F0:9E:63:22:8B:C1', 'in_stock', $2),
      ($1, 'HW8245Q2-991B', 'F0:9E:63:22:8B:C2', 'in_stock', $2)
    RETURNING id, serial_number
  `,
    [ontHwId, van.rows[0].id]
  );
  console.log('Seeded item instances:', instances.rows.length);

  // Warehouse stock, so a transfer or a restock request has something to draw on
  await db.query(
    `
    INSERT INTO stock_levels (item_id, location_id, quantity) VALUES
      ($1, $4, 2400),
      ($2, $4, 500),
      ($3, $4, 800)
  `,
    [dropCableId, heatShrinkId, connectorId, warehouse.rows[0].id]
  );

  // Bulk stock in the van. Heat-shrink sleeves are deliberately below their
  // reorder threshold of 20, so the low-stock treatment has something to show.
  await db.query(
    `
    INSERT INTO stock_levels (item_id, location_id, quantity) VALUES
      ($1, $4, 180),
      ($2, $4, 6),
      ($3, $4, 22)
  `,
    [dropCableId, heatShrinkId, connectorId, van.rows[0].id]
  );
  console.log('Seeded stock levels');

  // Customer premises. Three shapes on purpose, because all three are real:
  //   - an addressed premises, the way the old schema assumed every one was
  //   - a household in its own compound, found by GPS and a landmark, which is
  //     what most of Bungoma and Kisumu actually looks like
  //   - a business, captured with a phone number and no address
  const premises = await db.query(
    `
    INSERT INTO customer_premises
      (address, customer_account_id, customer_name, customer_phone, village, landmark,
       premises_type, site_id, gps_lat, gps_lng, gps_accuracy_m, gps_captured_at, created_by)
    VALUES
      ('14B Kanduyi Road, Bungoma', 'KE-77291', 'Wanyonyi Enterprises', '0722114455',
       'Kanduyi', NULL, 'business', $1, 0.5692, 34.5601, 12, now(), $3),
      (NULL, NULL, 'Nekesa Wanyonyi', '0733123456',
       'Nasianda', 'Third compound past the borehole', 'household', $1,
       0.5635, 34.5606, 8, now(), $3),
      (NULL, NULL, 'Otieno Ochieng', '0711998877',
       'Kadibo', 'Behind the maize store', 'household', $2,
       -0.0917, 34.7679, 6, now(), $4)
    RETURNING id, customer_name
  `,
    [siteId('Bungoma'), siteId('Kisumu'), johnId, maryId]
  );
  const businessPremisesId = premises.rows[0].id;
  const householdPremisesId = premises.rows[1].id;
  console.log('Seeded premises:', premises.rows.length);

  // A completed job at the addressed premises, with everything a job can carry:
  // the router fitted, the materials consumed, the labour, and the fare that
  // got the tech there. This is what the cost report reads.
  const job = await db.query(
    `
    INSERT INTO work_orders
      (customer_premises_id, type, status, assigned_tech_id, created_by,
       performed_on, completed_at, notes)
    VALUES ($1, 'new_install', 'completed', $2, $2,
            (now() - interval '4 months')::date, now() - interval '4 months',
            'First connection at the shop')
    RETURNING id
  `,
    [businessPremisesId, johnId]
  );
  const jobId = job.rows[0].id;

  const existingInstance = await db.query(
    `
    INSERT INTO item_instances (item_id, serial_number, mac_address, status) VALUES
      ($1, 'ZTE60912F7A3B', 'A4:B1:C2:3D:44:5E', 'installed')
    RETURNING id
  `,
    [items.rows.find((i) => i.name === 'ONT F663N').id]
  );

  await db.query(
    `
    INSERT INTO installations
      (customer_premises_id, item_instance_id, installed_by, installed_at, work_order_id)
    VALUES ($1, $2, $3, now() - interval '4 months', $4)
  `,
    [businessPremisesId, existingInstance.rows[0].id, johnId, jobId]
  );

  await db.query(
    `
    INSERT INTO job_materials
      (work_order_id, item_id, quantity, unit_cost, from_location_id, recorded_by)
    VALUES
      ($1, $2, 65, 22, $5, $6),
      ($1, $3, 4, 15, $5, $6),
      ($1, $4, 2, 60, $5, $6)
  `,
    [jobId, dropCableId, heatShrinkId, connectorId, van.rows[0].id, johnId]
  );

  await db.query(
    `
    INSERT INTO job_services (work_order_id, service_id, quantity, unit_rate) VALUES
      ($1, $2, 1, 500),
      ($1, $3, 65, 15)
  `,
    [jobId, splicingId, cableRunId]
  );

  await db.query(
    `
    INSERT INTO job_expenses (work_order_id, category, amount, description, recorded_by) VALUES
      ($1, 'transport', 400, 'Boda from Kanduyi and back', $2)
  `,
    [jobId, johnId]
  );
  console.log('Seeded a completed job with materials, labour and expenses:', jobId);

  // An open job dispatched to John, so the field app has something in its list.
  const openJob = await db.query(
    `
    INSERT INTO work_orders
      (customer_premises_id, type, status, assigned_tech_id, created_by, scheduled_date, notes)
    VALUES ($1, 'new_install', 'open', $2, $3, current_date, 'Customer asked for a Friday visit')
    RETURNING id
  `,
    [householdPremisesId, johnId, graceId]
  );

  console.log('\n--- Reference IDs for smoke testing ---');
  console.log('warehouse_location_id:', warehouse.rows[0].id);
  console.log('van_location_id:', van.rows[0].id);
  console.log('bungoma_site_id:', siteId('Bungoma'));
  console.log('kisumu_site_id:', siteId('Kisumu'));
  console.log('addressed_premises_id:', businessPremisesId);
  console.log('gps_only_premises_id:', householdPremisesId);
  console.log('completed_job_id:', jobId);
  console.log('open_job_id:', openJob.rows[0].id);
  console.log('john_kamau_user_id:', johnId);
  console.log('new_ont_instance_id (in van, ready to install):', instances.rows[0].id);
  console.log('\n--- Sign in with ---');
  console.log('field tech:       john.kamau@ftth.local');
  console.log('warehouse staff:  grace.njeri@ftth.local');
  console.log('project manager:  peter.mwangi@ftth.local');
  console.log('administrator:    alice.wambui@ftth.local');
  console.log('password (all):  ', DEV_PASSWORD);

  await db.pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
