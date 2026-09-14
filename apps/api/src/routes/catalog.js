const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, notFound } = require('../lib/errors');
const {
  requireFields,
  oneOf,
  intId,
  optionalIntId,
  optionalNumber,
  nonEmptyString,
  optionalString,
  optionalBoolean,
} = require('../lib/validate');
const { TRACKING_TYPES, LOCATION_TYPES } = require('../lib/constants');
const { requireRole } = require('../middleware/auth');

// ------------------------------------------------------------
// Items (catalog)
// ------------------------------------------------------------

// GET /api/items?include_inactive=true
router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const includeInactive = optionalBoolean(req.query.include_inactive, 'include_inactive');
    const where = includeInactive ? '' : 'WHERE is_active = TRUE';
    const result = await db.query(`SELECT * FROM items ${where} ORDER BY category, name`);
    res.json({ items: result.rows });
  })
);

// POST /api/items
// body: { name, category, tracking_type, unit_of_measure,
//         manufacturer?, model?, reorder_threshold?, unit_cost? }
//
// unit_cost is the standard cost per unit_of_measure in KES, and it is what
// makes a job total mean anything: a job line copies it at the time the work is
// recorded (see lib/jobLines.js), so setting it later prices future jobs and
// leaves past ones alone.
router.post(
  '/items',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['name', 'category', 'tracking_type', 'unit_of_measure']);

    const name = nonEmptyString(req.body.name, 'name', 200);
    const category = nonEmptyString(req.body.category, 'category', 100);
    const trackingType = oneOf(req.body.tracking_type, TRACKING_TYPES, 'tracking_type');
    const unitOfMeasure = nonEmptyString(req.body.unit_of_measure, 'unit_of_measure', 50);
    const manufacturer = optionalString(req.body.manufacturer, 'manufacturer', 200);
    const model = optionalString(req.body.model, 'model', 200);
    const reorderThreshold = optionalNumber(req.body.reorder_threshold, 'reorder_threshold');
    const unitCost = optionalNumber(req.body.unit_cost, 'unit_cost');

    if (reorderThreshold !== null && reorderThreshold < 0) {
      throw badRequest('reorder_threshold cannot be negative');
    }
    if (unitCost !== null && unitCost < 0) {
      throw badRequest('unit_cost cannot be negative');
    }

    const result = await db.query(
      `INSERT INTO items
        (name, category, tracking_type, unit_of_measure, manufacturer, model,
         reorder_threshold, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        name,
        category,
        trackingType,
        unitOfMeasure,
        manufacturer,
        model,
        reorderThreshold,
        unitCost,
      ]
    );
    res.status(201).json({ item: result.rows[0] });
  })
);

// PATCH /api/items/:id
// tracking_type is deliberately not editable: flipping it would orphan every
// existing instance or stock level for the item.
router.patch(
  '/items/:id',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const sets = [];
    const params = [];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (req.body.name !== undefined) set('name', nonEmptyString(req.body.name, 'name', 200));
    if (req.body.category !== undefined) {
      set('category', nonEmptyString(req.body.category, 'category', 100));
    }
    if (req.body.unit_of_measure !== undefined) {
      set('unit_of_measure', nonEmptyString(req.body.unit_of_measure, 'unit_of_measure', 50));
    }
    if (req.body.manufacturer !== undefined) {
      set('manufacturer', optionalString(req.body.manufacturer, 'manufacturer', 200));
    }
    if (req.body.model !== undefined) set('model', optionalString(req.body.model, 'model', 200));
    if (req.body.reorder_threshold !== undefined) {
      set('reorder_threshold', optionalNumber(req.body.reorder_threshold, 'reorder_threshold'));
    }
    if (req.body.unit_cost !== undefined) {
      // Re-pricing changes what the NEXT job costs. Lines already written keep
      // the figure they copied, which is why this is safe to correct freely.
      set('unit_cost', optionalNumber(req.body.unit_cost, 'unit_cost'));
    }
    if (req.body.is_active !== undefined) {
      set('is_active', optionalBoolean(req.body.is_active, 'is_active'));
    }

    if (sets.length === 0) throw badRequest('No editable fields were provided');
    if (req.body.tracking_type !== undefined) {
      throw badRequest(
        'tracking_type cannot be changed after an item is created — create a new item instead'
      );
    }

    params.push(id);
    const result = await db.query(
      `UPDATE items SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) throw notFound('Item not found');
    res.json({ item: result.rows[0] });
  })
);

// ------------------------------------------------------------
// Services (billable labour)
// ------------------------------------------------------------
// Deliberately thinner than items: a service has no tracking_type, no
// manufacturer and no reorder threshold, because there is nothing on hand to
// count. See 007_services.sql.

// GET /api/services?include_inactive=true
router.get(
  '/services',
  asyncHandler(async (req, res) => {
    const includeInactive = optionalBoolean(req.query.include_inactive, 'include_inactive');
    const where = includeInactive ? '' : 'WHERE is_active = TRUE';
    const result = await db.query(`SELECT * FROM services ${where} ORDER BY name`);
    res.json({ services: result.rows });
  })
);

