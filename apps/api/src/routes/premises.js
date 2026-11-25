const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, conflict, forbidden, notFound } = require('../lib/errors');
const { intId, optionalIntId, optionalBoolean, limit } = require('../lib/validate');
const { requireRole } = require('../middleware/auth');
const { serviceLinesByInstallation } = require('../lib/jobLines');
const {
  FIELDS,
  PREMISES_SELECT,
  parsePremisesFields,
  assertGpsCoherent,
  assertLocatable,
  assertHotspotCoherent,
  assertIsSite,
  insertPremises,
  shapePremises,
} = require('../lib/premises');

// GET /api/premises/search?q=Nasianda&site_id=3&limit=20
//
// Under two characters this returns an empty result list with a 200, not an
// error — the clients render that as a "type at least 2 characters" hint. Both
// clients depend on this behaviour, so don't turn it into a 400.
//
// The searchable text is the generated `search_text` column from
// 011_sites_and_premises_capture.sql: address, customer name, phone, village,
// landmark and account id. A tech looking for a house has whichever fragment
// the customer gave them on the phone, and it is rarely the address.
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').trim();
    const siteId = optionalIntId(req.query.site_id, 'site_id');
    const max = limit(req.query.limit, 20, 100);

    if (q.length < 2) {
      return res.json({ results: [], hint: 'Type at least 2 characters' });
    }

    const params = [q, `%${q}%`, max];
    let siteClause = '';
    if (siteId) {
      params.push(siteId);
      siteClause = `AND cp.site_id = $${params.length}`;
    }
    // Former clients stay on record but out of the way, unless asked for.
    if (req.query.include_inactive !== 'true') siteClause += ' AND cp.is_active';

    // Full text (which is what the GIN index is for) OR'd with a substring
    // match, so both "Nasianda" and a half-typed phone number find the row.
    // websearch_to_tsquery tolerates whatever a person types without throwing
    // on punctuation.
    const result = await db.query(
      `${PREMISES_SELECT}
       WHERE (to_tsvector('english', cp.search_text) @@ websearch_to_tsquery('english', $1)
              OR cp.search_text ILIKE $2)
         ${siteClause}
       ORDER BY cp.address NULLS LAST, cp.id
       LIMIT $3`,
      params
    );
    res.json({ results: result.rows.map(shapePremises) });
  })
);

// GET /api/premises?site_id=&limit=
//
// Browsing rather than searching. The field app needs this because the premises
// a tech wants may have no address to type: a compound recorded as a GPS pin
// and a landmark is invisible to a search box, and "the ones near me" is not a
// query this API can answer. A site's list is short enough to scroll.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const siteId = optionalIntId(req.query.site_id, 'site_id');
    const max = limit(req.query.limit, 100, 500);

    const params = [max];
    const clauses = [];
    if (siteId) {
      params.push(siteId);
      clauses.push(`cp.site_id = $${params.length}`);
    }
    if (req.query.include_inactive !== 'true') clauses.push('cp.is_active');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await db.query(
      `${PREMISES_SELECT} ${where} ORDER BY cp.created_at DESC LIMIT $1`,
      params
    );
    res.json({ premises: result.rows.map(shapePremises) });
  })
);

// POST /api/premises
// body: { address?, landmark?, village?, customer_name?, customer_phone?,
//         customer_account_id?, premises_type?, site_id?,
//         gps_lat?, gps_lng?, gps_accuracy_m?, gps_captured_at?, notes? }
//
// Any authenticated user can add one: a tech standing at a compound nobody has
// recorded needs to be able to create it before they can do anything there.
// Every field is optional individually — the rule is that the result has to be
// findable again. See lib/premises.js.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const premises = await insertPremises(db, req.body ?? {}, req.user.id);
    res.status(201).json({ premises: shapePremises(premises) });
  })
);

