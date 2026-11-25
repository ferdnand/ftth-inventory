// Jobs, mounted at /api/work-orders.
//
// One job is one visit, and it owns everything that visit produced: the unit
// fitted, the materials used, the labour, and the money spent getting there.
// 012 made every installation belong to one, so this is now the centre of the
// model rather than the optional dispatch layer 001 described.
//
// Two things changed about who may open one:
//
//   * a field tech can. The manager does not ticket every job — most of the
//     work out here is found, not dispatched — and a tech who cannot open a
//     job has nowhere to record what they just did.
//   * a job can be opened at a premises that does not exist yet. POST accepts
//     a `premises` object and creates both in one transaction, because the
//     alternative is a tech who captures a household, loses signal, and has an
//     orphan address with no job against it.
//
// The three line endpoints are all PUT with the complete list. See lib/jobLines.js.
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
  optionalString,
  optionalDate,
} = require('../lib/validate');
const { WORK_ORDER_TYPES, WORK_ORDER_STATUSES } = require('../lib/constants');
const { insertPremises, shapePremises } = require('../lib/premises');
const {
  parseServiceLines,
  writeServiceLines,
  serviceLinesByJob,
  parseMaterialLines,
  writeMaterialLines,
  materialLinesByJob,
  parseExpenseLines,
  writeExpenseLines,
  expenseLinesByJob,
  jobCostSummary,
} = require('../lib/jobLines');
const { isFieldTech, requireAssignedLocation, requireRole } = require('../middleware/auth');

// `address` stays in the select for the clients that already read it; `label`
// is what to show now that a premises may not have one. See premisesLabel.
const JOB_SELECT = `
  SELECT wo.*,
         cp.address, cp.landmark, cp.village, cp.customer_name, cp.customer_phone,
         cp.customer_account_id, cp.premises_type, cp.notes AS premises_notes,
         cp.gps_lat, cp.gps_lng, cp.gps_accuracy_m, cp.site_id,
         site.name AS site_name,
         tech.name AS assigned_tech_name,
         opener.name AS created_by_name
  FROM work_orders wo
  JOIN customer_premises cp ON cp.id = wo.customer_premises_id
  LEFT JOIN locations site ON site.id = cp.site_id
  LEFT JOIN users tech ON tech.id = wo.assigned_tech_id
  LEFT JOIN users opener ON opener.id = wo.created_by
`;

// The row a client lists or renders. shapePremises does the label and the
// coordinate coercion; the premises columns are flattened onto the job rather
// than nested so the existing list rendering keeps working.
function shapeJob(row) {
  const premises = shapePremises({
    id: row.customer_premises_id,
    address: row.address,
    landmark: row.landmark,
    village: row.village,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    customer_account_id: row.customer_account_id,
    premises_type: row.premises_type,
    notes: row.premises_notes,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy_m: row.gps_accuracy_m,
    site_id: row.site_id,
    site_name: row.site_name,
  });

  // `premises_notes` is an alias that only exists to stop cp.notes colliding
  // with work_orders.notes in the flattened row. It has served its purpose by
  // the time it reaches `premises`, so it does not go out on the wire.
  const { premises_notes: _premisesNotes, ...job } = row;

  return {
    ...job,
    gps_lat: premises.gps_lat,
    gps_lng: premises.gps_lng,
    gps_accuracy_m: premises.gps_accuracy_m,
    label: premises.label,
    premises,
  };
}

// A tech's world is their own jobs. Warehouse staff, PMs and admins see all of
// them — an admin passes requireRole checks everywhere, and this is the same
// rule expressed for a query rather than a route.
function assertJobVisible(user, job) {
  if (!isFieldTech(user)) return;
  if (Number(job.assigned_tech_id) !== user.id) {
    throw forbidden('That job is not assigned to you');
  }
}

