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
} = require('../lib/validate');
const { REMOVAL_REASONS } = require('../lib/constants');
const { lockInstance, assertInstallable } = require('../lib/stock');
const { readKey, findReplay, isIdempotencyConflict } = require('../lib/idempotency');
const { isFieldTech } = require('../middleware/auth');

// Where a unit coming out of service should be parked. A tech carries it in
// their van; warehouse staff must say explicitly.
function resolveReturnLocation(user, requested) {
  const location = requested ?? user.assigned_location_id;
  if (!location) {
    throw badRequest(
      'return_to_location_id is required — say where the removed unit is going'
    );
  }
  return Number(location);
}

// A unit can only be installed from the acting user's own van. Warehouse staff
// and PMs are unrestricted (they may be correcting records).
function assertInstanceReachable(user, instance) {
  if (!instance.current_location_id) {
    throw conflict(
      `Serial ${instance.serial_number} is not at any location, so it cannot be installed`
    );
  }
  if (
    isFieldTech(user) &&
    Number(instance.current_location_id) !== Number(user.assigned_location_id)
  ) {
    throw conflict(`Serial ${instance.serial_number} is not in your van`);
  }
}

async function assertPremisesExists(client, premisesId) {
  const result = await client.query('SELECT id FROM customer_premises WHERE id = $1', [
    premisesId,
  ]);
  if (result.rows.length === 0) throw notFound('customer_premises not found');
}