// POST /api/services
// body: { name, unit_of_measure, description?, unit_rate? }
router.post(
  '/services',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['name', 'unit_of_measure']);

    const name = nonEmptyString(req.body.name, 'name', 200);
    const unitOfMeasure = nonEmptyString(req.body.unit_of_measure, 'unit_of_measure', 50);
    const description = optionalString(req.body.description, 'description', 1000);
    const unitRate = optionalNumber(req.body.unit_rate, 'unit_rate');

    if (unitRate !== null && unitRate < 0) {
      throw badRequest('unit_rate cannot be negative');
    }

    const result = await db.query(
      `INSERT INTO services (name, unit_of_measure, description, unit_rate)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [name, unitOfMeasure, description, unitRate]
    );
    res.status(201).json({ service: result.rows[0] });
  })
);

// PATCH /api/services/:id
router.patch(
  '/services/:id',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const sets = [];
    const params = [];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (req.body.name !== undefined) set('name', nonEmptyString(req.body.name, 'name', 200));
    if (req.body.unit_of_measure !== undefined) {
      set('unit_of_measure', nonEmptyString(req.body.unit_of_measure, 'unit_of_measure', 50));
    }
    if (req.body.description !== undefined) {
      set('description', optionalString(req.body.description, 'description', 1000));
    }
    if (req.body.unit_rate !== undefined) {
      set('unit_rate', optionalNumber(req.body.unit_rate, 'unit_rate'));
    }
    if (req.body.is_active !== undefined) {
      set('is_active', optionalBoolean(req.body.is_active, 'is_active'));
    }

    if (sets.length === 0) throw badRequest('No editable fields were provided');

    params.push(id);
    const result = await db.query(
      `UPDATE services SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) throw notFound('Service not found');
    res.json({ service: result.rows[0] });
  })
);

// ------------------------------------------------------------
// Locations
// ------------------------------------------------------------

// GET /api/locations?type=warehouse
router.get(
  '/locations',
  asyncHandler(async (req, res) => {
    const type = req.query.type
      ? oneOf(req.query.type, LOCATION_TYPES, 'type')
      : null;

    const result = await db.query(
      `SELECT l.*, u.name AS tech_name
       FROM locations l
       LEFT JOIN users u ON u.id = l.tech_id
       ${type ? 'WHERE l.type = $1' : ''}
       ORDER BY l.type, l.name`,
      type ? [type] : []
    );
    res.json({ locations: result.rows });
  })
);

// The pairing rule between a location's type and its tech, shared by POST and
// PATCH so a van cannot lose its tech through the edit path.
async function assertTechSuitable(type, techId) {
  // A van without a tech is unreachable: the mobile app finds "my stock" by
  // the tech's assigned_location_id.
  if (type === 'tech_van' && !techId) {
    throw badRequest('tech_id is required for a tech_van location');
  }
  if (type !== 'tech_van' && techId) {
    throw badRequest('tech_id only applies to a tech_van location');
  }
  if (!techId) return;

  const tech = await db.query('SELECT id, role FROM users WHERE id = $1', [techId]);
  if (tech.rows.length === 0) throw notFound('tech_id does not match a user');
  if (tech.rows[0].role !== 'field_tech') {
    throw badRequest('tech_id must reference a user with the field_tech role');
  }
}

// POST /api/locations
// body: { name, type, tech_id?, address? }
router.post(
  '/locations',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['name', 'type']);
    const name = nonEmptyString(req.body.name, 'name', 200);
    const type = oneOf(req.body.type, LOCATION_TYPES, 'type');
    const techId = optionalIntId(req.body.tech_id, 'tech_id');
    const address = optionalString(req.body.address, 'address', 500);

    await assertTechSuitable(type, techId);

    const result = await db.query(
      `INSERT INTO locations (name, type, tech_id, address)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [name, type, techId, address]
    );
    res.status(201).json({ location: result.rows[0] });
  })
);

// PATCH /api/locations/:id
// body: { name?, tech_id?, address? }
//
// A location is renamed, readdressed and reassigned far more often than the
// data model suggests: a van changes driver, a warehouse moves premises. Until
// this existed the only way to fix any of it was direct SQL.
//
// `type` is deliberately not editable, for the same reason items.tracking_type
// is not: every stock_levels row, item_instance and transaction already booked
// here was booked against this kind of place. Retire the location and create
// the right one instead.
router.patch(
  '/locations/:id',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const existing = await db.query('SELECT id, type, tech_id FROM locations WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw notFound('Location not found');
    const current = existing.rows[0];

    if (req.body.type !== undefined && req.body.type !== current.type) {
      throw badRequest(
        'type cannot be changed after a location is created — create a new location instead'
      );
    }

    const sets = [];
    const params = [];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (req.body.name !== undefined) set('name', nonEmptyString(req.body.name, 'name', 200));
    if (req.body.address !== undefined) {
      set('address', optionalString(req.body.address, 'address', 500));
    }
    if (req.body.tech_id !== undefined) {
      const techId = optionalIntId(req.body.tech_id, 'tech_id');
      await assertTechSuitable(current.type, techId);
      set('tech_id', techId);
    }

    if (sets.length === 0) throw badRequest('No editable fields were provided');

    params.push(id);
    const result = await db.query(
      `UPDATE locations SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ location: result.rows[0] });
  })
);

// Work orders used to live here. They moved to routes/jobs.js when the job
// became the thing a visit is recorded against rather than an optional
// dispatch note over the top of an installation — see 012_jobs.sql. The mount
// path is unchanged: /api/work-orders.
module.exports = router;