// Loads a job for editing. `forUpdate` takes the row lock the line writers need
// so two saves of the same job cannot interleave.
async function loadJob(queryable, id, user, { forUpdate = false } = {}) {
  const result = await queryable.query(
    `SELECT id, customer_premises_id, status, assigned_tech_id, created_by, performed_on
     FROM work_orders WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (result.rows.length === 0) throw notFound('Job not found');
  const job = result.rows[0];
  assertJobVisible(user, job);
  return job;
}

// A cancelled job did not happen. Recording what it used would put stock and
// money against a visit the business has said it is not counting, so the lines
// are frozen — everything else stays editable, including a completed job, so a
// cost remembered on the drive home still has somewhere to go.
function assertLinesEditable(job) {
  if (job.status === 'cancelled') {
    throw conflict('This job was cancelled — reopen it as a new job to record work against it');
  }
}

// ------------------------------------------------------------
// List
// ------------------------------------------------------------

// GET /api/work-orders?assigned_tech_id=&status=&customer_premises_id=&site_id=
//                     &open=true&performed_from=&performed_to=&with_costs=true
//
// `assigned_tech_id=me` resolves to the caller, so the mobile app does not have
// to know its own id to build a query string.
//
// `open=true` is the field app's home screen in one parameter: everything not
// finished with. Two round trips for status=open and status=in_progress was the
// tech waiting twice on a village connection.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = [];
    const push = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const rawTech = req.query.assigned_tech_id;
    const techId = rawTech === 'me' ? req.user.id : optionalIntId(rawTech, 'assigned_tech_id');

    // A tech's job list is always their own, whatever they asked for.
    const scopedTech = isFieldTech(req.user) ? req.user.id : techId;
    if (scopedTech) clauses.push(`wo.assigned_tech_id = ${push(scopedTech)}`);

    if (req.query.status) {
      clauses.push(`wo.status = ${push(oneOf(req.query.status, WORK_ORDER_STATUSES, 'status'))}`);
    }
    if (req.query.open === 'true') {
      clauses.push(`wo.status IN ('open', 'in_progress')`);
    }
    if (req.query.customer_premises_id) {
      clauses.push(
        `wo.customer_premises_id = ${push(
          intId(req.query.customer_premises_id, 'customer_premises_id')
        )}`
      );
    }
    if (req.query.site_id) {
      clauses.push(`cp.site_id = ${push(intId(req.query.site_id, 'site_id'))}`);
    }
    const performedFrom = optionalDate(req.query.performed_from, 'performed_from');
    const performedTo = optionalDate(req.query.performed_to, 'performed_to');
    if (performedFrom) clauses.push(`wo.performed_on >= ${push(performedFrom)}::date`);
    if (performedTo) clauses.push(`wo.performed_on <= ${push(performedTo)}::date`);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(
      `${JOB_SELECT} ${where}
       ORDER BY coalesce(wo.performed_on, wo.scheduled_date) DESC NULLS LAST,
                wo.created_at DESC`,
      params
    );

    const jobs = result.rows.map(shapeJob);

    // Totals are opt-in: the field app's job list does not show money, and the
    // roll-up is four aggregates it would pay for on every refresh.
    if (req.query.with_costs === 'true') {
      const costs = await jobCostSummary(
        db,
        jobs.map((job) => Number(job.id))
      );
      for (const job of jobs) job.costs = costs[Number(job.id)] ?? null;
    }

    res.json({ work_orders: jobs });
  })
);

// ------------------------------------------------------------
// Detail
// ------------------------------------------------------------

// GET /api/work-orders/:id
//
// Everything about the visit in one response: the premises, the unit fitted,
// the materials, the labour, the expenses, and what it all came to. One round
// trip because the field app opens this screen on a village connection and
// then works offline from what it got.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const result = await db.query(`${JOB_SELECT} WHERE wo.id = $1`, [id]);
    if (result.rows.length === 0) throw notFound('Job not found');

    const job = shapeJob(result.rows[0]);
    assertJobVisible(req.user, job);

    const [materials, services, expenses, costs, installations] = await Promise.all([
      materialLinesByJob(db, [id]),
      serviceLinesByJob(db, [id]),
      expenseLinesByJob(db, [id]),
      jobCostSummary(db, [id]),
      db.query(
        `SELECT inst.id AS installation_id, inst.installed_at, inst.removed_at,
                inst.removal_reason,
                ii.id AS item_instance_id, ii.serial_number, ii.mac_address,
                i.name AS item_name, i.unit_cost,
                installer.name AS installed_by_name
         FROM installations inst
         JOIN item_instances ii ON ii.id = inst.item_instance_id
         JOIN items i ON i.id = ii.item_id
         JOIN users installer ON installer.id = inst.installed_by
         WHERE inst.work_order_id = $1
         ORDER BY inst.installed_at`,
        [id]
      ),
    ]);

    res.json({
      work_order: {
        ...job,
        materials: materials[id] ?? [],
        services: services[id] ?? [],
        expenses: expenses[id] ?? [],
        costs: costs[id] ?? null,
        installations: installations.rows.map((row) => ({
          ...row,
          unit_cost: row.unit_cost === null ? null : Number(row.unit_cost),
        })),
      },
    });
  })
);

// ------------------------------------------------------------
// Create
// ------------------------------------------------------------

// POST /api/work-orders
// body: { type,
//         customer_premises_id  |  premises: { address?, customer_name?, village?,
//                                             landmark?, gps_lat?, gps_lng?, ... },
//         assigned_tech_id?, scheduled_date?, performed_on?, status?, notes? }
//
// A field tech gets the job assigned to themselves whatever they send: the
// point of letting them open one is to record work they are doing, and a tech
// dispatching another tech is a manager's decision.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    rejectFields(req.body, ['created_by'], 'it is taken from your access token');
    requireFields(req.body, ['type']);

    const type = oneOf(req.body.type, WORK_ORDER_TYPES, 'type');
    const notes = optionalString(req.body.notes, 'notes', 1000);
    const scheduledDate = optionalDate(req.body.scheduled_date, 'scheduled_date');
    const performedOn = optionalDate(req.body.performed_on, 'performed_on');

    const hasPremisesId =
      req.body.customer_premises_id !== undefined && req.body.customer_premises_id !== null;
    const hasNewPremises = req.body.premises !== undefined && req.body.premises !== null;

    if (hasPremisesId && hasNewPremises) {
      throw badRequest(
        'Send customer_premises_id for a place already on record, or premises to capture a ' +
          'new one — not both'
      );
    }
    if (!hasPremisesId && !hasNewPremises) {
      throw badRequest(
        'customer_premises_id is required, or send a premises object to capture a new one'
      );
    }

    // A tech-opened job is in progress by the time it exists — they are
    // standing at the premises. A dispatched one is open until someone goes.
    const defaultStatus = isFieldTech(req.user) ? 'in_progress' : 'open';
    const status =
      req.body.status === undefined
        ? defaultStatus
        : oneOf(req.body.status, ['open', 'in_progress'], 'status');

    const techId = isFieldTech(req.user)
      ? req.user.id
      : optionalIntId(req.body.assigned_tech_id, 'assigned_tech_id');

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      let premisesId;
      let premises;
      if (hasNewPremises) {
        if (typeof req.body.premises !== 'object' || Array.isArray(req.body.premises)) {
          throw badRequest('premises must be an object');
        }
        premises = shapePremises(await insertPremises(client, req.body.premises, req.user.id));
        premisesId = premises.id;
      } else {
        premisesId = intId(req.body.customer_premises_id, 'customer_premises_id');
        const found = await client.query('SELECT id FROM customer_premises WHERE id = $1', [
          premisesId,
        ]);
        if (found.rows.length === 0) throw notFound('customer_premises not found');
      }

      // A tech opening their own job is recording today's work, so today is the
      // honest default. A dispatcher is planning ahead and leaves it null until
      // the work is actually done.
      const resolvedPerformedOn =
        performedOn ?? (isFieldTech(req.user) ? new Date().toISOString().slice(0, 10) : null);

      const created = await client.query(
        `INSERT INTO work_orders
           (customer_premises_id, type, status, assigned_tech_id, created_by,
            scheduled_date, performed_on, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          premisesId,
          type,
          status,
          techId,
          req.user.id,
          scheduledDate,
          resolvedPerformedOn,
          notes,
        ]
      );

      await client.query('COMMIT');

      const full = await db.query(`${JOB_SELECT} WHERE wo.id = $1`, [created.rows[0].id]);
      res.status(201).json({ work_order: shapeJob(full.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

// ------------------------------------------------------------
// Update
// ------------------------------------------------------------

// Which status a job may move to from where. A completed or cancelled job is
// terminal — reopening one would make `completed_at` meaningless.
const STATUS_TRANSITIONS = {
  open: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'open'],
  completed: [],
  cancelled: [],
};

// PATCH /api/work-orders/:id
// body: { status?, assigned_tech_id?, scheduled_date?, performed_on?, notes? }
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const existing = await db.query(
      'SELECT id, status, assigned_tech_id, performed_on FROM work_orders WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) throw notFound('Job not found');
    const current = existing.rows[0];
    assertJobVisible(req.user, current);

    // A tech may progress and annotate their own job, and say which day they
    // did it — that last one matters because the day the work happened and the
    // day the phone had signal are routinely not the same. Reassigning and
    // rescheduling stay with whoever plans the work.
    if (isFieldTech(req.user)) {
      const techEditable = ['status', 'notes', 'performed_on'];
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
              ? `A ${current.status} job cannot change status`
              : `A ${current.status} job can only move to: ${allowed.join(', ')}`
          );
        }
        set('status', next);
        // work_order_completed_at_required enforces this in the database too.
        set('completed_at', next === 'completed' ? new Date() : null);

        // Completing a job that never said which day it was done means today.
        // Without this, every tech-completed job with a blank date drops out of
        // the reports that window on performed_on.
        if (next === 'completed' && !current.performed_on && req.body.performed_on === undefined) {
          set('performed_on', new Date().toISOString().slice(0, 10));
        }
      }
    }
    if (req.body.assigned_tech_id !== undefined) {
      set('assigned_tech_id', optionalIntId(req.body.assigned_tech_id, 'assigned_tech_id'));
    }
    if (req.body.scheduled_date !== undefined) {
      set('scheduled_date', optionalDate(req.body.scheduled_date, 'scheduled_date'));
    }
    if (req.body.performed_on !== undefined) {
      set('performed_on', optionalDate(req.body.performed_on, 'performed_on'));
    }
    if (req.body.notes !== undefined) {
      set('notes', optionalString(req.body.notes, 'notes', 1000));
    }

    if (sets.length === 0) throw badRequest('No editable fields were provided');

    params.push(id);
    await db.query(
      `UPDATE work_orders SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );

    const full = await db.query(`${JOB_SELECT} WHERE wo.id = $1`, [id]);
    res.json({ work_order: shapeJob(full.rows[0]) });
  })
);

// DELETE /api/work-orders/:id   (admin only)
//
// For a job dispatched by mistake. Once a job has a fitted unit, drawn stock, or
// any recorded labour or expense it is part of the cost and stock history, and
// deleting it would make those numbers vanish — cancel it instead, which keeps
// the record but stops it counting.
router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const job = await client.query('SELECT id FROM work_orders WHERE id = $1 FOR UPDATE', [id]);
      if (job.rows.length === 0) throw notFound('Job not found');

      const refs = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM installations WHERE work_order_id = $1)::int AS installs,
           (SELECT COUNT(*) FROM transactions WHERE work_order_id = $1)::int AS movements,
           (SELECT COUNT(*) FROM job_materials WHERE work_order_id = $1)::int AS materials,
           (SELECT COUNT(*) FROM job_services WHERE work_order_id = $1)::int AS labour,
           (SELECT COUNT(*) FROM job_expenses WHERE work_order_id = $1)::int AS expenses`,
        [id]
      );
      const r = refs.rows[0];
      const reasons = [];
      if (r.installs) reasons.push('a recorded installation');
      if (r.movements) reasons.push(`${r.movements} stock movement(s)`);
      if (r.materials) reasons.push(`${r.materials} material line(s)`);
      if (r.labour) reasons.push(`${r.labour} labour line(s)`);
      if (r.expenses) reasons.push(`${r.expenses} expense(s)`);
      if (reasons.length > 0) {
        throw conflict(
          `Job #${id} cannot be deleted because it has ${reasons.join(', ')}. ` +
            'Cancel it instead — the record stays but it stops counting.'
        );
      }

      await client.query('DELETE FROM work_orders WHERE id = $1', [id]);
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
// Lines
// ------------------------------------------------------------

// Each of the three is the same transaction: lock the job, check it can still
// take lines, replace them, read them back.
async function replaceLines(req, res, { parse, write, read, key }) {
  const id = intId(req.params.id, 'id');
  const lines = parse(req.body?.[key]);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const job = await loadJob(client, id, req.user, { forUpdate: true });
    assertLinesEditable(job);

    await write(client, job, lines);
    await client.query('COMMIT');

    const [grouped, costs] = await Promise.all([read(db, [id]), jobCostSummary(db, [id])]);
    res.json({ work_order_id: id, [key]: grouped[id] ?? [], costs: costs[id] ?? null });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// PUT /api/work-orders/:id/materials
// body: { materials: [{ item_id, quantity, unit_cost?, notes? }] }
//
// This is the one that moves stock. Sending the complete list and letting the
// server work out the difference is what makes it safe to retry: the same list
// twice moves nothing the second time. Bulk items only — a router goes through
// POST /api/installations, which is what ties a serial to a premises.
router.put(
  '/:id/materials',
  asyncHandler(async (req, res) => {
    // Where new lines are drawn from. A tech's van; anyone else has to say,
    // because they have no van of their own to default to.
    const requested = optionalIntId(req.body?.from_location_id, 'from_location_id');
    const defaultLocationId = isFieldTech(req.user)
      ? requireAssignedLocation(req.user)
      : requested ?? req.user.assigned_location_id;

    if (!defaultLocationId) {
      throw badRequest(
        'from_location_id is required — say which stock these materials came out of'
      );
    }
    if (isFieldTech(req.user) && requested && Number(requested) !== Number(defaultLocationId)) {
      throw forbidden('Field techs can only record materials out of their own van');
    }

    await replaceLines(req, res, {
      key: 'materials',
      parse: parseMaterialLines,
      write: (client, job, lines) =>
        writeMaterialLines(client, {
          jobId: job.id,
          lines,
          defaultLocationId,
          user: req.user,
        }),
      read: materialLinesByJob,
    });
  })
);

// PUT /api/work-orders/:id/services
// body: { services: [{ service_id, quantity?, unit_rate?, notes? }] }
router.put(
  '/:id/services',
  asyncHandler(async (req, res) => {
    await replaceLines(req, res, {
      key: 'services',
      parse: parseServiceLines,
      write: (client, job, lines) => writeServiceLines(client, job.id, lines),
      read: serviceLinesByJob,
    });
  })
);

// PUT /api/work-orders/:id/expenses
// body: { expenses: [{ category, amount, description? }] }
router.put(
  '/:id/expenses',
  asyncHandler(async (req, res) => {
    await replaceLines(req, res, {
      key: 'expenses',
      parse: parseExpenseLines,
      write: (client, job, lines) => writeExpenseLines(client, job.id, lines, req.user.id),
      read: expenseLinesByJob,
    });
  })
);

module.exports = router;
