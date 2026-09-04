const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler } = require('../lib/errors');
const { intId } = require('../lib/validate');
const { assertLocationAccess } = require('../middleware/auth');

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

module.exports = router;
