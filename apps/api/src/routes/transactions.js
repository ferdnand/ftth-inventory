const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// POST /api/transactions
// Generic stock movement: receive / transfer / issue / return / faulty
// Bulk items: pass { item_id, quantity, from_location_id?, to_location_id?, type, performed_by }
// Serialized items: pass { item_instance_id, from_location_id?, to_location_id?, type, performed_by }
router.post('/', async (req, res) => {
  const {
    item_id, item_instance_id, quantity,
    from_location_id, to_location_id,
    type, work_order_id, performed_by, notes,
  } = req.body;

  const validTypes = ['receive', 'transfer', 'issue', 'return', 'faulty'];
  if (!validTypes.includes(type) || !performed_by) {
    return res.status(400).json({ error: 'A valid type and performed_by are required' });
  }
  if (!item_instance_id && !quantity) {
    return res.status(400).json({ error: 'Provide either item_instance_id (serialized) or quantity (bulk)' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let resolvedItemId = item_id;

    if (item_instance_id) {
      // --- Serialized item move ---
      const instance = await client.query(`SELECT item_id FROM item_instances WHERE id = $1`, [item_instance_id]);
      if (instance.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'item_instance not found' });
      }
      resolvedItemId = instance.rows[0].item_id;

      const newStatus = type === 'faulty' ? 'faulty'
        : (to_location_id ? 'in_stock' : 'issued');

      await client.query(
        `UPDATE item_instances
         SET current_location_id = $1, status = $2, updated_at = now()
         WHERE id = $3`,
        [to_location_id || null, newStatus, item_instance_id]
      );
    } else {
      // --- Bulk item move: decrement source, increment destination ---
      if (from_location_id) {
        await client.query(
          `UPDATE stock_levels SET quantity = quantity - $1, updated_at = now()
           WHERE item_id = $2 AND location_id = $3`,
          [quantity, item_id, from_location_id]
        );
      }
      if (to_location_id) {
        await client.query(
          `INSERT INTO stock_levels (item_id, location_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (item_id, location_id)
           DO UPDATE SET quantity = stock_levels.quantity + $3, updated_at = now()`,
          [item_id, to_location_id, quantity]
        );
      }
    }

    const txn = await client.query(
      `INSERT INTO transactions
        (item_id, item_instance_id, quantity, from_location_id, to_location_id, type, work_order_id, performed_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [resolvedItemId, item_instance_id || null, quantity || null,
       from_location_id || null, to_location_id || null,
       type, work_order_id || null, performed_by, notes || null]
    );

    await client.query('COMMIT');
    res.status(201).json({ transaction: txn.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Transaction failed' });
  } finally {
    client.release();
  }
});

// GET /api/transactions?item_instance_id=42  or ?work_order_id=17
router.get('/', async (req, res) => {
  const { item_instance_id, work_order_id, location_id } = req.query;
  const clauses = [];
  const params = [];

  if (item_instance_id) { params.push(item_instance_id); clauses.push(`item_instance_id = $${params.length}`); }
  if (work_order_id) { params.push(work_order_id); clauses.push(`work_order_id = $${params.length}`); }
  if (location_id) { params.push(location_id); clauses.push(`(from_location_id = $${params.length} OR to_location_id = $${params.length})`); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `SELECT * FROM transactions ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json({ transactions: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router;
