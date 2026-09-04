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