// PATCH /api/premises/:id
//
// Creating a premises is open to any authenticated user because a tech standing
// at a new compound has to be able to; editing one is mostly not. A tech who
// mistyped an address raises it with the warehouse — the row is already the
// anchor for an install history, and silently renaming it changes what past
// work says it was done on.
//
// The exception is the GPS fix, which any authenticated user may add or
// improve. A tech who saved a premises indoors on a 200 m fix and walks outside
// to a 6 m one is correcting the single most useful field on the record, and
// making them phone the warehouse to do it means it never gets done. Overwriting
// is allowed because a later fix taken at the compound is a better fix; what
// cannot be done here is clearing one.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const existing = await db.query(
      `SELECT id, address, landmark, gps_lat, gps_lng, connection_type, hotspot_arrangement
       FROM customer_premises WHERE id = $1`,
      [id]
    );
    if (existing.rows.length === 0) throw notFound('Premises not found');
    const current = existing.rows[0];

    const GPS_FIELDS = ['gps_lat', 'gps_lng', 'gps_accuracy_m', 'gps_captured_at'];
    // `is_active` is not in FIELDS because a premises is never created inactive;
    // it is read here, and counts as a non-GPS change like the rest.
    const touched = Object.keys(req.body ?? {}).filter((k) => k in FIELDS || k === 'is_active');
    const nonGps = touched.filter((k) => !GPS_FIELDS.includes(k));

    if (nonGps.length > 0 && !['warehouse_staff', 'pm', 'admin'].includes(req.user.role)) {
      throw forbidden(
        `Only the warehouse can change ${nonGps.join(', ')} — you can update the GPS fix`
      );
    }

    const values = parsePremisesFields(req.body ?? {});
    if (req.body?.is_active !== undefined) {
      values.is_active = optionalBoolean(req.body.is_active, 'is_active');
    }

    // Reclassifying: a hotspot says what its host gets, and a premises that stops
    // being one drops the arrangement with it rather than making the caller
    // remember to clear it.
    if ('connection_type' in values || 'hotspot_arrangement' in values) {
      const connection = values.connection_type ?? current.connection_type;
      if (connection !== 'hotspot' && !('hotspot_arrangement' in values)) {
        values.hotspot_arrangement = null;
      }
      assertHotspotCoherent(
        connection,
        'hotspot_arrangement' in values ? values.hotspot_arrangement : current.hotspot_arrangement
      );

      // Several routers are only allowed at a hotspot, so a premises carrying
      // more than one cannot stop being one until all but one are removed.
      if (current.connection_type === 'hotspot' && connection !== 'hotspot') {
        const active = await db.query(
          `SELECT COUNT(*)::int AS n FROM installations
           WHERE customer_premises_id = $1 AND removed_at IS NULL`,
          [id]
        );
        if (active.rows[0].n > 1) {
          throw conflict(
            `This hotspot has ${active.rows[0].n} routers installed. ` +
              'Replace or remove all but one before changing it to PPPoE.'
          );
        }
      }
    }

    if (Object.keys(values).length === 0) {
      throw badRequest('No editable fields were provided');
    }

    // A pin cannot be taken away: something was installed against this record
    // and the fix is how anyone finds it again.
    if ('gps_lat' in values && values.gps_lat === null && current.gps_lat !== null) {
      throw badRequest(
        'A GPS fix cannot be cleared, only replaced with a better one'
      );
    }

    const lat = 'gps_lat' in values ? values.gps_lat : current.gps_lat;
    const lng = 'gps_lng' in values ? values.gps_lng : current.gps_lng;
    assertGpsCoherent(lat, lng, values.gps_accuracy_m ?? null);
    assertLocatable({
      address: 'address' in values ? values.address : current.address,
      landmark: 'landmark' in values ? values.landmark : current.landmark,
      gps_lat: lat,
    });
    if ('site_id' in values) await assertIsSite(db, values.site_id);

    // A new fix with no time on it was taken now, matching insertPremises.
    if ('gps_lat' in values && values.gps_lat !== null && !values.gps_captured_at) {
      values.gps_captured_at = new Date().toISOString();
    }

    const columns = Object.keys(values);
    const params = columns.map((c) => values[c]);
    const sets = columns.map((c, i) => `${c} = $${i + 1}`);
    params.push(id);

    await db.query(
      `UPDATE customer_premises SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );

    // A job is at the same site as its premises (trg_job_site_matches_premises),
    // so re-filing the premises re-files the jobs at it — otherwise every later
    // edit to one of those jobs would be refused by the trigger.
    if ('site_id' in values) {
      await db.query('UPDATE work_orders SET site_id = $1 WHERE customer_premises_id = $2', [
        values.site_id,
        id,
      ]);
    }

    const full = await db.query(`${PREMISES_SELECT} WHERE cp.id = $1`, [id]);
    res.json({ premises: shapePremises(full.rows[0]) });
  })
);

// GET /api/premises/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const result = await db.query(`${PREMISES_SELECT} WHERE cp.id = $1`, [id]);
    if (result.rows.length === 0) throw notFound('Premises not found');
    res.json({ premises: shapePremises(result.rows[0]) });
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
       WHERE inst.customer_premises_id = $1 AND inst.removed_at IS NULL
       ORDER BY inst.installed_at, inst.id`,
      [id]
    );

    // One query for every router's labour, not one per router.
    const grouped = await serviceLinesByInstallation(
      db,
      result.rows.map((row) => Number(row.installation_id))
    );
    for (const row of result.rows) {
      row.services = grouped[Number(row.installation_id)] ?? [];
    }

    // `installations` is every router now live here — a hotspot may have several.
    // `current` stays as the first of them (null when there are none) so a
    // client written for one router per premises keeps working.
    res.json({ current: result.rows[0] ?? null, installations: result.rows });
  })
);

