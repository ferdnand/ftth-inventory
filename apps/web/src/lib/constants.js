// Mirrors the enum types in apps/api/db/migrations/001_init.sql, which is the
// source of truth. Per the API's PROCESS.md, new values go on the existing
// *_enum types rather than becoming free text — so this is frozen data, not
// logic. Duplicated in apps/mobile/src/lib/constants.js on purpose: sharing it
// would mean a workspace package that both Vite and Metro have to resolve, a
// permanent build-seam tax for ~35 lines.

export const TRACKING_TYPES = ['serialized', 'bulk'];
export const LOCATION_TYPES = ['warehouse', 'site', 'tech_van'];
export const INSTANCE_STATUSES = [
  'in_stock',
  'issued',
  'installed',
  'faulty',
  'returned',
  'retired',
];
export const USER_ROLES = ['warehouse_staff', 'field_tech', 'pm'];
export const REMOVAL_REASONS = ['faulty', 'upgrade', 'customer_cancelled', 'theft', 'other'];
export const WORK_ORDER_TYPES = ['new_install', 'repair', 'upgrade', 'removal'];
export const WORK_ORDER_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];
export const RESTOCK_STATUSES = ['requested', 'approved', 'fulfilled', 'rejected', 'cancelled'];

// 'install' is rejected by POST /api/transactions — an install must go through
// POST /api/installations so an installations row is written too.
export const TRANSACTION_TYPES = ['receive', 'transfer', 'issue', 'return', 'faulty'];

export const LABELS = {
  serialized: 'Serialized',
  bulk: 'Bulk',

  warehouse: 'Warehouse',
  site: 'Site',
  tech_van: 'Tech van',

  in_stock: 'In stock',
  issued: 'Issued',
  installed: 'Installed',
  faulty: 'Faulty',
  returned: 'Returned',
  retired: 'Retired',

  warehouse_staff: 'Warehouse staff',
  field_tech: 'Field tech',
  pm: 'Project manager',

  customer_cancelled: 'Customer cancelled',
  theft: 'Theft',
  upgrade: 'Upgrade',
  other: 'Other',

  new_install: 'New install',
  repair: 'Repair',
  removal: 'Removal',

  open: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',

  requested: 'Requested',
  approved: 'Approved',
  fulfilled: 'Fulfilled',
  rejected: 'Rejected',

  receive: 'Receive',
  transfer: 'Transfer',
  issue: 'Issue',
  install: 'Install',
};

export const label = (value) => LABELS[value] ?? value ?? '—';

// Which badge variant a status should wear, so the same status looks the same
// on every screen.
export const STATUS_VARIANT = {
  in_stock: 'ok',
  installed: 'installed',
  issued: '',
  returned: '',
  faulty: 'danger',
  retired: '',

  open: '',
  in_progress: 'installed',
  completed: 'ok',
  cancelled: 'danger',

  requested: '',
  approved: 'installed',
  fulfilled: 'ok',
  rejected: 'danger',
};
