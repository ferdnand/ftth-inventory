const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, conflict, notFound } = require('../lib/errors');
const {
  requireFields,
  oneOf,
  intId,
  optionalIntId,
  nonEmptyString,
  optionalString,
  limit,
} = require('../lib/validate');
const { INSTANCE_STATUSES } = require('../lib/constants');
const { requireRole, isFieldTech } = require('../middleware/auth');

const MAX_BATCH = 200;

const INSTANCE_SELECT = `
  SELECT ii.id, ii.serial_number, ii.mac_address, ii.status,
         ii.current_location_id, ii.current_holder_id, ii.created_at, ii.updated_at,
         i.id AS item_id, i.name AS item_name, i.category, i.manufacturer, i.model,
         l.name AS current_location_name,
         u.name AS current_holder_name
  FROM item_instances ii
  JOIN items i ON i.id = ii.item_id
  LEFT JOIN locations l ON l.id = ii.current_location_id
  LEFT JOIN users u ON u.id = ii.current_holder_id
`;

// GET /api/item-instances?serial=&item_id=&status=&location_id=&limit=
//
// The serial lookup the warehouse needs to answer "where is unit X?", and the
// only way a client can turn a scanned barcode into an item_instance_id.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = [];
    const push = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (req.query.serial) {
      // Prefix match, so a partially typed or partially scanned serial narrows
      // the list instead of returning nothing.
      clauses.push(`ii.serial_number ILIKE ${push(`${nonEmptyString(req.query.serial, 'serial', 100)}%`)}`);
    }
    if (req.query.mac) {
      clauses.push(`ii.mac_address ILIKE ${push(nonEmptyString(req.query.mac, 'mac', 100))}`);
    }
    if (req.query.item_id) {
      clauses.push(`ii.item_id = ${push(intId(req.query.item_id, 'item_id'))}`);
    }
    if (req.query.status) {
      clauses.push(`ii.status = ${push(oneOf(req.query.status, INSTANCE_STATUSES, 'status'))}`);
    }

    // A tech can only enumerate their own van's units.
    const requested = optionalIntId(req.query.location_id, 'location_id');
    const scoped = isFieldTech(req.user) ? req.user.assigned_location_id : requested;
    if (scoped) clauses.push(`ii.current_location_id = ${push(scoped)}`);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rowLimit = limit(req.query.limit, 100, 500);

    const result = await db.query(
      `${INSTANCE_SELECT} ${where}
       ORDER BY i.category, i.name, ii.serial_number
       LIMIT ${rowLimit}`,
      params
    );
    res.json({ item_instances: result.rows, limit: rowLimit });
  })
);

// GET /api/item-instances/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const result = await db.query(`${INSTANCE_SELECT} WHERE ii.id = $1`, [id]);
    if (result.rows.length === 0) throw notFound('item_instance not found');
    res.json({ item_instance: result.rows[0] });
  })
);

function parseUnit(raw, index) {
  const label = `units[${index}]`;
  if (!raw || typeof raw !== 'object') {
    throw badRequest(`${label} must be an object with a serial_number`);
  }
  if (!raw.serial_number) {
    throw badRequest(`${label}.serial_number is required`);
  }
  return {
    serial: nonEmptyString(raw.serial_number, `${label}.serial_number`, 100),
    mac: optionalString(raw.mac_address, `${label}.mac_address`, 100),
  };
}

// POST /api/item-instances
// body: { item_id, location_id, units: [{ serial_number, mac_address? }, ...] }
//
// This is what makes receiving serialized stock possible at all: nothing else
// creates an item_instance row, so before this existed a POST /api/transactions
// carrying an item_instance_id could only ever move a unit that was seeded.
//
// Batch on purpose — a warehouse receives a carton of 20 ONTs, not one. The
// whole batch is one transaction, so a duplicate serial anywhere in the list
// rejects the lot rather than leaving half of it registered.
router.post(
  '/',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['item_id', 'location_id']);
    const itemId = intId(req.body.item_id, 'item_id');
    const locationId = intId(req.body.location_id, 'location_id');

    const units = Array.isArray(req.body.units) ? req.body.units : null;
    if (!units || units.length === 0) {
      throw badRequest('units must be a non-empty array of { serial_number, mac_address? }');
    }
    if (units.length > MAX_BATCH) {
      throw badRequest(`units cannot contain more than ${MAX_BATCH} entries per request`);
    }

    const parsed = units.map(parseUnit);

    // Catch duplicates inside the request itself, which the UNIQUE index would
    // otherwise report as an opaque conflict on the second row.
    const seen = new Set();
    for (const unit of parsed) {
      const key = unit.serial.toLowerCase();
      if (seen.has(key)) {
        throw badRequest(`Serial ${unit.serial} appears more than once in this request`);
      }
      seen.add(key);
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const item = await client.query(
        'SELECT id, tracking_type FROM items WHERE id = $1',
        [itemId]
      );
      if (item.rows.length === 0) throw notFound('item not found');
      if (item.rows[0].tracking_type !== 'serialized') {
        throw badRequest(
          'That item is bulk-tracked — receive it with POST /api/transactions and a quantity'
        );
      }

      const location = await client.query('SELECT id FROM locations WHERE id = $1', [locationId]);
      if (location.rows.length === 0) throw notFound('location not found');

      const created = [];
      for (const unit of parsed) {
        const inserted = await client.query(
          `INSERT INTO item_instances (item_id, serial_number, mac_address, status, current_location_id)
           VALUES ($1, $2, $3, 'in_stock', $4)
           RETURNING id, serial_number, mac_address, status, current_location_id`,
          [itemId, unit.serial, unit.mac, locationId]
        );
        created.push(inserted.rows[0]);

        // One audit row per unit, so each serial's history starts at the point
        // it entered the business.
        await client.query(
          `INSERT INTO transactions
            (item_id, item_instance_id, to_location_id, type, performed_by, notes)
           VALUES ($1, $2, $3, 'receive', $4, $5)`,
          [itemId, inserted.rows[0].id, locationId, req.user.id, 'Received into stock']
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ item_instances: created, created: created.length });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

// PATCH /api/item-instances/:id
// Retiring a unit is the only status change made outside a movement — anything
// else must go through a transaction so the audit trail stays complete.
router.patch(
  '/:id',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    requireFields(req.body, ['status']);
    const status = oneOf(req.body.status, ['retired'], 'status');

    const existing = await db.query(
      'SELECT id, status, serial_number FROM item_instances WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) throw notFound('item_instance not found');
    if (existing.rows[0].status === 'installed') {
      throw conflict(
        `Serial ${existing.rows[0].serial_number} is installed at a customer premises — remove it first`
      );
    }

    const result = await db.query(
      `UPDATE item_instances
       SET status = $1, current_location_id = NULL, current_holder_id = NULL, updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );
    res.json({ item_instance: result.rows[0] });
  })
);

module.exports = router;
