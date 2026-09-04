const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, conflict, notFound } = require('../lib/errors');
const {
  requireFields,
  rejectFields,
  oneOf,
  intId,
  optionalIntId,
  positiveNumber,
  optionalString,
  optionalDate,
  limit,
} = require('../lib/validate');
const { CLIENT_TRANSACTION_TYPES, TRANSACTION_TYPES_BY_ROLE } = require('../lib/constants');
const { applyMove, lockInstance } = require('../lib/stock');
const { readKey, findReplay, isIdempotencyConflict } = require('../lib/idempotency');
const { isFieldTech } = require('../middleware/auth');

// What a serialized unit becomes after each kind of move, and whether it needs a
// destination. Keeping this as data rather than nested ternaries means adding a
// movement type is one row.
const SERIALIZED_MOVE = {
  receive:  { status: 'in_stock', destinationRequired: true },
  transfer: { status: 'in_stock', destinationRequired: true },
  issue:    { status: 'issued',   destinationRequired: true },
  return:   { status: 'returned', destinationRequired: true },
  faulty:   { status: 'faulty',   destinationRequired: false },
};

// A field tech may only move stock through their own van. Warehouse staff and
// PMs are unrestricted.
function assertMovementAllowed(user, { type, fromLocationId, toLocationId }) {
  const allowedTypes = TRANSACTION_TYPES_BY_ROLE[user.role] || [];
  if (!allowedTypes.includes(type)) {
    throw badRequest(
      `Your role may only record: ${allowedTypes.join(', ')}. ` +
        (isFieldTech(user)
          ? 'Use a restock request to draw stock from a warehouse.'
          : '')
    );
  }

  if (!isFieldTech(user)) return;

  const van = Number(user.assigned_location_id);
  const touchesVan =
    Number(fromLocationId) === van || Number(toLocationId) === van;
  if (!touchesVan) {
    throw badRequest('Field techs can only record movements involving their own van');
  }
}

