const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, notFound, forbidden } = require('../lib/errors');
const {
  requireFields,
  oneOf,
  intId,
  optionalIntId,
  optionalNumber,
  nonEmptyString,
  optionalString,
  optionalDate,
  optionalBoolean,
} = require('../lib/validate');
const {
  TRACKING_TYPES,
  LOCATION_TYPES,
  WORK_ORDER_TYPES,
  WORK_ORDER_STATUSES,
} = require('../lib/constants');
const { requireRole, isFieldTech } = require('../middleware/auth');

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
//         manufacturer?, model?, reorder_threshold? }
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

    if (reorderThreshold !== null && reorderThreshold < 0) {
      throw badRequest('reorder_threshold cannot be negative');
    }

    const result = await db.query(
      `INSERT INTO items
        (name, category, tracking_type, unit_of_measure, manufacturer, model, reorder_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [name, category, trackingType, unitOfMeasure, manufacturer, model, reorderThreshold]
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
// body: { name, unit_of_measure, description? }
router.post(
  '/services',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['name', 'unit_of_measure']);

    const name = nonEmptyString(req.body.name, 'name', 200);
    const unitOfMeasure = nonEmptyString(req.body.unit_of_measure, 'unit_of_measure', 50);
    const description = optionalString(req.body.description, 'description', 1000);

    const result = await db.query(
      `INSERT INTO services (name, unit_of_measure, description)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [name, unitOfMeasure, description]
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

// ------------------------------------------------------------
// Work orders
// ------------------------------------------------------------

const WORK_ORDER_SELECT = `
  SELECT wo.*, cp.address, cp.customer_account_id,
         u.name AS assigned_tech_name
  FROM work_orders wo
  JOIN customer_premises cp ON cp.id = wo.customer_premises_id
  LEFT JOIN users u ON u.id = wo.assigned_tech_id
`;

// GET /api/work-orders?assigned_tech_id=&status=&customer_premises_id=
//
// `assigned_tech_id=me` resolves to the caller, so the mobile app does not have
// to know its own id to build a query string.
router.get(
  '/work-orders',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = [];
    const push = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const rawTech = req.query.assigned_tech_id;
    const techId =
      rawTech === 'me'
        ? req.user.id
        : optionalIntId(rawTech, 'assigned_tech_id');

    // A tech's job list is always their own, whatever they asked for.
    const scopedTech = isFieldTech(req.user) ? req.user.id : techId;
    if (scopedTech) clauses.push(`wo.assigned_tech_id = ${push(scopedTech)}`);

    if (req.query.status) {
      clauses.push(`wo.status = ${push(oneOf(req.query.status, WORK_ORDER_STATUSES, 'status'))}`);
    }
    if (req.query.customer_premises_id) {
      clauses.push(
        `wo.customer_premises_id = ${push(intId(req.query.customer_premises_id, 'customer_premises_id'))}`
      );
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(
      `${WORK_ORDER_SELECT} ${where}
       ORDER BY wo.scheduled_date NULLS LAST, wo.created_at DESC`,
      params
    );
    res.json({ work_orders: result.rows });
  })
);

// GET /api/work-orders/:id
router.get(
  '/work-orders/:id',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const result = await db.query(`${WORK_ORDER_SELECT} WHERE wo.id = $1`, [id]);
    if (result.rows.length === 0) throw notFound('Work order not found');

    const workOrder = result.rows[0];
    if (isFieldTech(req.user) && Number(workOrder.assigned_tech_id) !== req.user.id) {
      throw forbidden('That job is not assigned to you');
    }
    res.json({ work_order: workOrder });
  })
);

// POST /api/work-orders
// body: { customer_premises_id, type, assigned_tech_id?, scheduled_date?, notes? }
router.post(
  '/work-orders',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['customer_premises_id', 'type']);
    const premisesId = intId(req.body.customer_premises_id, 'customer_premises_id');
    const type = oneOf(req.body.type, WORK_ORDER_TYPES, 'type');
    const techId = optionalIntId(req.body.assigned_tech_id, 'assigned_tech_id');
    const scheduledDate = optionalDate(req.body.scheduled_date, 'scheduled_date');
    const notes = optionalString(req.body.notes, 'notes', 1000);

    const result = await db.query(
      `INSERT INTO work_orders
        (customer_premises_id, type, assigned_tech_id, scheduled_date, notes)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [premisesId, type, techId, scheduledDate, notes]
    );
    res.status(201).json({ work_order: result.rows[0] });
  })
);

// Which status a job may move to from where. A completed or cancelled job is
// terminal — reopening one would make `completed_at` meaningless.
const STATUS_TRANSITIONS = {
  open: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'open'],
  completed: [],
  cancelled: [],
};

// PATCH /api/work-orders/:id
// body: { status?, assigned_tech_id?, scheduled_date?, notes? }
router.patch(
  '/work-orders/:id',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const existing = await db.query(
      'SELECT id, status, assigned_tech_id FROM work_orders WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) throw notFound('Work order not found');
    const current = existing.rows[0];

    // A tech may progress their own job but not reassign it or reschedule it.
    if (isFieldTech(req.user)) {
      if (Number(current.assigned_tech_id) !== req.user.id) {
        throw forbidden('That job is not assigned to you');
      }
      const techEditable = ['status', 'notes'];
      const attempted = Object.keys(req.body).filter((k) => !techEditable.includes(k));
      if (attempted.length > 0) {
        throw forbidden(`Field techs may only change: ${techEditable.join(', ')}`);
      }
    }

    const sets = [];
    const params = [];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (req.body.status !== undefined) {
      const next = oneOf(req.body.status, WORK_ORDER_STATUSES, 'status');
      if (next !== current.status) {
        const allowed = STATUS_TRANSITIONS[current.status];
        if (!allowed.includes(next)) {
          throw badRequest(
            allowed.length === 0
              ? `A ${current.status} work order cannot change status`
              : `A ${current.status} work order can only move to: ${allowed.join(', ')}`
          );
        }
        set('status', next);
        // work_order_completed_at_required enforces this in the database too.
        set('completed_at', next === 'completed' ? new Date() : null);
      }
    }
    if (req.body.assigned_tech_id !== undefined) {
      set('assigned_tech_id', optionalIntId(req.body.assigned_tech_id, 'assigned_tech_id'));
    }
    if (req.body.scheduled_date !== undefined) {
      set('scheduled_date', optionalDate(req.body.scheduled_date, 'scheduled_date'));
    }
    if (req.body.notes !== undefined) {
      set('notes', optionalString(req.body.notes, 'notes', 1000));
    }

    if (sets.length === 0) throw badRequest('No editable fields were provided');

    params.push(id);
    const result = await db.query(
      `UPDATE work_orders SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ work_order: result.rows[0] });
  })
);

module.exports = router;
