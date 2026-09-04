const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// ---- Items (catalog) ----
router.get('/items', async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM items WHERE is_active = TRUE ORDER BY category, name`);
    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

router.post('/items', async (req, res) => {
  const { name, category, tracking_type, unit_of_measure, manufacturer, model, reorder_threshold } = req.body;
  if (!name || !category || !tracking_type || !unit_of_measure) {
    return res.status(400).json({ error: 'name, category, tracking_type, unit_of_measure are required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO items (name, category, tracking_type, unit_of_measure, manufacturer, model, reorder_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, category, tracking_type, unit_of_measure, manufacturer || null, model || null, reorder_threshold || null]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// ---- Locations ----
router.get('/locations', async (req, res) => {
  const { type } = req.query;
  try {
    const result = type
      ? await db.query(`SELECT * FROM locations WHERE type = $1 ORDER BY name`, [type])
      : await db.query(`SELECT * FROM locations ORDER BY type, name`);
    res.json({ locations: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// ---- Work orders ----
router.get('/work-orders', async (req, res) => {
  const { assigned_tech_id, status } = req.query;
  const clauses = [];
  const params = [];
  if (assigned_tech_id) { params.push(assigned_tech_id); clauses.push(`assigned_tech_id = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `SELECT wo.*, cp.address
       FROM work_orders wo
       JOIN customer_premises cp ON cp.id = wo.customer_premises_id
       ${where}
       ORDER BY wo.scheduled_date NULLS LAST, wo.created_at DESC`,
      params
    );
    res.json({ work_orders: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch work orders' });
  }
});

router.post('/work-orders', async (req, res) => {
  const { customer_premises_id, type, assigned_tech_id, scheduled_date, notes } = req.body;
  if (!customer_premises_id || !type) {
    return res.status(400).json({ error: 'customer_premises_id and type are required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO work_orders (customer_premises_id, type, assigned_tech_id, scheduled_date, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [customer_premises_id, type, assigned_tech_id || null, scheduled_date || null, notes || null]
    );
    res.status(201).json({ work_order: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create work order' });
  }
});

module.exports = router;
