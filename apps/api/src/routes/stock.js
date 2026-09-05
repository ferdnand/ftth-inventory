const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, notFound } = require('../lib/errors');
const {
  requireFields,
  intId,
  optionalNumber,
  nonEmptyString,
} = require('../lib/validate');
const { assertLocationAccess, requireRole } = require('../middleware/auth');
const { applyMove } = require('../lib/stock');
const { readKey, findReplay, isIdempotencyConflict } = require('../lib/idempotency');

// GET /api/stock?location_id=5
// Serialized instances + bulk quantities at one location (a tech's van, a
// warehouse, or a site).
//
// Stays a FLAT list of instances on purpose. The mobile app needs both the
// per-model counts and the individual serials to pick from, and this shape gives
// it both in one request over the flakiest network in the system. See
// /api/stock/summary for the pre-aggregated shape the dashboard wants.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const locationId = intId(req.query.location_id, 'location_id');
    assertLocationAccess(req.user, locationId);

    const serialized = await db.query(
      `SELECT ii.id, ii.serial_number, ii.mac_address, ii.status,
              i.id AS item_id, i.name AS item_name, i.category,
              i.manufacturer, i.model, i.reorder_threshold
       FROM item_instances ii
       JOIN items i ON i.id = ii.item_id
       WHERE ii.current_location_id = $1
       ORDER BY i.category, i.name, ii.serial_number`,
      [locationId]
    );

    const bulk = await db.query(
      `SELECT sl.item_id, sl.quantity, i.name AS item_name, i.category,
              i.unit_of_measure, i.reorder_threshold,
              COALESCE(sl.quantity <= i.reorder_threshold, FALSE) AS is_low_stock
       FROM stock_levels sl
       JOIN items i ON i.id = sl.item_id
       WHERE sl.location_id = $1
       ORDER BY i.category, i.name`,
      [locationId]
    );

    res.json({
      location_id: locationId,
      serialized: serialized.rows,
      bulk: bulk.rows,
    });
  })
);

// GET /api/stock/summary?location_id=5
// The same stock, aggregated per item. The dashboard's counters must not be
// derived client-side from a list that could be capped or filtered.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const locationId = intId(req.query.location_id, 'location_id');
    assertLocationAccess(req.user, locationId);

    // Counts only the units actually available to install. A van also holds
    // faulty/returned units awaiting a run to the warehouse, and counting those
    // as stock would overstate what the tech can fit today.
    const serialized = await db.query(
      `SELECT i.id AS item_id, i.name AS item_name, i.category,
              i.manufacturer, i.model, i.unit_of_measure, i.reorder_threshold,
              COUNT(*) FILTER (WHERE ii.status = 'in_stock')::int AS installable_count,
              COUNT(*) FILTER (WHERE ii.status IN ('faulty', 'returned'))::int AS to_return_count,
              COUNT(*)::int AS total_count,
              COALESCE(
                COUNT(*) FILTER (WHERE ii.status = 'in_stock') <= i.reorder_threshold,
                FALSE
              ) AS is_low_stock
       FROM item_instances ii
       JOIN items i ON i.id = ii.item_id
       WHERE ii.current_location_id = $1
       GROUP BY i.id
       ORDER BY i.category, i.name`,
      [locationId]
    );

    const bulk = await db.query(
      `SELECT sl.item_id, sl.quantity, i.name AS item_name, i.category,
              i.unit_of_measure, i.reorder_threshold,
              COALESCE(sl.quantity <= i.reorder_threshold, FALSE) AS is_low_stock
       FROM stock_levels sl
       JOIN items i ON i.id = sl.item_id
       WHERE sl.location_id = $1
       ORDER BY i.category, i.name`,
      [locationId]
    );

    const lowStockCount =
      serialized.rows.filter((r) => r.is_low_stock).length +
      bulk.rows.filter((r) => r.is_low_stock).length;

    res.json({
      location_id: locationId,
      serialized: serialized.rows,
      bulk: bulk.rows,
      totals: {
        serialized_units: serialized.rows.reduce((sum, r) => sum + r.total_count, 0),
        installable_units: serialized.rows.reduce((sum, r) => sum + r.installable_count, 0),
        to_return_units: serialized.rows.reduce((sum, r) => sum + r.to_return_count, 0),
        bulk_items: bulk.rows.length,
        low_stock_items: lowStockCount,
      },
    });
  })
);

