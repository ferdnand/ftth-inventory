const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../lib/db');
const { asyncHandler, badRequest, notFound } = require('../lib/errors');
const {
  requireFields,
  oneOf,
  intId,
  optionalIntId,
  nonEmptyString,
  optionalBoolean,
} = require('../lib/validate');
const { USER_ROLES } = require('../lib/constants');
const { requireRole } = require('../middleware/auth');
const { publicUser } = require('../lib/serialize');

const BCRYPT_ROUNDS = 10;

const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.role, u.assigned_location_id, u.is_active, u.created_at,
         l.name AS assigned_location_name, l.type AS assigned_location_type
  FROM users u
  LEFT JOIN locations l ON l.id = u.assigned_location_id
`;

// GET /api/users?role=field_tech&is_active=true
//
// Readable by warehouse staff as well as PMs: the "assign a tech" dropdown on
// the work-order form needs it, and it exposes no more than a staff directory.
router.get(
  '/',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = [];
    const push = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (req.query.role) {
      clauses.push(`u.role = ${push(oneOf(req.query.role, USER_ROLES, 'role'))}`);
    }
    const isActive = optionalBoolean(req.query.is_active, 'is_active');
    if (isActive !== null) {
      clauses.push(`u.is_active = ${push(isActive)}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await db.query(`${USER_SELECT} ${where} ORDER BY u.name`, params);
    res.json({ users: result.rows.map(publicUser) });
  })
);

// GET /api/users/:id
router.get(
  '/:id',
  requireRole('warehouse_staff', 'pm'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');
    const result = await db.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
    if (result.rows.length === 0) throw notFound('User not found');
    res.json({ user: publicUser(result.rows[0]) });
  })
);

// The admin role is what unlocks every correction path in the API, so the
// system has to keep at least one account that holds it. Demoting or
// deactivating the last one would leave a database nobody can fix without
// direct SQL access — recoverable only by running db/create-admin.js on the
// server, which is exactly the situation this guard exists to avoid.
async function assertAdminRemains(userId, actingUserId) {
  if (userId === actingUserId) {
    throw badRequest(
      'You cannot remove your own administrator access — ask another administrator to do it'
    );
  }

  const others = await db.query(
    `SELECT count(*)::int AS remaining
     FROM users
     WHERE role = 'admin' AND is_active = TRUE AND id <> $1`,
    [userId]
  );
  if (others.rows[0].remaining === 0) {
    throw badRequest(
      'That is the last active administrator. Give another user the admin role first.'
    );
  }
}

async function assertLocationSuitable(locationId, role) {
  if (!locationId) return;
  const location = await db.query('SELECT id, type FROM locations WHERE id = $1', [locationId]);
  if (location.rows.length === 0) throw notFound('assigned_location_id does not match a location');
  if (role === 'field_tech' && location.rows[0].type !== 'tech_van') {
    throw badRequest('A field tech must be assigned to a tech_van location');
  }
}

// POST /api/users
// body: { name, email, role, password, assigned_location_id? }
router.post(
  '/',
  requireRole('pm'),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['name', 'email', 'role', 'password']);
    const name = nonEmptyString(req.body.name, 'name', 200);
    const email = nonEmptyString(req.body.email, 'email', 255).toLowerCase();
    const role = oneOf(req.body.role, USER_ROLES, 'role');
    const password = nonEmptyString(req.body.password, 'password', 200);
    const locationId = optionalIntId(req.body.assigned_location_id, 'assigned_location_id');

    if (password.length < 8) {
      throw badRequest('password must be at least 8 characters');
    }
    if (!email.includes('@')) {
      throw badRequest('email must be a valid address');
    }
    await assertLocationSuitable(locationId, role);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await db.query(
      `INSERT INTO users (name, email, role, password_hash, assigned_location_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [name, email, role, passwordHash, locationId]
    );

    const created = await db.query(`${USER_SELECT} WHERE u.id = $1`, [result.rows[0].id]);
    res.status(201).json({ user: publicUser(created.rows[0]) });
  })
);

// PATCH /api/users/:id
// body: { name?, email?, role?, assigned_location_id?, is_active?, password? }
//
// Deactivating a user takes effect on their very next request: requireAuth
// re-reads is_active from the database rather than trusting the token.
router.patch(
  '/:id',
  requireRole('pm'),
  asyncHandler(async (req, res) => {
    const id = intId(req.params.id, 'id');

    const existing = await db.query(
      'SELECT id, role, is_active FROM users WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) throw notFound('User not found');
    const current = existing.rows[0];

    const sets = [];
    const params = [];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    const role = req.body.role !== undefined
      ? oneOf(req.body.role, USER_ROLES, 'role')
      : current.role;

    // Both ways an account can stop being a usable admin.
    const losingAdmin =
      current.role === 'admin' &&
      current.is_active &&
      (role !== 'admin' || req.body.is_active === false);
    if (losingAdmin) await assertAdminRemains(id, req.user.id);

    if (req.body.name !== undefined) set('name', nonEmptyString(req.body.name, 'name', 200));
    if (req.body.email !== undefined) {
      set('email', nonEmptyString(req.body.email, 'email', 255).toLowerCase());
    }
    if (req.body.role !== undefined) set('role', role);
    if (req.body.assigned_location_id !== undefined) {
      const locationId = optionalIntId(req.body.assigned_location_id, 'assigned_location_id');
      await assertLocationSuitable(locationId, role);
      set('assigned_location_id', locationId);
    }
    if (req.body.is_active !== undefined) {
      set('is_active', optionalBoolean(req.body.is_active, 'is_active'));
    }
    if (req.body.password !== undefined) {
      const password = nonEmptyString(req.body.password, 'password', 200);
      if (password.length < 8) throw badRequest('password must be at least 8 characters');
      set('password_hash', await bcrypt.hash(password, BCRYPT_ROUNDS));
    }

    if (sets.length === 0) throw badRequest('No editable fields were provided');

    // Nobody may switch their own account off, whatever their role.
    if (id === req.user.id && req.body.is_active === false) {
      throw badRequest('You cannot deactivate your own account');
    }

    params.push(id);
    await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    const updated = await db.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
    res.json({ user: publicUser(updated.rows[0]) });
  })
);

module.exports = router;
