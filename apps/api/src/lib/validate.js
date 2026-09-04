// Request validation helpers.
//
// Hand-rolled rather than zod on purpose: every route in this API returns a
// single `{ error: '<sentence>' }` and both clients present that string
// directly. A schema library's issue arrays would have to be flattened back
// into exactly this shape, so it would add a dependency without removing work.
//
// Every helper either returns a coerced value or throws an ApiError(400).
const { badRequest } = require('./errors');

// Names the missing fields rather than saying "invalid request", per PROCESS.md.
function requireFields(body, fields) {
  const missing = fields.filter((f) => {
    const v = body?.[f];
    return v === undefined || v === null || v === '';
  });
  if (missing.length > 0) {
    throw badRequest(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`);
  }
}

// Rejects fields the client must not send. Used for performed_by / installed_by,
// which are now derived from the token — silently ignoring them would let a
// client believe it was writing as someone else.
function rejectFields(body, fields, why) {
  const present = fields.filter((f) => body?.[f] !== undefined);
  if (present.length > 0) {
    throw badRequest(`${present.join(', ')} must not be sent — ${why}`);
  }
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function intId(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw badRequest(`${field} must be a positive integer id`);
  }
  return n;
}

function optionalIntId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return intId(value, field);
}

function positiveNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw badRequest(`${field} must be a number greater than zero`);
  }
  return n;
}

function optionalNumber(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw badRequest(`${field} must be a number`);
  }
  return n;
}

function nonEmptyString(value, field, maxLength = 500) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw badRequest(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function optionalString(value, field, maxLength = 500) {
  if (value === undefined || value === null || value === '') return null;
  return nonEmptyString(value, field, maxLength);
}

// ISO date or datetime, for report ranges. Returns the raw string for pg to cast.
function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
  return value;
}

// Bounded page size, so a client cannot ask for the whole audit trail.
function limit(value, fallback = 100, max = 500) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw badRequest(`limit must be an integer between 1 and ${max}`);
  }
  return n;
}

function optionalBoolean(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw badRequest(`${field} must be true or false`);
}

module.exports = {
  requireFields,
  rejectFields,
  oneOf,
  intId,
  optionalIntId,
  positiveNumber,
  optionalNumber,
  nonEmptyString,
  optionalString,
  optionalDate,
  limit,
  optionalBoolean,
};
