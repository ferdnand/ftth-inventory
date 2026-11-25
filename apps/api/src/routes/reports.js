const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler } = require('../lib/errors');
const { oneOf, optionalIntId, optionalDate } = require('../lib/validate');
const { requireRole } = require('../middleware/auth');

// Reporting aggregates.
//
// These are server-side on purpose. Computing them in the client would mean
// fanning GET /api/stock out once per location and paging the whole audit trail
// over HTTP — an N+1 against a capped list, which gets slower and less correct
// as the data grows.
//
// Every date bucket uses date_trunc in the session timezone set by lib/db.js, so
// a "September" figure means the same thing to the database and to the person
// reading the dashboard.

router.use(requireRole('warehouse_staff', 'pm'));

// Consumption in this domain means stock that left the business, not stock that
// moved between locations:
//   - 'install' — a serialized unit went into a customer premises (1 unit each)
//   - 'issue'   — bulk material was consumed on a job (the quantity)
// A 'transfer' is explicitly not consumption; it would double-count.
const CONSUMPTION_TYPES = "('install', 'issue')";
const CONSUMED_QUANTITY = "SUM(COALESCE(t.quantity, 1))";

// Money adds up through JS floats on its way out of pg; a costing tile should
// not read 1200.0000000000002.
const round2 = (n) => Math.round(n * 100) / 100;

// Default window for every report that takes one.
function dateRange(query) {
  const from = optionalDate(query.from, 'from');
  const to = optionalDate(query.to, 'to');
  return {
    from: from || null,
    to: to || null,
    // `to` is inclusive of the whole day the caller named.
    clause: `
      AND ($1::date IS NULL OR t.created_at >= $1::date)
      AND ($2::date IS NULL OR t.created_at < $2::date + 1)
    `,
    params: [from, to],
  };
}

