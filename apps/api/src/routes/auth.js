const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();
const db = require('../lib/db');
const env = require('../lib/env');
const { asyncHandler, unauthorized } = require('../lib/errors');
const { requireFields, nonEmptyString } = require('../lib/validate');
const { requireAuth } = require('../middleware/auth');
const { publicUser } = require('../lib/serialize');

// Per-process, in-memory login throttle.
//
// This is NOT real protection: it resets on restart and does nothing across
// multiple instances. It exists to make casual password guessing slow. Anything
// deployed publicly needs a shared store or a proxy-level limiter.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();

function throttleKey(req, email) {
  return `${req.ip}|${email.toLowerCase()}`;
}

function tooManyAttempts(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailure(key) {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
}

// POST /api/auth/login
// body: { email, password }
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['email', 'password']);
    const email = nonEmptyString(req.body.email, 'email', 255);
    const password = nonEmptyString(req.body.password, 'password', 200);

    const key = throttleKey(req, email);
    if (tooManyAttempts(key)) {
      return res
        .status(429)
        .json({ error: 'Too many failed sign-in attempts. Try again in a few minutes.' });
    }

    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.password_hash, u.assigned_location_id, u.is_active,
              l.name AS assigned_location_name, l.type AS assigned_location_type
       FROM users u
       LEFT JOIN locations l ON l.id = u.assigned_location_id
       WHERE lower(u.email) = lower($1)`,
      [email]
    );
    const user = result.rows[0];

    // One message for every failure mode — a wrong email, a wrong password, a
    // deactivated account, an account with no password set. Distinguishing them
    // would tell an attacker which emails are real.
    const ok = user && user.is_active && user.password_hash
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!ok) {
      recordFailure(key);
      throw unauthorized('Incorrect email or password');
    }

    loginAttempts.delete(key);
    const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: env.JWT_TTL });

    res.json({ token, user: publicUser(user) });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  })
);

module.exports = router;
