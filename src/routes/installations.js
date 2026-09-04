const express = require('express');
const router = express.Router();
const db = require('../lib/db');

const VALID_REASONS = ['faulty', 'upgrade', 'customer_cancelled', 'theft', 'other'];

// POST /api/installations
// First-time install at a premises with no active router.
// body: { customer_premises_id, item_instance_id, installed_by, work_order_id? }
router.post('/', async (req, res) => {
  const { customer_premises_id, item_instance_id, installed_by, work_order_id } = req.body;

  if (!customer_premises_id || !item_instance_id || !installed_by) {
    return res.status(400).json({
      error: 'customer_premises_id, item_instance_id, and installed_by are required',
    });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Guard: no active installation should already exist here
    const existing = await client.query(
      `SELECT id FROM installations WHERE customer_premises_id = $1 AND removed_at IS NULL`,
      [customer_premises_id]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'An active router already exists at this premises. Use /replace instead.',
      });
    }

    const installation = await client.query(
      `INSERT INTO installations (customer_premises_id, item_instance_id, installed_by, work_order_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [customer_premises_id, item_instance_id, installed_by, work_order_id || null]
    );

    await client.query(
      `UPDATE item_instances SET status = 'installed', current_location_id = NULL,
              current_holder_id = NULL, updated_at = now()
       WHERE id = $1`,
      [item_instance_id]
    );

    await client.query(
      `INSERT INTO transactions (item_id, item_instance_id, type, work_order_id, performed_by, notes)
       SELECT item_id, $1, 'install', $2, $3, 'Installed at premises ' || $4
       FROM item_instances WHERE id = $1`,
      [item_instance_id, work_order_id || null, installed_by, customer_premises_id]
    );

    await client.query('COMMIT');
    res.status(201).json({ installation: installation.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Install failed' });
  } finally {
    client.release();
  }
});

// POST /api/installations/:premisesId/replace
// Removes the active router (reason required) and installs a new one.
// body: { new_item_instance_id, removal_reason, performed_by, work_order_id? }
router.post('/:premisesId/replace', async (req, res) => {
  const { premisesId } = req.params;
  const { new_item_instance_id, removal_reason, performed_by, work_order_id } = req.body;

  if (!new_item_instance_id || !removal_reason || !performed_by) {
    return res.status(400).json({
      error: 'new_item_instance_id, removal_reason, and performed_by are required',
    });
  }
  if (!VALID_REASONS.includes(removal_reason)) {
    return res.status(400).json({ error: `removal_reason must be one of: ${VALID_REASONS.join(', ')}` });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const active = await client.query(
      `SELECT id, item_instance_id FROM installations
       WHERE customer_premises_id = $1 AND removed_at IS NULL
       FOR UPDATE`,
      [premisesId]
    );
    if (active.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No active router found at this premises' });
    }
    const activeInstallation = active.rows[0];

    // 1. Close out the current installation
    await client.query(
      `UPDATE installations
       SET removed_at = now(), removed_by = $1, removal_reason = $2
       WHERE id = $3`,
      [performed_by, removal_reason, activeInstallation.id]
    );
    await client.query(
      `UPDATE item_instances
       SET status = $1, updated_at = now()
       WHERE id = $2`,
      [removal_reason === 'faulty' ? 'faulty' : 'returned', activeInstallation.item_instance_id]
    );

    // 2. Create the new installation
    const newInstallation = await client.query(
      `INSERT INTO installations (customer_premises_id, item_instance_id, installed_by, work_order_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [premisesId, new_item_instance_id, performed_by, work_order_id || null]
    );
    await client.query(
      `UPDATE item_instances
       SET status = 'installed', current_location_id = NULL, current_holder_id = NULL, updated_at = now()
       WHERE id = $1`,
      [new_item_instance_id]
    );

    // 3. Log both movements in the audit trail
    await client.query(
      `INSERT INTO transactions (item_id, item_instance_id, type, work_order_id, performed_by, notes)
       SELECT item_id, $1, 'return', $2, $3, 'Removed from premises ' || $4 || ' — reason: ' || $5
       FROM item_instances WHERE id = $1`,
      [activeInstallation.item_instance_id, work_order_id || null, performed_by, premisesId, removal_reason]
    );
    await client.query(
      `INSERT INTO transactions (item_id, item_instance_id, type, work_order_id, performed_by, notes)
       SELECT item_id, $1, 'install', $2, $3, 'Installed (replacement) at premises ' || $4
       FROM item_instances WHERE id = $1`,
      [new_item_instance_id, work_order_id || null, performed_by, premisesId]
    );

    await client.query('COMMIT');
    res.status(201).json({ installation: newInstallation.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Replacement failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
