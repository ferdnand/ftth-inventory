const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, notFound, conflict } = require('../lib/errors');
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

// DELETE /api/items/:id   (admin only)
//
// Removing an item for good is only possible while nothing refers to it. Once a
// unit was received, moved, requested or used on a job, the item is part of the
// audit trail and deleting it would orphan those rows — retire it instead
// (PATCH is_active=false), which hides it from pickers but keeps the history.
//
// Stock rows at zero quantity are bookkeeping, not history, so they go with the
// item. Stock on hand blocks the delete: that is real inventory.
router.delete(
  '/items/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const item = await client.query('SELECT id, name FROM items WHERE id = $1 FOR UPDATE', [id]);
      if (item.rows.length === 0) throw notFound('Item not found');

      const refs = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM item_instances WHERE item_id = $1)::int       AS units,
           (SELECT COUNT(*) FROM transactions WHERE item_id = $1)::int         AS movements,
           (SELECT COUNT(*) FROM restock_request_lines WHERE item_id = $1)::int AS restock_lines,
           (SELECT COUNT(*) FROM job_materials WHERE item_id = $1)::int        AS job_lines,
           (SELECT COUNT(*) FROM stock_levels WHERE item_id = $1 AND quantity <> 0)::int AS on_hand`,
        [id]
      );
      const r = refs.rows[0];
      const reasons = [];
      if (r.units) reasons.push(`${r.units} serialized unit(s)`);
      if (r.on_hand) reasons.push('stock on hand');
      if (r.movements) reasons.push(`${r.movements} stock movement(s)`);
      if (r.restock_lines) reasons.push(`${r.restock_lines} restock request line(s)`);
      if (r.job_lines) reasons.push(`${r.job_lines} job material line(s)`);
      if (reasons.length > 0) {
        throw conflict(
          `${item.rows[0].name} cannot be deleted because it has ${reasons.join(', ')}. ` +
            'Retire it instead — it disappears from pickers but the history stays intact.'
        );
      }

      await client.query('DELETE FROM stock_levels WHERE item_id = $1', [id]);
      await client.query('DELETE FROM items WHERE id = $1', [id]);
      await client.query('COMMIT');
      res.json({ deleted: true, id });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
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

// GET /api/locations?type=warehouse&include_inactive=true
router.get(
  '/locations',
  asyncHandler(async (req, res) => {
    const type = req.query.type
      ? oneOf(req.query.type, LOCATION_TYPES, 'type')
      : null;

    const includeInactive = optionalBoolean(req.query.include_inactive, 'include_inactive');

    const clauses = [];
    const params = [];
    if (type) {
      params.push(type);
      clauses.push(`l.type = $${params.length}`);
    }
    if (!includeInactive) clauses.push('l.is_active = TRUE');

    const result = await db.query(
      `SELECT l.*, u.name AS tech_name
       FROM locations l
       LEFT JOIN users u ON u.id = l.tech_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY l.type, l.name`,
      params
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

// What a location is holding right now, as phrases for an error message.
async function locationHoldings(queryable, id) {
  const r = await queryable.query(
    `SELECT
       (SELECT COUNT(*) FROM item_instances WHERE current_location_id = $1)::int AS units,
       (SELECT COUNT(*) FROM stock_levels
         WHERE location_id = $1 AND quantity <> 0)::int AS bulk_lines`,
    [id]
  );
  const { units, bulk_lines: bulk } = r.rows[0];
  const out = [];
  if (units) out.push(`${units} serialized unit(s)`);
  if (bulk) out.push(`${bulk} bulk stock line(s)`);
  return out;
}

// PATCH /api/locations/:id
// body: { name?, tech_id?, address?, is_active? }
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

    const existing = await db.query('SELECT id, type, tech_id, is_active FROM locations WHERE id = $1', [id]);
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
    if (req.body.is_active !== undefined) {
      const active = optionalBoolean(req.body.is_active, 'is_active');
      // Retiring a place that still holds stock would hide inventory that is
      // really there. Move it or count it out first.
      if (active === false && current.is_active) {
        const holding = await locationHoldings(db, id);
        if (holding.length > 0) {
          throw conflict(
            `Cannot retire a location that still holds ${holding.join(' and ')}. ` +
              'Transfer it elsewhere first.'
          );
        }
      }
      set('is_active', active);
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

// DELETE /api/locations/:id   (admin only)
//
// Same rule as items: only while nothing refers to the location. Anything that
// was ever received here, moved through here, requested for here or assigned to
// it is history, and the answer is to retire the location instead.
router.delete(
  '/locations/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const loc = await client.query('SELECT id, name FROM locations WHERE id = $1 FOR UPDATE', [id]);
      if (loc.rows.length === 0) throw notFound('Location not found');

      const refs = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM item_instances WHERE current_location_id = $1)::int AS units,
           (SELECT COUNT(*) FROM stock_levels WHERE location_id = $1 AND quantity <> 0)::int AS on_hand,
           (SELECT COUNT(*) FROM transactions
             WHERE from_location_id = $1 OR to_location_id = $1)::int AS movements,
           (SELECT COUNT(*) FROM restock_requests
             WHERE from_location_id = $1 OR to_location_id = $1)::int AS restocks,
           (SELECT COUNT(*) FROM customer_premises WHERE site_id = $1)::int AS premises,
           (SELECT COUNT(*) FROM job_materials WHERE from_location_id = $1)::int AS job_lines,
           (SELECT COUNT(*) FROM users WHERE assigned_location_id = $1)::int AS people`,
        [id]
      );
      const r = refs.rows[0];
      const reasons = [];
      if (r.units) reasons.push(`${r.units} serialized unit(s)`);
      if (r.on_hand) reasons.push('stock on hand');
      if (r.movements) reasons.push(`${r.movements} stock movement(s)`);
      if (r.restocks) reasons.push(`${r.restocks} restock request(s)`);
      if (r.premises) reasons.push(`${r.premises} premises recorded at this site`);
      if (r.job_lines) reasons.push(`${r.job_lines} job material line(s)`);
      if (r.people) reasons.push(`${r.people} user(s) assigned to it`);
      if (reasons.length > 0) {
        throw conflict(
          `${loc.rows[0].name} cannot be deleted because it has ${reasons.join(', ')}. ` +
            'Retire it instead — it disappears from pickers but the history stays intact.'
        );
      }

      await client.query('DELETE FROM stock_levels WHERE location_id = $1', [id]);
      await client.query('DELETE FROM locations WHERE id = $1', [id]);
      await client.query('COMMIT');
      res.json({ deleted: true, id });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

// Work orders used to live here. They moved to routes/jobs.js when the job
// became the thing a visit is recorded against rather than an optional
// dispatch note over the top of an installation — see 012_jobs.sql. The mount
// path is unchanged: /api/work-orders.
module.exports = router;