// GET /api/reports/summary
// The overview tiles. One round trip rather than five.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM installations WHERE removed_at IS NULL)::int
          AS active_installations,
        (SELECT COUNT(*) FROM item_instances WHERE status = 'in_stock')::int
          AS serialized_units_in_stock,
        (SELECT COUNT(*) FROM item_instances WHERE status IN ('faulty', 'returned'))::int
          AS units_awaiting_return,
        (SELECT COUNT(*) FROM work_orders WHERE status IN ('open', 'in_progress'))::int
          AS open_work_orders,
        (SELECT COUNT(*) FROM restock_requests WHERE status IN ('requested', 'approved'))::int
          AS pending_restock_requests,
        (SELECT COUNT(*) FROM installations
          WHERE installed_at >= date_trunc('month', now()))::int
          AS installs_this_month,
        (SELECT COUNT(*) FROM installations
          WHERE removed_at >= date_trunc('month', now()))::int
          AS removals_this_month
    `);
    res.json({ summary: result.rows[0] });
  })
);

// GET /api/reports/low-stock?location_id=
//
// The blind spot this query exists to close: a naive GROUP BY over stock_levels
// or item_instances can only report items that still have a row. A van that ran
// out of an item completely has nothing to group, so the item that most needs
// reordering is the one that disappears from the report. Hence the cross join —
// every active item with a threshold, against every warehouse and van, whether
// or not stock is currently held there.
router.get(
  '/low-stock',
  asyncHandler(async (req, res) => {
    const locationId = optionalIntId(req.query.location_id, 'location_id');

    const result = await db.query(
      `WITH stocking_locations AS (
         SELECT id, name, type FROM locations
         WHERE type IN ('warehouse', 'tech_van')
           AND ($1::int IS NULL OR id = $1::int)
       ),
       tracked_items AS (
         SELECT id, name, category, tracking_type, unit_of_measure, reorder_threshold
         FROM items
         WHERE is_active = TRUE AND reorder_threshold IS NOT NULL
       ),
       expected AS (
         SELECT l.id AS location_id, l.name AS location_name, l.type AS location_type,
                i.id AS item_id, i.name AS item_name, i.category, i.tracking_type,
                i.unit_of_measure, i.reorder_threshold
         FROM stocking_locations l
         CROSS JOIN tracked_items i
       ),
       on_hand AS (
         SELECT e.*,
                CASE e.tracking_type
                  WHEN 'bulk' THEN COALESCE(sl.quantity, 0)
                  ELSE COALESCE(inst.units, 0)
                END AS quantity
         FROM expected e
         LEFT JOIN stock_levels sl
           ON sl.item_id = e.item_id AND sl.location_id = e.location_id
         LEFT JOIN (
           SELECT item_id, current_location_id, COUNT(*) AS units
           FROM item_instances
           WHERE status = 'in_stock'
           GROUP BY item_id, current_location_id
         ) inst
           ON inst.item_id = e.item_id AND inst.current_location_id = e.location_id
       )
       SELECT location_id, location_name, location_type,
              item_id, item_name, category, tracking_type, unit_of_measure,
              quantity, reorder_threshold,
              ROUND(quantity / NULLIF(reorder_threshold, 0), 3) AS ratio
       FROM on_hand
       WHERE quantity <= reorder_threshold
       ORDER BY quantity / NULLIF(reorder_threshold, 0) NULLS FIRST,
                location_name, category, item_name`,
      [locationId]
    );

    res.json({ low_stock: result.rows });
  })
);

// GET /api/reports/consumption?from&to&group_by=item|category|location
router.get(
  '/consumption',
  asyncHandler(async (req, res) => {
    const groupBy = req.query.group_by
      ? oneOf(req.query.group_by, ['item', 'category', 'location'], 'group_by')
      : 'item';
    const range = dateRange(req.query);

    const GROUPINGS = {
      item: {
        key: 'i.id',
        select: 'i.id AS item_id, i.name AS label, i.category, i.unit_of_measure',
        group: 'i.id, i.name, i.category, i.unit_of_measure',
      },
      category: {
        key: 'i.category',
        select: 'i.category AS label',
        group: 'i.category',
      },
      location: {
        key: 'l.id',
        select: 'l.id AS location_id, COALESCE(l.name, \'(unassigned)\') AS label, l.type AS location_type',
        group: 'l.id, l.name, l.type',
      },
    };
    const grouping = GROUPINGS[groupBy];

    const result = await db.query(
      `SELECT ${grouping.select},
              ${CONSUMED_QUANTITY} AS quantity,
              COUNT(*)::int AS movement_count
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       LEFT JOIN locations l ON l.id = t.from_location_id
       WHERE t.type IN ${CONSUMPTION_TYPES}
       ${range.clause}
       GROUP BY ${grouping.group}
       ORDER BY quantity DESC`,
      range.params
    );

    res.json({
      group_by: groupBy,
      from: range.from,
      to: range.to,
      consumption: result.rows,
    });
  })
);

// GET /api/reports/services?from&to&group_by=service|tech
//
// Labour performed, which is deliberately absent from /consumption: a splice is
// not stock leaving the business, and folding the two together would make
// "consumed" mean two different things in one number.
//
// The window is on work_orders.performed_on — the day the work was DONE, not
// created_at, which is only when someone got signal and typed it in. A tech
// recording Friday's splice on Monday belongs in Friday's figures. Jobs that
// never said which day fall back to the completion date and then to when the
// ticket was opened, so a row can never drop out of every window.
//
// Labour moved from installations to jobs in 013, which is what lets a visit
// that fitted no hardware count here at all — a re-splice of a cut cable is
// billable work and used to be invisible.
const JOB_WORK_DAY = 'coalesce(wo.performed_on, wo.completed_at::date, wo.created_at::date)';

router.get(
  '/services',
  asyncHandler(async (req, res) => {
    const groupBy = req.query.group_by
      ? oneOf(req.query.group_by, ['service', 'tech'], 'group_by')
      : 'service';
    const from = optionalDate(req.query.from, 'from');
    const to = optionalDate(req.query.to, 'to');

    const window = `
      AND ($1::date IS NULL OR ${JOB_WORK_DAY} >= $1::date)
      AND ($2::date IS NULL OR ${JOB_WORK_DAY} <= $2::date)
      AND wo.status <> 'cancelled'
    `;

    // Grouped by service, quantity is meaningful: every row is one unit of
    // measure. Grouped by tech it would add 40 metres to 3 splices, so that
    // shape counts lines and visits instead and reports no quantity at all.
    const GROUPINGS = {
      service: {
        select: `s.id AS service_id, s.name AS label, s.unit_of_measure,
                 SUM(js.quantity) AS quantity,
                 SUM(js.quantity * js.unit_rate) AS value,
                 COUNT(*)::int AS services_performed,
                 COUNT(DISTINCT wo.id)::int AS visits`,
        group: 's.id, s.name, s.unit_of_measure',
        order: 'quantity DESC',
        join: 'JOIN services s ON s.id = js.service_id',
      },
      tech: {
        select: `u.id AS user_id, u.name AS label, u.role,
                 NULL::numeric AS quantity,
                 SUM(js.quantity * js.unit_rate) AS value,
                 COUNT(*)::int AS services_performed,
                 COUNT(DISTINCT wo.id)::int AS visits`,
        group: 'u.id, u.name, u.role',
        order: 'services_performed DESC, u.name',
        // A job's labour is credited to whoever it is assigned to, and to
        // whoever opened it when nobody was assigned — which is the tech, on
        // every job a tech opens for themselves.
        join: 'JOIN users u ON u.id = coalesce(wo.assigned_tech_id, wo.created_by)',
      },
    };
    const grouping = GROUPINGS[groupBy];

    const rows = await db.query(
      `SELECT ${grouping.select}
       FROM job_services js
       JOIN work_orders wo ON wo.id = js.work_order_id
       ${grouping.join}
       WHERE TRUE ${window}
       GROUP BY ${grouping.group}
       ORDER BY ${grouping.order}`,
      [from, to]
    );

    // Totals stay split by unit for the same reason: one "total quantity" over
    // jobs and metres would be a number with no meaning. The tiles read
    // "37 jobs · 412 m", not "449".
    const byUnit = await db.query(
      `SELECT s.unit_of_measure, SUM(js.quantity) AS quantity
       FROM job_services js
       JOIN services s ON s.id = js.service_id
       JOIN work_orders wo ON wo.id = js.work_order_id
       WHERE TRUE ${window}
       GROUP BY s.unit_of_measure
       ORDER BY s.unit_of_measure`,
      [from, to]
    );

    const totals = await db.query(
      `SELECT COUNT(*)::int AS services_performed,
              COUNT(DISTINCT js.work_order_id)::int AS visits,
              COUNT(DISTINCT js.service_id)::int AS distinct_services,
              SUM(js.quantity * js.unit_rate) AS value,
              COUNT(*) FILTER (WHERE js.unit_rate IS NULL)::int AS unpriced_lines
       FROM job_services js
       JOIN work_orders wo ON wo.id = js.work_order_id
       WHERE TRUE ${window}`,
      [from, to]
    );

    res.json({
      group_by: groupBy,
      from,
      to,
      currency: 'KES',
      services: rows.rows,
      totals: { ...totals.rows[0], by_unit: byUnit.rows },
    });
  })
);

// GET /api/reports/job-costs?from&to&group_by=site|type|tech|month
//
// What the work cost, which is the question none of the other reports could
// answer. /consumption counts stock movements and /services counts labour, and
// neither of them knows about the fare that got the tech to the compound.
//
// Every bucket is reported separately rather than as one figure, because they
// are four different kinds of spend and because any of them can be unpriced.
// `unpriced_lines` is the honesty column: a total sitting next to a non-zero
// count of unpriced lines is a floor, not a cost, and a dashboard that hides
// that is worse than one showing no number at all.
router.get(
  '/job-costs',
  asyncHandler(async (req, res) => {
    const groupBy = req.query.group_by
      ? oneOf(req.query.group_by, ['site', 'type', 'tech', 'month'], 'group_by')
      : 'site';
    const from = optionalDate(req.query.from, 'from');
    const to = optionalDate(req.query.to, 'to');

    const GROUPINGS = {
      site: {
        select: "coalesce(site.name, '(no site set)') AS label",
        group: 'site.name',
        order: 'total DESC',
      },
      type: { select: 'pj.type AS label', group: 'pj.type', order: 'total DESC' },
      tech: {
        select: "coalesce(u.name, '(unassigned)') AS label",
        group: 'u.name',
        order: 'total DESC',
      },
      month: {
        select: "to_char(date_trunc('month', pj.work_day), 'YYYY-MM') AS label",
        group: "date_trunc('month', pj.work_day)",
        order: 'label',
      },
    };
    const grouping = GROUPINGS[groupBy];

    // One row per job first, then aggregate. Joining the three line tables
    // straight into one GROUP BY would multiply every material line by the
    // number of labour lines on the same job.
    const result = await db.query(
      `WITH per_job AS (
         SELECT wo.id, wo.type, wo.site_id,
                coalesce(wo.assigned_tech_id, wo.created_by) AS tech_id,
                ${JOB_WORK_DAY} AS work_day,
                (SELECT coalesce(SUM(jm.quantity * jm.unit_cost), 0)
                   FROM job_materials jm WHERE jm.work_order_id = wo.id) AS materials,
                (SELECT coalesce(SUM(js.quantity * js.unit_rate), 0)
                   FROM job_services js WHERE js.work_order_id = wo.id) AS labour,
                (SELECT coalesce(SUM(je.amount), 0)
                   FROM job_expenses je WHERE je.work_order_id = wo.id) AS expenses,
                (SELECT coalesce(SUM(i.unit_cost), 0)
                   FROM installations inst
                   JOIN item_instances ii ON ii.id = inst.item_instance_id
                   JOIN items i ON i.id = ii.item_id
                  WHERE inst.work_order_id = wo.id) AS hardware,
                (SELECT COUNT(*) FROM job_materials jm
                  WHERE jm.work_order_id = wo.id AND jm.unit_cost IS NULL)
                + (SELECT COUNT(*) FROM job_services js
                    WHERE js.work_order_id = wo.id AND js.unit_rate IS NULL)
                + (SELECT COUNT(*) FROM installations inst
                    JOIN item_instances ii ON ii.id = inst.item_instance_id
                    JOIN items i ON i.id = ii.item_id
                    WHERE inst.work_order_id = wo.id AND i.unit_cost IS NULL)
                  AS unpriced_lines
           FROM work_orders wo
          WHERE wo.status <> 'cancelled'
            AND ($1::date IS NULL OR ${JOB_WORK_DAY} >= $1::date)
            AND ($2::date IS NULL OR ${JOB_WORK_DAY} <= $2::date)
       )
       SELECT ${grouping.select},
              COUNT(*)::int AS jobs,
              SUM(pj.materials) AS materials_total,
              SUM(pj.labour) AS labour_total,
              SUM(pj.expenses) AS expenses_total,
              SUM(pj.hardware) AS hardware_total,
              SUM(pj.materials + pj.labour + pj.expenses + pj.hardware) AS total,
              SUM(pj.unpriced_lines)::int AS unpriced_lines
         FROM per_job pj
         LEFT JOIN locations site ON site.id = pj.site_id
         LEFT JOIN users u ON u.id = pj.tech_id
        GROUP BY ${grouping.group}
        ORDER BY ${grouping.order}`,
      [from, to]
    );

    const rows = result.rows.map((row) => ({
      ...row,
      materials_total: round2(Number(row.materials_total)),
      labour_total: round2(Number(row.labour_total)),
      expenses_total: round2(Number(row.expenses_total)),
      hardware_total: round2(Number(row.hardware_total)),
      total: round2(Number(row.total)),
      // What one job costs on average is the figure that gets quoted; leaving
      // the client to divide two of these columns is how it gets quoted wrong.
      average_per_job: row.jobs > 0 ? round2(Number(row.total) / row.jobs) : 0,
    }));

    const sum = (key) => round2(rows.reduce((total, row) => total + row[key], 0));

    res.json({
      group_by: groupBy,
      from,
      to,
      currency: 'KES',
      job_costs: rows,
      totals: {
        jobs: rows.reduce((total, row) => total + row.jobs, 0),
        materials_total: sum('materials_total'),
        labour_total: sum('labour_total'),
        expenses_total: sum('expenses_total'),
        hardware_total: sum('hardware_total'),
        total: sum('total'),
        unpriced_lines: rows.reduce((total, row) => total + row.unpriced_lines, 0),
      },
    });
  })
);

// GET /api/reports/tech-activity?from&to
//
// Counts installs and removals from the `installations` table rather than the
// audit trail: that table is the record of what happened at a premises, and it
// attributes a removal to whoever removed it, not to whoever installed it.
router.get(
  '/tech-activity',
  asyncHandler(async (req, res) => {
    const from = optionalDate(req.query.from, 'from');
    const to = optionalDate(req.query.to, 'to');

    const result = await db.query(
      `WITH installs AS (
         SELECT installed_by AS user_id, COUNT(*)::int AS installs
         FROM installations
         WHERE ($1::date IS NULL OR installed_at >= $1::date)
           AND ($2::date IS NULL OR installed_at < $2::date + 1)
         GROUP BY installed_by
       ),
       removals AS (
         SELECT removed_by AS user_id, COUNT(*)::int AS removals
         FROM installations
         WHERE removed_by IS NOT NULL
           AND ($1::date IS NULL OR removed_at >= $1::date)
           AND ($2::date IS NULL OR removed_at < $2::date + 1)
         GROUP BY removed_by
       ),
       movements AS (
         SELECT performed_by AS user_id, COUNT(*)::int AS movements
         FROM transactions
         WHERE ($1::date IS NULL OR created_at >= $1::date)
           AND ($2::date IS NULL OR created_at < $2::date + 1)
         GROUP BY performed_by
       )
       SELECT u.id AS user_id, u.name, u.role,
              l.name AS assigned_location_name,
              COALESCE(installs.installs, 0) AS installs,
              COALESCE(removals.removals, 0) AS removals,
              COALESCE(movements.movements, 0) AS stock_movements
       FROM users u
       LEFT JOIN locations l ON l.id = u.assigned_location_id
       LEFT JOIN installs ON installs.user_id = u.id
       LEFT JOIN removals ON removals.user_id = u.id
       LEFT JOIN movements ON movements.user_id = u.id
       WHERE u.role = 'field_tech'
       ORDER BY COALESCE(installs.installs, 0) DESC, u.name`,
      [from, to]
    );

    res.json({ from, to, tech_activity: result.rows });
  })
);

// GET /api/reports/installation-trends?from&to&interval=week|month
//
// Returns installs and removals per bucket plus a removal-reason breakdown.
// Buckets with no activity are generated rather than skipped, so a line chart
// shows a dip to zero instead of drawing straight through the gap.
router.get(
  '/installation-trends',
  asyncHandler(async (req, res) => {
    const interval = req.query.interval
      ? oneOf(req.query.interval, ['week', 'month'], 'interval')
      : 'week';
    const from = optionalDate(req.query.from, 'from');
    const to = optionalDate(req.query.to, 'to');

    const trends = await db.query(
      `WITH bounds AS (
         SELECT
           date_trunc($1, COALESCE($2::date, (
             SELECT MIN(installed_at) FROM installations
           ), now())) AS start_at,
           date_trunc($1, COALESCE($3::date, now())) AS end_at
       ),
       buckets AS (
         SELECT generate_series(start_at, end_at, ('1 ' || $1)::interval) AS bucket
         FROM bounds
       ),
       installs AS (
         SELECT date_trunc($1, installed_at) AS bucket, COUNT(*)::int AS installs
         FROM installations
         WHERE ($2::date IS NULL OR installed_at >= $2::date)
           AND ($3::date IS NULL OR installed_at < $3::date + 1)
         GROUP BY 1
       ),
       removals AS (
         SELECT date_trunc($1, removed_at) AS bucket, COUNT(*)::int AS removals
         FROM installations
         WHERE removed_at IS NOT NULL
           AND ($2::date IS NULL OR removed_at >= $2::date)
           AND ($3::date IS NULL OR removed_at < $3::date + 1)
         GROUP BY 1
       )
       SELECT b.bucket,
              COALESCE(installs.installs, 0) AS installs,
              COALESCE(removals.removals, 0) AS removals
       FROM buckets b
       LEFT JOIN installs ON installs.bucket = b.bucket
       LEFT JOIN removals ON removals.bucket = b.bucket
       ORDER BY b.bucket`,
      [interval, from, to]
    );

    const reasons = await db.query(
      `SELECT date_trunc($1, removed_at) AS bucket,
              removal_reason,
              COUNT(*)::int AS removals
       FROM installations
       WHERE removed_at IS NOT NULL
         AND ($2::date IS NULL OR removed_at >= $2::date)
         AND ($3::date IS NULL OR removed_at < $3::date + 1)
       GROUP BY 1, 2
       ORDER BY 1, 2`,
      [interval, from, to]
    );

    const reasonTotals = await db.query(
      `SELECT removal_reason, COUNT(*)::int AS removals
       FROM installations
       WHERE removed_at IS NOT NULL
         AND ($1::date IS NULL OR removed_at >= $1::date)
         AND ($2::date IS NULL OR removed_at < $2::date + 1)
       GROUP BY 1
       ORDER BY removals DESC`,
      [from, to]
    );

    res.json({
      interval,
      from,
      to,
      trends: trends.rows,
      removal_reasons_by_bucket: reasons.rows,
      removal_reason_totals: reasonTotals.rows,
    });
  })
);

// GET /api/reports/stock-by-location
// Totals per location, for the "where is everything" view.
router.get(
  '/stock-by-location',
  asyncHandler(async (req, res) => {
    const result = await db.query(`
      SELECT l.id AS location_id, l.name AS location_name, l.type AS location_type,
             COALESCE(inst.installable_units, 0)::int AS installable_units,
             COALESCE(inst.to_return_units, 0)::int AS to_return_units,
             COALESCE(bulk.bulk_item_count, 0)::int AS bulk_item_count
      FROM locations l
      LEFT JOIN (
        SELECT current_location_id AS location_id,
               COUNT(*) FILTER (WHERE status = 'in_stock') AS installable_units,
               COUNT(*) FILTER (WHERE status IN ('faulty', 'returned')) AS to_return_units
        FROM item_instances
        WHERE current_location_id IS NOT NULL
        GROUP BY current_location_id
      ) inst ON inst.location_id = l.id
      LEFT JOIN (
        SELECT location_id, COUNT(*) AS bulk_item_count
        FROM stock_levels
        WHERE quantity > 0
        GROUP BY location_id
      ) bulk ON bulk.location_id = l.id
      ORDER BY l.type, l.name
    `);
    res.json({ stock_by_location: result.rows });
  })
);

module.exports = router;
