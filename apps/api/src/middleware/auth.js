const jwt = require('jsonwebtoken');
const db = require('../lib/db');
const env = require('../lib/env');
const { unauthorized, forbidden } = require('../lib/errors');

// The token payload is deliberately minimal — just the user id. Role and
// assigned_location_id are re-read from the database on every request.
//
// That per-request lookup is what makes deactivating a user, changing their
// role, or reassigning their van take effect immediately instead of at the next
// token expiry. There is no token revocation list, so this lookup IS the
// revocation mechanism: do not "optimise" it away by trusting claims in the
// token, or deactivating a user silently stops working until their token
// expires.
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(unauthorized('Send an Authorization: Bearer <token> header'));
  }

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError'
        ? 'Your session has expired. Sign in again.'
        : 'Invalid token';
    return next(unauthorized(message));
  }

  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.assigned_location_id, u.is_active,
              l.name AS assigned_location_name, l.type AS assigned_location_type
       FROM users u
       LEFT JOIN locations l ON l.id = u.assigned_location_id
       WHERE u.id = $1`,
      [payload.sub]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      return next(unauthorized('This account is no longer active'));
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

const isAdmin = (user) => user.role === 'admin';

// `admin` passes every requireRole check without being named in one.
//
// The alternative — adding 'admin' to each of the ~15 requireRole() lists — was
// rejected because it fails in the worst direction: the next route someone adds
// gets whichever roles they happened to type, and an admin quietly cannot use
// it. The whole point of the role is that there is no table it cannot correct,
// so the rule belongs at the one place every role check goes through.
//
// This is a role check, not an authentication bypass: requireAuth has already
// verified the token and re-read is_active from the database, and route
// handlers still apply their own business rules (a terminal work order is still
// terminal, an installed unit still has to be removed before it is retired).
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (isAdmin(req.user)) return next();
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`This action requires one of: ${roles.join(', ')}`));
    }
    next();
  };
}

const isFieldTech = (user) => user.role === 'field_tech';

// Field techs only see and act on their own van; warehouse staff and PMs see
// everything. Called from route handlers rather than as middleware because the
// location id arrives sometimes in the query, sometimes in the body.
function assertLocationAccess(user, locationId) {
  if (!isFieldTech(user)) return;
  if (Number(locationId) !== Number(user.assigned_location_id)) {
    throw forbidden('Field techs can only access stock at their own assigned location');
  }
}

// The van a tech is acting from. A tech with no assigned location cannot move
// stock at all, which is a configuration problem worth naming clearly.
function requireAssignedLocation(user) {
  if (!user.assigned_location_id) {
    throw forbidden(
      'You have no assigned location. Ask a manager to assign you to a van before moving stock.'
    );
  }
  return user.assigned_location_id;
}

module.exports = {
  requireAuth,
  requireRole,
  isFieldTech,
  isAdmin,
  assertLocationAccess,
  requireAssignedLocation,
};
