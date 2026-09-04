const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// GET /api/premises/search?q=Ngong
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ results: [] });
  }
  try {
    const result = await db.query(
      `SELECT id, address, customer_account_id
       FROM customer_premises
       WHERE address ILIKE $1 OR customer_account_id ILIKE $1
       ORDER BY address
       LIMIT 20`,
      [`%${q}%`]
    );
    res.json({ results: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/premises/:id/current
// The router currently installed at this premises (if any)
router.get('/:id/current', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT inst.id AS installation_id, inst.installed_at,
              ii.serial_number, ii.mac_address,
              i.name AS item_name, i.model
       FROM installations inst
       JOIN item_instances ii ON ii.id = inst.item_instance_id
       JOIN items i ON i.id = ii.item_id
       WHERE inst.customer_premises_id = $1 AND inst.removed_at IS NULL`,
      [req.params.id]
    );
    res.json({ current: result.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch current installation' });
  }
});

// GET /api/premises/:id/history
// Full install/removal timeline + replacement count for a premises
router.get('/:id/history', async (req, res) => {
  try {
    const premises = await db.query(
      `SELECT id, address, customer_account_id FROM customer_premises WHERE id = $1`,
      [req.params.id]
    );
    if (premises.rows.length === 0) {
      return res.status(404).json({ error: 'Premises not found' });
    }

    const timeline = await db.query(
      `SELECT inst.id, inst.installed_at, inst.removed_at, inst.removal_reason,
              ii.serial_number, ii.mac_address,
              i.name AS item_name,
              installer.name AS installed_by_name,
              remover.name AS removed_by_name
       FROM installations inst
       JOIN item_instances ii ON ii.id = inst.item_instance_id
       JOIN items i ON i.id = ii.item_id
       JOIN users installer ON installer.id = inst.installed_by
       LEFT JOIN users remover ON remover.id = inst.removed_by
       WHERE inst.customer_premises_id = $1
       ORDER BY inst.installed_at DESC`,
      [req.params.id]
    );

    const totalRouters = timeline.rows.length;
    const replacementCount = Math.max(totalRouters - 1, 0);

    res.json({
      premises: premises.rows[0],
      total_routers: totalRouters,
      replacement_count: replacementCount,
      timeline: timeline.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
