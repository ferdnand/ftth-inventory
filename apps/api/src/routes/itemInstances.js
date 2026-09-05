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
const { requireRole, isFieldTech, isAdmin } = require('../middleware/auth');
const { lockInstance } = require('../lib/stock');

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

// Statuses an admin may set by hand. 'installed' is not one of them: it is a
// claim that a unit is in service at a premises, and only POST /api/installations
// can make that true on both sides. Correct the installation record instead.
const CORRECTABLE_STATUSES = INSTANCE_STATUSES.filter((s) => s !== 'installed');

// PATCH /api/item-instances/:id
// body (warehouse staff, pm): { status: 'retired' }
// body (admin):               { status?, serial_number?, mac_address?,
//                               current_location_id?, current_holder_id?, notes? }
//
// Retiring a unit is the only status change warehouse staff make outside a
// movement — everything else has to go through a transaction so the audit trail
// stays complete.
//
// An admin can also correct the row itself, which is a different thing from
// moving stock: a serial keyed wrong off a carton, a MAC read off the wrong
// label, a unit recorded in the warehouse that has been in a van for a week.
// None of those have a movement to record because no stock actually moved — but
// the row changes, so an 'adjustment' transaction is written saying who changed
// it and why. See migration 010.
router.patch(
  '/:id',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const admin = isAdmin(req.user);

    // Named before anything else so a staff member sending an admin-only field
    // is told that, rather than being asked for a status they did not mean to
    // send in the first place.
    if (!admin) {
      const staffEditable = ['status'];
      const attempted = Object.keys(req.body).filter((k) => !staffEditable.includes(k));
      if (attempted.length > 0) {
        throw badRequest(
          `Only an administrator can change: ${attempted.join(', ')}. ` +
            'Move the unit with POST /api/transactions instead.'
        );
      }
      requireFields(req.body, ['status']);
    }

    const allowedStatuses = admin ? CORRECTABLE_STATUSES : ['retired'];

    const status =
      req.body.status !== undefined
        ? oneOf(req.body.status, allowedStatuses, 'status')
        : null;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await lockInstance(client, id);

      // True for an admin too: the unit is the anchor of a live installation,
      // and editing it here would leave that installation pointing at a unit
      // that says it is somewhere else. POST /api/installations/:id/remove or
      // /replace is the path that fixes both rows together.
      if (existing.status === 'installed') {
        throw conflict(
          `Serial ${existing.serial_number} is installed at a customer premises — remove it first`
        );
      }

      const sets = [];
      const params = [];
      const set = (column, value) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };

      // Retiring parks the unit nowhere and with nobody, whoever does it.
      let nextLocationId = existing.current_location_id;
      if (status === 'retired') {
        set('status', 'retired');
        set('current_location_id', null);
        set('current_holder_id', null);
        nextLocationId = null;
      } else if (status) {
        set('status', status);
      }

      if (admin) {
        if (req.body.serial_number !== undefined) {
          set('serial_number', nonEmptyString(req.body.serial_number, 'serial_number', 100));
        }
        if (req.body.mac_address !== undefined) {
          set('mac_address', optionalString(req.body.mac_address, 'mac_address', 100));
        }
        if (req.body.current_location_id !== undefined && status !== 'retired') {
          nextLocationId = optionalIntId(req.body.current_location_id, 'current_location_id');
          set('current_location_id', nextLocationId);
        }
        if (req.body.current_holder_id !== undefined && status !== 'retired') {
          set('current_holder_id', optionalIntId(req.body.current_holder_id, 'current_holder_id'));
        }
      }

      if (sets.length === 0) throw badRequest('No editable fields were provided');

      params.push(id);
      const result = await client.query(
        `UPDATE item_instances SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${params.length}
         RETURNING *`,
        params
      );

      // Where the correction reads as a movement: out of where the record said
      // the unit was, into where it actually is. A correction that only changes
      // a status leaves it where it is, so it records an arrival at that same
      // location rather than a from/to pair pointing at one place.
      const from = existing.current_location_id;
      const to = nextLocationId;
      const moved = Number(from) !== Number(to);

      // transaction_has_a_direction: a correction that touches no location at
      // all (fixing a serial on a retired unit) has no movement to record.
      if (from !== null || to !== null) {
        await client.query(
          `INSERT INTO transactions
            (item_id, item_instance_id, from_location_id, to_location_id, type, performed_by, notes)
           VALUES ($1, $2, $3, $4, 'adjustment', $5, $6)`,
          [
            existing.item_id,
            id,
            moved ? from : null,
            to,
            req.user.id,
            optionalString(req.body.notes, 'notes', 1000) ??
              (status === 'retired' ? 'Retired' : 'Record corrected'),
          ]
        );
      }

      await client.query('COMMIT');
      res.json({ item_instance: result.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
