const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// GET /api/stock?location_id=5
// Returns serialized instances + bulk quantities at a given location
// (e.g. a tech's van, a warehouse, or a site)
router.get('/', async (req, res) => {
  const { location_id } = req.query;
  if (!location_id) {
    return res.status(400).json({ error: 'location_id is required' });
  }

  try {
    const serialized = await db.query(
      `SELECT ii.id, ii.serial_number, ii.mac_address, ii.status,
              i.id AS item_id, i.name AS item_name, i.category, i.manufacturer, i.model
       FROM item_instances ii
       JOIN items i ON i.id = ii.item_id
       WHERE ii.current_location_id = $1
       ORDER BY i.category, i.name`,
      [location_id]
    );

    const bulk = await db.query(
      `SELECT sl.item_id, sl.quantity, i.name AS item_name, i.category,
              i.unit_of_measure, i.reorder_threshold,
              (sl.quantity <= i.reorder_threshold) AS is_low_stock
       FROM stock_levels sl
       JOIN items i ON i.id = sl.item_id
       WHERE sl.location_id = $1
       ORDER BY i.category, i.name`,
      [location_id]
    );

    res.json({
      location_id: Number(location_id),
      serialized: serialized.rows,
      bulk: bulk.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stock' });
  }
});

module.exports = router;