// GET /api/premises/:id/history
// Full install/removal timeline + replacement count for a premises.
router.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const premises = await db.query(`${PREMISES_SELECT} WHERE cp.id = $1`, [id]);
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

    // One row per installation, so the first router is not a "replacement". A
    // hotspot's later routers are additions, not swaps, so there the count is the
    // routers that have actually been taken out.
    const totalRouters = timeline.rows.length;
    const isHotspot = premises.rows[0].connection_type === 'hotspot';
    const replacementCount = isHotspot
      ? timeline.rows.filter((row) => row.removed_at).length
      : Math.max(totalRouters - 1, 0);

    res.json({
      premises: shapePremises(premises.rows[0]),
      total_routers: totalRouters,
      replacement_count: replacementCount,
      timeline: timeline.rows,
    });
  })
);

// DELETE /api/premises/:id   (admin only)
//
// For a premises that was added by mistake, or that never became a client.
// Once it has a job, a router or a stock movement it is part of the cost and
// stock history, and deleting it would take those with it — so the answer is
// 409, and the way to retire it is PATCH { is_active: false }, which marks it a
// former client: it leaves every list and picker but the record stays.
router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const found = await client.query(
        'SELECT id FROM customer_premises WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (found.rows.length === 0) throw notFound('Premises not found');

      const refs = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM work_orders WHERE customer_premises_id = $1)::int AS jobs,
           (SELECT COUNT(*) FROM installations WHERE customer_premises_id = $1)::int AS installs`,
        [id]
      );
      const { jobs, installs } = refs.rows[0];
      const reasons = [];
      if (jobs) reasons.push(`${jobs} job(s)`);
      if (installs) reasons.push(`${installs} installed router(s)`);
      if (reasons.length > 0) {
        throw conflict(
          `This premises cannot be deleted because it has ${reasons.join(' and ')}. ` +
            'Mark it as a former client instead — the record stays but it leaves the lists.'
        );
      }

      await client.query('DELETE FROM customer_premises WHERE id = $1', [id]);
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

module.exports = router;