// POST /api/installations
// First-time install at a premises with no active router.
// body: { customer_premises_id, item_instance_id, work_order_id?, idempotency_key? }
//
// installed_by is derived from the token and must not be sent.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    rejectFields(
      req.body,
      ['installed_by', 'performed_by'],
      'it is taken from your access token'
    );
    requireFields(req.body, ['customer_premises_id', 'item_instance_id']);

    const premisesId = intId(req.body.customer_premises_id, 'customer_premises_id');
    const instanceId = intId(req.body.item_instance_id, 'item_instance_id');
    const workOrderId = optionalIntId(req.body.work_order_id, 'work_order_id');
    const idempotencyKey = readKey(req.body);
    const installedBy = req.user.id;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const replay = await findReplay(client, 'installations', idempotencyKey);
      if (replay) {
        await client.query('ROLLBACK');
        return res.status(200).json({ installation: replay, replayed: true });
      }

      await assertPremisesExists(client, premisesId);

      // Guard: no active installation should already exist here. The partial
      // unique index uq_active_installation_per_premises is the real guarantee;
      // this check exists to return a helpful 409 instead of a constraint error.
      const existing = await client.query(
        `SELECT id FROM installations
         WHERE customer_premises_id = $1 AND removed_at IS NULL`,
        [premisesId]
      );
      if (existing.rows.length > 0) {
        throw conflict(
          'An active router already exists at this premises. Use /replace instead.'
        );
      }

      const instance = await lockInstance(client, instanceId);
      assertInstallable(instance);
      assertInstanceReachable(req.user, instance);
      const fromLocationId = instance.current_location_id;

      const installation = await client.query(
        `INSERT INTO installations
          (customer_premises_id, item_instance_id, installed_by, work_order_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [premisesId, instanceId, installedBy, workOrderId, idempotencyKey]
      );

      await client.query(
        `UPDATE item_instances
         SET status = 'installed', current_location_id = NULL,
             current_holder_id = NULL, updated_at = now()
         WHERE id = $1`,
        [instanceId]
      );

      // from_location_id records the van the unit left. A customer premises is
      // not a `location`, so there is no destination — the installations row is
      // what says where it went.
      await client.query(
        `INSERT INTO transactions
          (item_id, item_instance_id, from_location_id, type, work_order_id, performed_by, notes)
         VALUES ($1, $2, $3, 'install', $4, $5, $6)`,
        [
          instance.item_id,
          instanceId,
          fromLocationId,
          workOrderId,
          installedBy,
          `Installed at premises ${premisesId}`,
        ]
      );

      await client.query('COMMIT');
      res.status(201).json({ installation: installation.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (isIdempotencyConflict(err)) {
        const existing = await db.query(
          'SELECT * FROM installations WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        if (existing.rows[0]) {
          return res.status(200).json({ installation: existing.rows[0], replayed: true });
        }
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

// POST /api/installations/:premisesId/replace
// Removes the active router (reason required) and installs a new one.
// body: { new_item_instance_id, removal_reason, work_order_id?,
//         return_to_location_id?, idempotency_key? }
//
// NOTE: :premisesId is a customer_premises id, NOT an installation id.
router.post(
  '/:premisesId/replace',
  asyncHandler(async (req, res) => {
    rejectFields(
      req.body,
      ['performed_by', 'installed_by', 'removed_by'],
      'it is taken from your access token'
    );
    requireFields(req.body, ['new_item_instance_id', 'removal_reason']);

    const premisesId = intId(req.params.premisesId, 'premisesId');
    const newInstanceId = intId(req.body.new_item_instance_id, 'new_item_instance_id');
    const removalReason = oneOf(req.body.removal_reason, REMOVAL_REASONS, 'removal_reason');
    const workOrderId = optionalIntId(req.body.work_order_id, 'work_order_id');
    const returnTo = resolveReturnLocation(
      req.user,
      optionalIntId(req.body.return_to_location_id, 'return_to_location_id')
    );
    const idempotencyKey = readKey(req.body);
    const performedBy = req.user.id;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const replay = await findReplay(client, 'installations', idempotencyKey);
      if (replay) {
        await client.query('ROLLBACK');
        return res.status(200).json({ installation: replay, replayed: true });
      }

      // FOR UPDATE so two techs cannot replace the same router at once.
      const active = await client.query(
        `SELECT id, item_instance_id FROM installations
         WHERE customer_premises_id = $1 AND removed_at IS NULL
         FOR UPDATE`,
        [premisesId]
      );
      if (active.rows.length === 0) {
        throw notFound('No active router found at this premises');
      }
      const activeInstallation = active.rows[0];

      const newInstance = await lockInstance(client, newInstanceId);
      assertInstallable(newInstance);
      assertInstanceReachable(req.user, newInstance);
      const fromLocationId = newInstance.current_location_id;

      if (Number(newInstanceId) === Number(activeInstallation.item_instance_id)) {
        throw badRequest('The replacement unit is the one already installed here');
      }

      // 1. Close out the current installation
      await client.query(
        `UPDATE installations
         SET removed_at = now(), removed_by = $1, removal_reason = $2
         WHERE id = $3`,
        [performedBy, removalReason, activeInstallation.id]
      );

      // The removed unit goes back into the acting user's stock so it shows up
      // as something to run to the warehouse, rather than disappearing from
      // every stock view with a NULL location.
      const removedStatus = removalReason === 'faulty' ? 'faulty' : 'returned';
      await client.query(
        `UPDATE item_instances
         SET status = $1, current_location_id = $2, current_holder_id = NULL, updated_at = now()
         WHERE id = $3`,
        [removedStatus, returnTo, activeInstallation.item_instance_id]
      );

      // 2. Create the new installation
      const newInstallation = await client.query(
        `INSERT INTO installations
          (customer_premises_id, item_instance_id, installed_by, work_order_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [premisesId, newInstanceId, performedBy, workOrderId, idempotencyKey]
      );
      await client.query(
        `UPDATE item_instances
         SET status = 'installed', current_location_id = NULL,
             current_holder_id = NULL, updated_at = now()
         WHERE id = $1`,
        [newInstanceId]
      );

      // 3. Log both movements in the audit trail
      await client.query(
        `INSERT INTO transactions
          (item_id, item_instance_id, to_location_id, type, work_order_id, performed_by, notes)
         SELECT item_id, $1, $2, 'return', $3, $4, $5
         FROM item_instances WHERE id = $1`,
        [
          activeInstallation.item_instance_id,
          returnTo,
          workOrderId,
          performedBy,
          `Removed from premises ${premisesId} — reason: ${removalReason}`,
        ]
      );
      await client.query(
        `INSERT INTO transactions
          (item_id, item_instance_id, from_location_id, type, work_order_id, performed_by, notes)
         VALUES ($1, $2, $3, 'install', $4, $5, $6)`,
        [
          newInstance.item_id,
          newInstanceId,
          fromLocationId,
          workOrderId,
          performedBy,
          `Installed (replacement) at premises ${premisesId}`,
        ]
      );

      await client.query('COMMIT');
      res.status(201).json({ installation: newInstallation.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (isIdempotencyConflict(err)) {
        const existing = await db.query(
          'SELECT * FROM installations WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        if (existing.rows[0]) {
          return res.status(200).json({ installation: existing.rows[0], replayed: true });
        }
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
