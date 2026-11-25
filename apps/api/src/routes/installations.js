const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, conflict, forbidden, notFound } = require('../lib/errors');
const {
  requireFields,
  rejectFields,
  oneOf,
  intId,
  optionalIntId,
  optionalDate,
} = require('../lib/validate');
const { REMOVAL_REASONS } = require('../lib/constants');
const { lockInstance, assertInstallable } = require('../lib/stock');
const { readKey, findReplay, isIdempotencyConflict } = require('../lib/idempotency');
const {
  parseServiceLines,
  writeServiceLines,
  serviceLinesByInstallation,
} = require('../lib/jobLines');
const { isFieldTech, requireRole } = require('../middleware/auth');
const { attachPremisesToJob } = require('../lib/jobPremises');

// Every installation belongs to a job (012_jobs.sql). A caller may name one —
// the manager dispatched it, or the tech opened it on arrival — and if nobody
// did, one is opened here.
//
// That is the whole point of the change: the manager does not ticket every
// visit, so an install with no job used to be an install with nowhere to record
// what it consumed. Now the job always exists and the materials, labour and
// expenses have somewhere to hang.
async function resolveJob(client, { premisesId, requestedJobId, user, type }) {
  if (requestedJobId) {
    const found = await client.query(
      `SELECT id, customer_premises_id, site_id, assigned_tech_id, status
       FROM work_orders WHERE id = $1 FOR UPDATE`,
      [requestedJobId]
    );
    if (found.rows.length === 0) throw notFound('work_order not found');
    const job = found.rows[0];

    // A new install dispatched before anyone knew where it was has no premises
    // yet. Installing the router is the moment it gets one.
    if (!job.customer_premises_id) {
      if (isFieldTech(user) && Number(job.assigned_tech_id) !== user.id) {
        throw forbidden('That job is not assigned to you');
      }
      if (job.status === 'cancelled') {
        throw conflict(`Job ${job.id} was cancelled — open a new one for this visit`);
      }
      await attachPremisesToJob(client, job, premisesId);
      return job.id;
    }

    // 012 enforces this with a trigger as well. Catching it here says which
    // premises the job is actually at.
    if (Number(job.customer_premises_id) !== Number(premisesId)) {
      throw badRequest(
        `Job ${job.id} is at a different premises — a job and its installation ` +
          'have to be at the same address'
      );
    }
    if (isFieldTech(user) && Number(job.assigned_tech_id) !== user.id) {
      throw forbidden('That job is not assigned to you');
    }
    if (job.status === 'cancelled') {
      throw conflict(`Job ${job.id} was cancelled — open a new one for this visit`);
    }
    return job.id;
  }

  const created = await client.query(
    `INSERT INTO work_orders
       (customer_premises_id, site_id, type, status, assigned_tech_id, created_by,
        performed_on, notes)
     SELECT cp.id, cp.site_id, $2::work_order_type_enum, 'in_progress'::work_order_status_enum,
            $3::int, $4::int, $5::date, $6::text
       FROM customer_premises cp WHERE cp.id = $1
     RETURNING id`,
    [
      premisesId,
      type,
      isFieldTech(user) ? user.id : null,
      user.id,
      new Date().toISOString().slice(0, 10),
      'Job opened automatically for this visit',
    ]
  );
  return created.rows[0].id;
}

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

// Echoes the work just recorded, with the service names the client needs to
// show it, so a successful install does not have to be followed by a re-fetch.
// Skipped when no labour was recorded, which is the common case.
async function servicesFor(installationId, lines) {
  if (lines.length === 0) return [];
  const grouped = await serviceLinesByInstallation(db, [installationId]);
  return grouped[installationId] ?? [];
}

// Returns the premises row, locked: a hotspot's second router and a PPPoE
// customer's first one are decided by what is already installed, and two techs
// arriving together must not both see "nothing here yet".
async function lockPremises(client, premisesId) {
  const result = await client.query(
    `SELECT id, connection_type, is_active FROM customer_premises WHERE id = $1 FOR UPDATE`,
    [premisesId]
  );
  if (result.rows.length === 0) throw notFound('customer_premises not found');
  return result.rows[0];
}

