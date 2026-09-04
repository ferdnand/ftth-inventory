const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, conflict, forbidden, notFound } = require('../lib/errors');
const {
  requireFields,
  oneOf,
  intId,
  optionalIntId,
  positiveNumber,
  optionalString,
} = require('../lib/validate');
const { RESTOCK_STATUSES } = require('../lib/constants');
const { applyMove } = require('../lib/stock');
const { requireRole, isFieldTech, requireAssignedLocation } = require('../middleware/auth');

// A tech asking the warehouse for stock. Why this exists rather than letting a
// tech POST a warehouse -> van transfer directly: that would let field techs
// self-issue warehouse stock with no approval step. A request is a separate
// object; fulfilling it is what actually moves the stock, and only warehouse
// staff can do that.

const REQUEST_SELECT = `
  SELECT r.*,
         requester.name AS requesting_user_name,
         resolver.name AS resolved_by_name,
         fl.name AS from_location_name,
         tl.name AS to_location_name
  FROM restock_requests r
  JOIN users requester ON requester.id = r.requesting_user_id
  LEFT JOIN users resolver ON resolver.id = r.resolved_by
  JOIN locations fl ON fl.id = r.from_location_id
  JOIN locations tl ON tl.id = r.to_location_id
`;

async function loadLines(requestIds) {
  if (requestIds.length === 0) return new Map();
  const result = await db.query(
    `SELECT rl.*, i.name AS item_name, i.category, i.unit_of_measure
     FROM restock_request_lines rl
     JOIN items i ON i.id = rl.item_id
     WHERE rl.restock_request_id = ANY($1::int[])
     ORDER BY i.category, i.name`,
    [requestIds]
  );

  const byRequest = new Map(requestIds.map((id) => [id, []]));
  for (const row of result.rows) {
    byRequest.get(row.restock_request_id).push(row);
  }
  return byRequest;
}

// GET /api/restock-requests?status=&requesting_user_id=&to_location_id=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = [];
    const push = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (req.query.status) {
      clauses.push(`r.status = ${push(oneOf(req.query.status, RESTOCK_STATUSES, 'status'))}`);
    }
    if (req.query.to_location_id) {
      clauses.push(`r.to_location_id = ${push(intId(req.query.to_location_id, 'to_location_id'))}`);
    }

    // A tech only sees their own requests.
    const requested = optionalIntId(req.query.requesting_user_id, 'requesting_user_id');
    const scoped = isFieldTech(req.user) ? req.user.id : requested;
    if (scoped) clauses.push(`r.requesting_user_id = ${push(scoped)}`);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(
      `${REQUEST_SELECT} ${where} ORDER BY r.created_at DESC`,
      params
    );

    const lines = await loadLines(result.rows.map((r) => r.id));
    res.json({
      restock_requests: result.rows.map((r) => ({ ...r, lines: lines.get(r.id) || [] })),
    });
  })
);

// GET /api/restock-requests/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const result = await db.query(`${REQUEST_SELECT} WHERE r.id = $1`, [id]);
    if (result.rows.length === 0) throw notFound('Restock request not found');

    const request = result.rows[0];
    if (isFieldTech(req.user) && Number(request.requesting_user_id) !== req.user.id) {
      throw forbidden('That request is not yours');
    }

    const lines = await loadLines([id]);
    res.json({ restock_request: { ...request, lines: lines.get(id) || [] } });
  })
);