// POST /api/stock/adjustments
// body: { item_id, location_id, counted_quantity, notes, idempotency_key? }
//
// Reconciles a bulk stock level against a physical count. This is the only way
// to write stock_levels without a movement behind it, and it is admin-only: a
// stock level that disagrees with the shelf is usually a missing transaction,
// and the right fix is to record the movement that was missed. An adjustment is
// what you do when nobody can say what happened.
//
// It takes the counted quantity, not a delta — that is what the person holding
// the clipboard actually knows, and it makes the request safe to repeat: a
// second submit of the same count is a no-op rather than a second correction.
//
// The difference is written as an 'adjustment' transaction so the audit trail
// still accounts for every unit: stock appearing is an arrival at the location,
// stock missing is a departure from it. `notes` is required because an
// adjustment with no stated reason is unauditable.
router.post(
  '/adjustments',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['item_id', 'location_id', 'notes']);
    const itemId = intId(req.body.item_id, 'item_id');
    const locationId = intId(req.body.location_id, 'location_id');
    const notes = nonEmptyString(req.body.notes, 'notes', 1000);
    const idempotencyKey = readKey(req.body);

    const counted = optionalNumber(req.body.counted_quantity, 'counted_quantity');
    if (counted === null) throw badRequest('counted_quantity is required');
    if (counted < 0) throw badRequest('counted_quantity cannot be negative');

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const replay = await findReplay(client, 'transactions', idempotencyKey);
      if (replay) {
        await client.query('ROLLBACK');
        return res.status(200).json({ transaction: replay, replayed: true });
      }

      const item = await client.query(
        'SELECT id, tracking_type FROM items WHERE id = $1',
        [itemId]
      );
      if (item.rows.length === 0) throw notFound('item not found');
      if (item.rows[0].tracking_type !== 'bulk') {
        throw badRequest(
          'That item is serialized — correct the individual unit with ' +
            'PATCH /api/item-instances/:id instead'
        );
      }

      const location = await client.query('SELECT id FROM locations WHERE id = $1', [locationId]);
      if (location.rows.length === 0) throw notFound('location not found');

      // Same FOR UPDATE lock the movement path takes, so a count landing at the
      // same moment as a transfer cannot read a balance that is about to change.
      const current = await client.query(
        `SELECT quantity FROM stock_levels
         WHERE item_id = $1 AND location_id = $2
         FOR UPDATE`,
        [itemId, locationId]
      );
      const onHand = current.rows.length > 0 ? Number(current.rows[0].quantity) : 0;
      const delta = counted - onHand;

      // The count agrees with the record. Nothing to correct, and a zero-quantity
      // transaction would violate transaction_quantity_positive anyway.
      if (delta === 0) {
        await client.query('COMMIT');
        return res.json({
          adjusted: false,
          item_id: itemId,
          location_id: locationId,
          quantity: onHand,
          transaction: null,
        });
      }

      await applyMove(client, {
        itemId,
        fromLocationId: delta < 0 ? locationId : null,
        toLocationId: delta > 0 ? locationId : null,
        quantity: Math.abs(delta),
      });

      const txn = await client.query(
        `INSERT INTO transactions
          (item_id, quantity, from_location_id, to_location_id, type, performed_by,
           notes, idempotency_key)
         VALUES ($1,$2,$3,$4,'adjustment',$5,$6,$7)
         RETURNING *`,
        [
          itemId,
          Math.abs(delta),
          delta < 0 ? locationId : null,
          delta > 0 ? locationId : null,
          req.user.id,
          notes,
          idempotencyKey,
        ]
      );

      await client.query('COMMIT');
      res.status(201).json({
        adjusted: true,
        item_id: itemId,
        location_id: locationId,
        previous_quantity: onHand,
        quantity: counted,
        delta,
        transaction: txn.rows[0],
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});

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

module.exports = router;