// POST /api/installations
// Installs a router at a premises. A PPPoE premises takes one; a hotspot may take
// several, so installing again at a hotspot adds a router instead of conflicting.
// body: { customer_premises_id, item_instance_id, work_order_id?, services?, idempotency_key? }
//   services: [{ service_id, quantity?, unit_rate?, notes? }] — labour on this visit
//
// work_order_id is optional and stays optional, but the row is not: leaving it
// out opens a job for this visit rather than recording an install that belongs
// to nothing. Record materials and expenses against the job that comes back.
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
    const serviceLines = parseServiceLines(req.body.services);
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

      const premises = await lockPremises(client, premisesId);
      if (!premises.is_active) {
        throw conflict('This premises is a former client — reinstate it before installing here');
      }

      // Guard: a PPPoE premises takes one active router. The trigger
      // trg_one_active_router_unless_hotspot is the real guarantee; this check
      // exists to return a helpful 409 instead of a constraint error.
      if (premises.connection_type !== 'hotspot') {
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
      }

      const instance = await lockInstance(client, instanceId);
      assertInstallable(instance);
      assertInstanceReachable(req.user, instance);
      const fromLocationId = instance.current_location_id;

      const jobId = await resolveJob(client, {
        premisesId,
        requestedJobId: workOrderId,
        user: req.user,
        type: 'new_install',
      });

      const installation = await client.query(
        `INSERT INTO installations
          (customer_premises_id, item_instance_id, installed_by, work_order_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [premisesId, instanceId, installedBy, jobId, idempotencyKey]
      );

      await writeServiceLines(client, jobId, serviceLines);

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
          jobId,
          installedBy,
          `Installed at premises ${premisesId}`,
        ]
      );

      await client.query('COMMIT');
      const services = await servicesFor(installation.rows[0].id, serviceLines);
      res.status(201).json({ installation: { ...installation.rows[0], services } });
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
// body: { new_item_instance_id, removal_reason, installation_id?, work_order_id?,
//         return_to_location_id?, services?, idempotency_key? }
//
// `installation_id` says which router to take out. It can be left out when the
// premises has exactly one; a hotspot with several has to say, because guessing
// would pull the wrong one off the wall.
//
// `services` records the labour of THIS visit, against the job the replacement
// belongs to rather than the one being closed out — the work was done today.
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
    const installationId = optionalIntId(req.body.installation_id, 'installation_id');
    const returnTo = resolveReturnLocation(
      req.user,
      optionalIntId(req.body.return_to_location_id, 'return_to_location_id')
    );
    const serviceLines = parseServiceLines(req.body.services);
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
         ORDER BY installed_at, id
         FOR UPDATE`,
        [premisesId]
      );
      if (active.rows.length === 0) {
        throw notFound('No active router found at this premises');
      }

      let activeInstallation;
      if (installationId) {
        activeInstallation = active.rows.find((r) => Number(r.id) === installationId);
        if (!activeInstallation) {
          throw notFound('That router is not installed at this premises');
        }
      } else if (active.rows.length > 1) {
        throw badRequest(
          `This premises has ${active.rows.length} routers installed — ` +
            'send installation_id to say which one is being replaced'
        );
      } else {
        activeInstallation = active.rows[0];
      }

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
      // A swap for a better unit is an upgrade; a swap because the old one
      // died is a repair. Both are the same action to the tech, and the
      // distinction is worth keeping because it is the one the reports read.
      const jobId = await resolveJob(client, {
        premisesId,
        requestedJobId: workOrderId,
        user: req.user,
        type: removalReason === 'upgrade' ? 'upgrade' : 'repair',
      });

      const newInstallation = await client.query(
        `INSERT INTO installations
          (customer_premises_id, item_instance_id, installed_by, work_order_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [premisesId, newInstanceId, performedBy, jobId, idempotencyKey]
      );
      await client.query(
        `UPDATE item_instances
         SET status = 'installed', current_location_id = NULL,
             current_holder_id = NULL, updated_at = now()
         WHERE id = $1`,
        [newInstanceId]
      );
      await writeServiceLines(client, jobId, serviceLines);

      // 3. Log both movements in the audit trail
      await client.query(
        `INSERT INTO transactions
          (item_id, item_instance_id, to_location_id, type, work_order_id, performed_by, notes)
         SELECT item_id, $1, $2, 'return', $3, $4, $5
         FROM item_instances WHERE id = $1`,
        [
          activeInstallation.item_instance_id,
          returnTo,
          jobId,
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
          jobId,
          performedBy,
          `Installed (replacement) at premises ${premisesId}`,
        ]
      );

      await client.query('COMMIT');
      const services = await servicesFor(newInstallation.rows[0].id, serviceLines);
      res.status(201).json({ installation: { ...newInstallation.rows[0], services } });
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

// PATCH /api/installations/:id
// body: { installed_at?, removed_at?, work_order_id?, removal_reason? }
//
// Admin-only correction of an installation record. Everything a tech does in
// the field writes this row as a side effect of an action — installing,
// removing, replacing — and those are the paths to use while the facts are
// still true. This is for the record being wrong about facts that already
// happened: a job done on Friday and entered on Monday, a visit that was never
// linked to its work order, a removal filed under the wrong reason.
//
// What it will not do is change WHICH unit is installed WHERE, or whether an
// installation is still live. Those are the two things the rest of the schema
// hangs off — item_instances.status, the one-active-install-per-premises index,
// the audit trail — and moving them from here would leave the other rows
// describing a different world. Remove and re-install instead.
router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    rejectFields(
      req.body,
      ['customer_premises_id', 'item_instance_id', 'installed_by', 'removed_by'],
      'a correction cannot rewrite who did what, or to which unit — ' +
        'remove the installation and record it again'
    );

    const existing = await db.query(
      `SELECT id, installed_at, removed_at, removal_reason FROM installations WHERE id = $1`,
      [id]
    );
    if (existing.rows.length === 0) throw notFound('Installation not found');
    const current = existing.rows[0];

    const sets = [];
    const params = [];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    const installedAt = optionalDate(req.body.installed_at, 'installed_at');
    if (req.body.installed_at !== undefined) {
      if (!installedAt) throw badRequest('installed_at cannot be cleared');
      set('installed_at', installedAt);
    }

    if (req.body.removed_at !== undefined) {
      if (!current.removed_at) {
        throw conflict(
          'This installation is still live. Use POST /api/installations/:premisesId/remove ' +
            'so the unit goes back into stock too.'
        );
      }
      const removedAt = optionalDate(req.body.removed_at, 'removed_at');
      if (!removedAt) {
        throw conflict(
          'Clearing removed_at would put a removed unit back into service on paper only. ' +
            'Record a new installation instead.'
        );
      }
      set('removed_at', removedAt);
    }

    if (req.body.removal_reason !== undefined) {
      // removal_reason_required_if_removed: the database refuses a removed row
      // with no reason, so say so here rather than letting it surface as a 400
      // from a constraint name.
      if (!current.removed_at) {
        throw badRequest('removal_reason only applies to an installation that has been removed');
      }
      set('removal_reason', oneOf(req.body.removal_reason, REMOVAL_REASONS, 'removal_reason'));
    }

    if (req.body.work_order_id !== undefined) {
      set('work_order_id', optionalIntId(req.body.work_order_id, 'work_order_id'));
    }

    if (sets.length === 0) throw badRequest('No editable fields were provided');

    const startsAt = installedAt ?? current.installed_at;
    const endsAt = req.body.removed_at !== undefined ? req.body.removed_at : current.removed_at;
    if (endsAt && new Date(endsAt) < new Date(startsAt)) {
      throw badRequest('removed_at cannot be before installed_at');
    }

    params.push(id);
    const result = await db.query(
      `UPDATE installations SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    const grouped = await serviceLinesByInstallation(db, [id]);
    res.json({ installation: { ...result.rows[0], services: grouped[id] ?? [] } });
  })
);