// POST /api/restock-requests
// body: { from_location_id, lines: [{ item_id, quantity_requested }], notes? }
//
// to_location_id is the caller's own van — a tech cannot request stock into
// someone else's vehicle.
router.post(
  '/',
  requireRole('field_tech'),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['from_location_id']);
    const fromLocationId = intId(req.body.from_location_id, 'from_location_id');
    const toLocationId = requireAssignedLocation(req.user);
    const notes = optionalString(req.body.notes, 'notes', 1000);

    const lines = Array.isArray(req.body.lines) ? req.body.lines : null;
    if (!lines || lines.length === 0) {
      throw badRequest('lines must be a non-empty array of { item_id, quantity_requested }');
    }
    if (fromLocationId === Number(toLocationId)) {
      throw badRequest('from_location_id cannot be your own location');
    }

    const parsed = lines.map((line, index) => ({
      itemId: intId(line?.item_id, `lines[${index}].item_id`),
      quantity: positiveNumber(line?.quantity_requested, `lines[${index}].quantity_requested`),
    }));

    const seen = new Set();
    for (const line of parsed) {
      if (seen.has(line.itemId)) {
        throw badRequest(`item_id ${line.itemId} appears more than once — combine the quantities`);
      }
      seen.add(line.itemId);
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const source = await client.query(
        'SELECT id, type FROM locations WHERE id = $1',
        [fromLocationId]
      );
      if (source.rows.length === 0) throw notFound('from_location_id does not match a location');
      if (source.rows[0].type !== 'warehouse') {
        throw badRequest('Restock requests can only draw from a warehouse');
      }

      const request = await client.query(
        `INSERT INTO restock_requests
          (requesting_user_id, from_location_id, to_location_id, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [req.user.id, fromLocationId, toLocationId, notes]
      );

      for (const line of parsed) {
        await client.query(
          `INSERT INTO restock_request_lines (restock_request_id, item_id, quantity_requested)
           VALUES ($1, $2, $3)`,
          [request.rows[0].id, line.itemId, line.quantity]
        );
      }

      await client.query('COMMIT');

      const lineRows = await loadLines([request.rows[0].id]);
      res.status(201).json({
        restock_request: {
          ...request.rows[0],
          lines: lineRows.get(request.rows[0].id) || [],
        },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

const RESOLVABLE_FROM = {
  requested: ['approved', 'rejected', 'fulfilled', 'cancelled'],
  approved: ['fulfilled', 'rejected', 'cancelled'],
  fulfilled: [],
  rejected: [],
  cancelled: [],
};

// PATCH /api/restock-requests/:id
// body: { status, resolution_notes?, fulfilments?: [{ item_id, quantity_fulfilled }] }
//
// Moving to `fulfilled` is what actually transfers the stock: one applyMove per
// line and one `transfer` transaction each, all inside the same database
// transaction as the status change. A partial fulfilment ("we only had 120 m")
// is expressed by sending explicit `fulfilments`.
router.patch(
  '/:id',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    requireFields(req.body, ['status']);
    const status = oneOf(req.body.status, RESTOCK_STATUSES, 'status');
    const resolutionNotes = optionalString(req.body.resolution_notes, 'resolution_notes', 1000);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT * FROM restock_requests WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (existing.rows.length === 0) throw notFound('Restock request not found');
      const request = existing.rows[0];

      const allowed = RESOLVABLE_FROM[request.status];
      if (status !== request.status && !allowed.includes(status)) {
        throw badRequest(
          allowed.length === 0
            ? `A ${request.status} request cannot change status`
            : `A ${request.status} request can only move to: ${allowed.join(', ')}`
        );
      }

      if (status === 'fulfilled') {
        const lines = await client.query(
          `SELECT rl.id, rl.item_id, rl.quantity_requested, i.tracking_type, i.name AS item_name
           FROM restock_request_lines rl
           JOIN items i ON i.id = rl.item_id
           WHERE rl.restock_request_id = $1`,
          [id]
        );

        // Explicit per-item quantities override the requested amount, for the
        // "we only had 120 of the 200 you asked for" case.
        const overrides = new Map();
        if (req.body.fulfilments !== undefined) {
          if (!Array.isArray(req.body.fulfilments)) {
            throw badRequest('fulfilments must be an array of { item_id, quantity_fulfilled }');
          }
          req.body.fulfilments.forEach((f, index) => {
            const itemId = intId(f?.item_id, `fulfilments[${index}].item_id`);
            const qty = Number(f?.quantity_fulfilled);
            if (!Number.isFinite(qty) || qty < 0) {
              throw badRequest(
                `fulfilments[${index}].quantity_fulfilled must be zero or a positive number`
              );
            }
            overrides.set(itemId, qty);
          });
        }

        for (const line of lines.rows) {
          const quantity = overrides.has(line.item_id)
            ? overrides.get(line.item_id)
            : Number(line.quantity_requested);

          if (quantity === 0) {
            await client.query(
              'UPDATE restock_request_lines SET quantity_fulfilled = 0 WHERE id = $1',
              [line.id]
            );
            continue;
          }

          if (line.tracking_type !== 'bulk') {
            throw conflict(
              `${line.item_name} is serialized — issue specific units with POST /api/transactions instead`
            );
          }

          // Same non-negative rule and row lock as any other bulk movement.
          await applyMove(client, {
            itemId: line.item_id,
            fromLocationId: request.from_location_id,
            toLocationId: request.to_location_id,
            quantity,
          });

          await client.query(
            `INSERT INTO transactions
              (item_id, quantity, from_location_id, to_location_id, type, performed_by, notes)
             VALUES ($1, $2, $3, $4, 'transfer', $5, $6)`,
            [
              line.item_id,
              quantity,
              request.from_location_id,
              request.to_location_id,
              req.user.id,
              `Restock request #${id}`,
            ]
          );

          await client.query(
            'UPDATE restock_request_lines SET quantity_fulfilled = $1 WHERE id = $2',
            [quantity, line.id]
          );
        }
      }

      const terminal = ['fulfilled', 'rejected', 'cancelled'].includes(status);
      const updated = await client.query(
        `UPDATE restock_requests
         SET status = $1,
             resolution_notes = COALESCE($2, resolution_notes),
             resolved_at = CASE WHEN $3 THEN now() ELSE resolved_at END,
             resolved_by = CASE WHEN $3 THEN $4::int ELSE resolved_by END
         WHERE id = $5
         RETURNING *`,
        [status, resolutionNotes, terminal, req.user.id, id]
      );

      await client.query('COMMIT');

      const lineRows = await loadLines([id]);
      res.json({
        restock_request: { ...updated.rows[0], lines: lineRows.get(id) || [] },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

// DELETE is not offered — a tech cancels their own request instead, so the
// record of what was asked for survives.
// PATCH /api/restock-requests/:id/cancel
router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const existing = await db.query(
      'SELECT id, status, requesting_user_id FROM restock_requests WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) throw notFound('Restock request not found');

    const request = existing.rows[0];
    if (Number(request.requesting_user_id) !== req.user.id && isFieldTech(req.user)) {
      throw forbidden('That request is not yours');
    }
    if (!RESOLVABLE_FROM[request.status].includes('cancelled')) {
      throw badRequest(`A ${request.status} request cannot be cancelled`);
    }

    const result = await db.query(
      `UPDATE restock_requests
       SET status = 'cancelled', resolved_at = now(), resolved_by = $1
       WHERE id = $2
       RETURNING *`,
      [req.user.id, id]
    );
    res.json({ restock_request: result.rows[0] });
  })
);

module.exports = router;