// POST /api/transactions
// Generic stock movement: receive / transfer / issue / return / faulty.
//
// `install` is deliberately NOT accepted here — an install must go through
// POST /api/installations so an `installations` row is written alongside the
// audit entry.
//
// Bulk items:       { item_id, quantity, from_location_id?, to_location_id?, type }
// Serialized items: { item_instance_id, from_location_id?, to_location_id?, type }
// Optional on both: { work_order_id, notes, idempotency_key }
//
// performed_by is derived from the token and must not be sent.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    rejectFields(req.body, ['performed_by'], 'it is taken from your access token');
    requireFields(req.body, ['type']);

    const type = oneOf(req.body.type, CLIENT_TRANSACTION_TYPES, 'type');
    const itemInstanceId = optionalIntId(req.body.item_instance_id, 'item_instance_id');
    const fromLocationId = optionalIntId(req.body.from_location_id, 'from_location_id');
    const toLocationId = optionalIntId(req.body.to_location_id, 'to_location_id');
    const workOrderId = optionalIntId(req.body.work_order_id, 'work_order_id');
    const notes = optionalString(req.body.notes, 'notes', 1000);
    const idempotencyKey = readKey(req.body);
    const performedBy = req.user.id;

    const hasBulkFields =
      req.body.quantity !== undefined && req.body.quantity !== null && req.body.quantity !== '';

    if (itemInstanceId && hasBulkFields) {
      throw badRequest(
        'Provide either item_instance_id (serialized) or item_id + quantity (bulk), not both'
      );
    }
    if (!itemInstanceId && !hasBulkFields) {
      throw badRequest(
        'Provide either item_instance_id (serialized) or item_id + quantity (bulk)'
      );
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const replay = await findReplay(client, 'transactions', idempotencyKey);
      if (replay) {
        await client.query('ROLLBACK');
        return res.status(200).json({ transaction: replay, replayed: true });
      }

      let resolvedItemId;
      let resolvedFrom = fromLocationId;

      if (itemInstanceId) {
        // --- Serialized move ---
        const instance = await lockInstance(client, itemInstanceId);
        resolvedItemId = instance.item_id;

        if (instance.status === 'installed') {
          throw conflict(
            `Serial ${instance.serial_number} is installed at a customer premises. ` +
              'Use POST /api/installations/:premisesId/replace to remove it.'
          );
        }
        if (instance.status === 'retired') {
          throw conflict(`Serial ${instance.serial_number} is retired`);
        }

        const move = SERIALIZED_MOVE[type];
        if (move.destinationRequired && !toLocationId) {
          throw badRequest(`to_location_id is required for a '${type}' movement`);
        }

        // Default the source to wherever the unit actually is, so the audit
        // trail records the real origin even when the client omits it.
        resolvedFrom = fromLocationId ?? instance.current_location_id;
        if (
          fromLocationId &&
          instance.current_location_id &&
          Number(fromLocationId) !== Number(instance.current_location_id)
        ) {
          throw conflict(
            `Serial ${instance.serial_number} is not at location ${fromLocationId}`
          );
        }

        assertMovementAllowed(req.user, {
          type,
          fromLocationId: resolvedFrom,
          toLocationId,
        });

        // A 'faulty' unit with no destination stays where it is, flagged, until
        // someone runs it back to the warehouse.
        const destination = toLocationId ?? instance.current_location_id;

        // A unit is only "held" by a person while issued to them; parked in a
        // van or warehouse it belongs to the location, not a holder.
        const holder =
          move.status === 'issued'
            ? (
                await client.query('SELECT tech_id FROM locations WHERE id = $1', [
                  destination,
                ])
              ).rows[0]?.tech_id ?? null
            : null;

        await client.query(
          `UPDATE item_instances
           SET current_location_id = $1, current_holder_id = $2, status = $3, updated_at = now()
           WHERE id = $4`,
          [destination, holder, move.status, itemInstanceId]
        );
      } else {
        // --- Bulk move ---
        requireFields(req.body, ['item_id']);
        resolvedItemId = intId(req.body.item_id, 'item_id');
        const quantity = positiveNumber(req.body.quantity, 'quantity');

        if (!fromLocationId && !toLocationId) {
          throw badRequest('A bulk movement needs a from_location_id, a to_location_id, or both');
        }
        if (type === 'receive' && !toLocationId) {
          throw badRequest("to_location_id is required for a 'receive' movement");
        }
        if (type === 'transfer' && (!fromLocationId || !toLocationId)) {
          throw badRequest(
            "both from_location_id and to_location_id are required for a 'transfer'"
          );
        }

        assertMovementAllowed(req.user, { type, fromLocationId, toLocationId });

        const item = await client.query(
          'SELECT id, tracking_type FROM items WHERE id = $1',
          [resolvedItemId]
        );
        if (item.rows.length === 0) throw notFound('item not found');
        if (item.rows[0].tracking_type !== 'bulk') {
          throw badRequest(
            'That item is serialized — move it with item_instance_id, not item_id + quantity'
          );
        }

        // Single implementation of the non-negative rule, with a FOR UPDATE
        // row lock so two concurrent decrements cannot both pass the check.
        await applyMove(client, {
          itemId: resolvedItemId,
          fromLocationId,
          toLocationId,
          quantity,
        });
      }

      const txn = await client.query(
        `INSERT INTO transactions
          (item_id, item_instance_id, quantity, from_location_id, to_location_id,
           type, work_order_id, performed_by, notes, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          resolvedItemId,
          itemInstanceId || null,
          itemInstanceId ? null : Number(req.body.quantity),
          resolvedFrom || null,
          toLocationId || null,
          type,
          workOrderId,
          performedBy,
          notes,
          idempotencyKey,
        ]
      );

      await client.query('COMMIT');
      res.status(201).json({ transaction: txn.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});

      // A concurrent retry with the same key won the race. That is a success.
      if (isIdempotencyConflict(err)) {
        const existing = await db.query(
          'SELECT * FROM transactions WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        if (existing.rows[0]) {
          return res.status(200).json({ transaction: existing.rows[0], replayed: true });
        }
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

// GET /api/transactions
//   ?item_instance_id= &item_id= &work_order_id= &location_id= &type=
//   &from= &to= &limit=
//
// Names are joined in rather than left as bare foreign keys — every activity
// feed in both clients needs them, and resolving them client-side means holding
// the whole items and locations tables in memory to render one list.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = [];

    const push = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (req.query.item_instance_id) {
      clauses.push(`t.item_instance_id = ${push(intId(req.query.item_instance_id, 'item_instance_id'))}`);
    }
    if (req.query.item_id) {
      clauses.push(`t.item_id = ${push(intId(req.query.item_id, 'item_id'))}`);
    }
    if (req.query.work_order_id) {
      clauses.push(`t.work_order_id = ${push(intId(req.query.work_order_id, 'work_order_id'))}`);
    }
    if (req.query.performed_by) {
      clauses.push(`t.performed_by = ${push(intId(req.query.performed_by, 'performed_by'))}`);
    }
    if (req.query.type) {
      clauses.push(`t.type = ${push(oneOf(req.query.type, CLIENT_TRANSACTION_TYPES.concat('install'), 'type'))}`);
    }
    if (req.query.from) {
      clauses.push(`t.created_at >= ${push(optionalDate(req.query.from, 'from'))}::timestamptz`);
    }
    if (req.query.to) {
      clauses.push(`t.created_at < (${push(optionalDate(req.query.to, 'to'))}::date + 1)`);
    }

    // A field tech's feed is scoped to their van whether or not they asked for
    // it, so the audit trail cannot be used to browse other locations.
    const requestedLocation = optionalIntId(req.query.location_id, 'location_id');
    const scopedLocation = isFieldTech(req.user)
      ? req.user.assigned_location_id
      : requestedLocation;

    if (scopedLocation) {
      const placeholder = push(scopedLocation);
      clauses.push(`(t.from_location_id = ${placeholder} OR t.to_location_id = ${placeholder})`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rowLimit = limit(req.query.limit, 100, 500);

    const result = await db.query(
      `SELECT t.*,
              i.name AS item_name, i.category, i.unit_of_measure, i.tracking_type,
              ii.serial_number, ii.mac_address,
              fl.name AS from_location_name, tl.name AS to_location_name,
              u.name AS performed_by_name
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       LEFT JOIN item_instances ii ON ii.id = t.item_instance_id
       LEFT JOIN locations fl ON fl.id = t.from_location_id
       LEFT JOIN locations tl ON tl.id = t.to_location_id
       JOIN users u ON u.id = t.performed_by
       ${where}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ${rowLimit}`,
      params
    );

    res.json({ transactions: result.rows, limit: rowLimit });
  })
);

module.exports = router;
