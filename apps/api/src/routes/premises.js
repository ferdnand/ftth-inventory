const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, notFound } = require('../lib/errors');
const {
  requireFields,
  intId,
  nonEmptyString,
  optionalString,
  optionalNumber,
} = require('../lib/validate');
const { requireRole } = require('../middleware/auth');
const { serviceLinesByInstallation } = require('../lib/installationServices');

// GET /api/premises/search?q=Ngong
//
// Under two characters this returns an empty result list with a 200, not an
// error — the clients render that as a "type at least 2 characters" hint. Both
// clients depend on this behaviour, so don't turn it into a 400.
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ results: [], hint: 'Type at least 2 characters' });
    }

    // Full-text on the address (which is what the GIN index in 001_init.sql is
    // for) OR'd with a prefix match on the account id, so both "Ngong" and
    // "KE-77291" find the same row. websearch_to_tsquery tolerates whatever a
    // person types without throwing on punctuation.
    const result = await db.query(
      `SELECT id, address, customer_account_id
       FROM customer_premises
       WHERE to_tsvector('english', address) @@ websearch_to_tsquery('english', $1)
          OR address ILIKE $2
          OR customer_account_id ILIKE $2
       ORDER BY address
       LIMIT 20`,
      [q, `%${q}%`]
    );
    res.json({ results: result.rows });
  })
);

// POST /api/premises
// body: { address, customer_account_id?, gps_lat?, gps_lng? }
//
// Any authenticated user can add one: a tech standing at a new address needs to
// be able to create it before they can install anything there.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['address']);
    const address = nonEmptyString(req.body.address, 'address', 500);
    const accountId = optionalString(req.body.customer_account_id, 'customer_account_id', 100);
    const lat = optionalNumber(req.body.gps_lat, 'gps_lat');
    const lng = optionalNumber(req.body.gps_lng, 'gps_lng');

    const result = await db.query(
      `INSERT INTO customer_premises (address, customer_account_id, gps_lat, gps_lng)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [address, accountId, lat, lng]
    );
    res.status(201).json({ premises: result.rows[0] });
  })
);

// PATCH /api/premises/:id
// body: { address?, customer_account_id?, gps_lat?, gps_lng? }
//
// Creating a premises is open to any authenticated user because a tech standing
// at a new address has to be able to; editing one is not. A tech who mistyped
// an address raises it with the warehouse — the row is already the anchor for
// an install history, and silently renaming it changes what past work says it
// was done on.
router.patch(
  '/:id',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const sets = [];
    const params = [];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (req.body.address !== undefined) {
      set('address', nonEmptyString(req.body.address, 'address', 500));
    }
    if (req.body.customer_account_id !== undefined) {
      set(
        'customer_account_id',
        optionalString(req.body.customer_account_id, 'customer_account_id', 100)
      );
    }
    if (req.body.gps_lat !== undefined) set('gps_lat', optionalNumber(req.body.gps_lat, 'gps_lat'));
    if (req.body.gps_lng !== undefined) set('gps_lng', optionalNumber(req.body.gps_lng, 'gps_lng'));

    if (sets.length === 0) throw badRequest('No editable fields were provided');

    params.push(id);
    const result = await db.query(
      `UPDATE customer_premises SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) throw notFound('Premises not found');
    res.json({ premises: result.rows[0] });
  })
);

// GET /api/premises/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const result = await db.query(
      'SELECT * FROM customer_premises WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) throw notFound('Premises not found');
    res.json({ premises: result.rows[0] });
  })
);

// GET /api/premises/:id/current
// The router currently installed at this premises, if any.
//
// Returns { current: null } with a 200 when there is nothing installed — "no
// router here" is a normal answer, not a missing resource. (Contrast
// /history below, which does 404 on an unknown premises id.)
router.get(
  '/:id/current',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const result = await db.query(
      `SELECT inst.id AS installation_id, inst.installed_at, inst.work_order_id,
              ii.id AS item_instance_id, ii.serial_number, ii.mac_address,
              i.name AS item_name, i.manufacturer, i.model,
              installer.name AS installed_by_name
       FROM installations inst
       JOIN item_instances ii ON ii.id = inst.item_instance_id
       JOIN items i ON i.id = ii.item_id
       JOIN users installer ON installer.id = inst.installed_by
       WHERE inst.customer_premises_id = $1 AND inst.removed_at IS NULL`,
      [id]
    );
    const current = result.rows[0] || null;
    if (current) {
      const grouped = await serviceLinesByInstallation(db, [Number(current.installation_id)]);
      current.services = grouped[Number(current.installation_id)] ?? [];
    }
    res.json({ current });
  })
);

// GET /api/premises/:id/history
// Full install/removal timeline + replacement count for a premises.
router.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const premises = await db.query(
      'SELECT id, address, customer_account_id FROM customer_premises WHERE id = $1',
      [id]
    );
    if (premises.rows.length === 0) throw notFound('Premises not found');

    const timeline = await db.query(
      `SELECT inst.id, inst.installed_at, inst.removed_at, inst.removal_reason,
              inst.work_order_id,
              ii.id AS item_instance_id, ii.serial_number, ii.mac_address,
              i.name AS item_name, i.manufacturer, i.model,
              installer.name AS installed_by_name,
              remover.name AS removed_by_name
       FROM installations inst
       JOIN item_instances ii ON ii.id = inst.item_instance_id
       JOIN items i ON i.id = ii.item_id
       JOIN users installer ON installer.id = inst.installed_by
       LEFT JOIN users remover ON remover.id = inst.removed_by
       WHERE inst.customer_premises_id = $1
       ORDER BY inst.installed_at DESC`,
      [id]
    );

    // One query for the whole timeline's labour, not one per installation.
    const services = await serviceLinesByInstallation(
      db,
      timeline.rows.map((row) => Number(row.id))
    );
    for (const row of timeline.rows) {
      row.services = services[Number(row.id)] ?? [];
    }

    // One row per installation, so the first router is not a "replacement".
    const totalRouters = timeline.rows.length;
    const replacementCount = Math.max(totalRouters - 1, 0);

    res.json({
      premises: premises.rows[0],
      total_routers: totalRouters,
      replacement_count: replacementCount,
      timeline: timeline.rows,
    });
  })
);

module.exports = router;