// PUT /api/installations/:id/services
// Replaces the recorded labour for the JOB this installation belongs to.
// body: { services: [{ service_id, quantity?, unit_rate?, notes? }] }
//
// PUT rather than POST because the body is the complete list: sending [] is how
// you clear it, and re-sending the same list twice leaves the same rows. A tech
// on a flaky connection can retry safely without needing an idempotency key.
//
// Kept as an installation-addressed route although 013 moved labour onto the
// job, because "record the work on this router" is how the premises screens are
// laid out and an installation names exactly one job. PUT
// /api/work-orders/:id/services is the same write reached from the job side,
// and is the one to use when the visit fitted no hardware at all.
router.put(
  '/:id/services',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const lines = parseServiceLines(req.body?.services);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const found = await client.query(
        `SELECT inst.id, inst.installed_by, inst.removed_at, inst.work_order_id, wo.status
         FROM installations inst
         JOIN work_orders wo ON wo.id = inst.work_order_id
         WHERE inst.id = $1
         FOR UPDATE OF inst, wo`,
        [id]
      );
      if (found.rows.length === 0) throw notFound('Installation not found');
      const installation = found.rows[0];

      if (installation.status === 'cancelled') {
        throw conflict('That job was cancelled — open a new one to record work against it');
      }

      // A tech corrects their own job while it is still the live one. Fixing
      // the record of a visit that has since been replaced is a back-office
      // job, and closed-out history should not move under a report's feet.
      if (isFieldTech(req.user)) {
        if (Number(installation.installed_by) !== req.user.id) {
          throw forbidden('You can only record work on an installation you performed');
        }
        if (installation.removed_at) {
          throw conflict(
            'This router has since been replaced — ask the warehouse to amend the record'
          );
        }
      }

      await writeServiceLines(client, Number(installation.work_order_id), lines);
      await client.query('COMMIT');

      const grouped = await serviceLinesByInstallation(db, [id]);
      res.json({
        installation_id: id,
        work_order_id: Number(installation.work_order_id),
        services: grouped[id] ?? [],
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
