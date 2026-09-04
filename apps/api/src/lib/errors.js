// Error plumbing.
//
// Route handlers throw ApiError for anything the client should see, and let
// anything else propagate. `asyncHandler` forwards rejected promises to Express
// (Express 4 does not do this on its own), and `errorHandler` turns them into
// the { error: '<message>' } shape every route already used by hand.

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const badRequest = (message) => new ApiError(400, message);
const unauthorized = (message = 'Authentication required') => new ApiError(401, message);
const forbidden = (message = 'You do not have access to this') => new ApiError(403, message);
const notFound = (message = 'Not found') => new ApiError(404, message);
const conflict = (message) => new ApiError(409, message);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Postgres constraint names mapped to the message the client should see. Keeps
// the friendly text in one place whether the app-level check caught it first or
// the database did.
const CONSTRAINT_MESSAGES = {
  uq_active_installation_per_premises:
    'An active router already exists at this premises. Use /replace instead.',
  uq_users_email_lower: 'A user with that email already exists',
  users_email_key: 'A user with that email already exists',
  item_instances_serial_number_key: 'That serial number is already registered',
  item_instances_mac_address_key: 'That MAC address is already registered',
  stock_quantity_non_negative: 'That movement would leave stock negative',
  transaction_serialized_xor_bulk:
    'Provide either item_instance_id (serialized) or item_id + quantity (bulk), not both',
  transaction_quantity_positive: 'quantity must be greater than zero',
  transaction_has_a_direction:
    'A movement needs a from_location_id, a to_location_id, or both',
  removal_reason_required_if_removed: 'removal_reason is required when removing a router',
  restock_line_quantity_positive: 'Requested quantity must be greater than zero',
  restock_distinct_locations: 'Source and destination must be different locations',
  work_order_completed_at_required: 'A completed work order must have a completion time',
};

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }

  // Malformed JSON from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }

  // Postgres errors we can translate into something actionable. Everything else
  // is a bug: log the real error, return a generic message, never leak driver
  // internals to the client.
  const mapped = err.constraint && CONSTRAINT_MESSAGES[err.constraint];
  if (mapped) {
    const status = err.code === '23505' ? 409 : 400;
    console.error(err);
    return res.status(status).json({ error: mapped });
  }
  if (err.code === '23503') {
    console.error(err);
    return res.status(400).json({ error: 'A referenced record does not exist' });
  }
  if (err.code === '22P02' || err.code === '22003') {
    console.error(err);
    return res.status(400).json({ error: 'A value in the request has the wrong type or range' });
  }

  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}

module.exports = {
  ApiError,
  asyncHandler,
  errorHandler,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
};
