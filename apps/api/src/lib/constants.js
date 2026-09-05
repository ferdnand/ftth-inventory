// Mirrors the enum types in db/migrations/001_init.sql. That file is the source
// of truth; per PROCESS.md new values go on the existing *_enum types rather
// than becoming free text. These arrays were previously duplicated inline in
// installations.js and transactions.js — one copy now.

const TRACKING_TYPES = ['serialized', 'bulk'];
const LOCATION_TYPES = ['warehouse', 'site', 'tech_van'];
const INSTANCE_STATUSES = ['in_stock', 'issued', 'installed', 'faulty', 'returned', 'retired'];
const USER_ROLES = ['warehouse_staff', 'field_tech', 'pm', 'admin'];
const REMOVAL_REASONS = ['faulty', 'upgrade', 'customer_cancelled', 'theft', 'other'];
const WORK_ORDER_TYPES = ['new_install', 'repair', 'upgrade', 'removal'];
const WORK_ORDER_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];
const RESTOCK_STATUSES = ['requested', 'approved', 'fulfilled', 'rejected', 'cancelled'];

// The full DB enum includes 'install' and 'adjustment', but POST /api/transactions
// accepts neither: an install must go through POST /api/installations so an
// `installations` row is created alongside the audit entry, and an adjustment
// through POST /api/stock/adjustments so the correction is recorded against a
// counted quantity rather than invented as a movement.
const TRANSACTION_TYPES = [
  'receive',
  'transfer',
  'issue',
  'install',
  'return',
  'faulty',
  'adjustment',
];
const CLIENT_TRANSACTION_TYPES = ['receive', 'transfer', 'issue', 'return', 'faulty'];

// Which roles may originate which kind of movement. A field tech can push stock
// out of their van (issue/return/faulty) but cannot receive from a supplier and
// cannot pull from a warehouse — that is what restock requests are for.
//
// An admin gets the same list as warehouse staff rather than every type in the
// enum: 'install' and 'adjustment' have dedicated endpoints that keep the rest
// of the record consistent, and letting an admin post one here by hand would
// write an audit row with nothing behind it.
const TRANSACTION_TYPES_BY_ROLE = {
  warehouse_staff: CLIENT_TRANSACTION_TYPES,
  pm: CLIENT_TRANSACTION_TYPES,
  admin: CLIENT_TRANSACTION_TYPES,
  field_tech: ['issue', 'return', 'faulty'],
};

module.exports = {
  TRACKING_TYPES,
  LOCATION_TYPES,
  INSTANCE_STATUSES,
  USER_ROLES,
  REMOVAL_REASONS,
  WORK_ORDER_TYPES,
  WORK_ORDER_STATUSES,
  RESTOCK_STATUSES,
  TRANSACTION_TYPES,
  CLIENT_TRANSACTION_TYPES,
  TRANSACTION_TYPES_BY_ROLE,
};
