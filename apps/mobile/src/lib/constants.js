// Mirrors the enum types in apps/api/db/migrations/001_init.sql, which is the
// source of truth. Per the API's PROCESS.md, new values go on the existing
// *_enum types rather than becoming free text — so this is frozen data, not
// logic.
//
// Duplicated from apps/web/src/lib/constants.js on purpose. Sharing it would
// mean a workspace package that both Metro and Vite have to resolve, plus a
// re-break risk on every Expo SDK bump — a permanent build-seam tax for ~35
// lines of frozen data. Keep the two copies in sync when an enum changes.

export const REMOVAL_REASONS = ['faulty', 'upgrade', 'customer_cancelled', 'theft', 'other'];
export const INSTANCE_STATUSES = [
  'in_stock',
  'issued',
  'installed',
  'faulty',
  'returned',
  'retired',
];
export const WORK_ORDER_TYPES = ['new_install', 'repair', 'upgrade', 'removal'];
export const WORK_ORDER_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];
export const RESTOCK_STATUSES = ['requested', 'approved', 'fulfilled', 'rejected', 'cancelled'];

export const LABELS = {
  in_stock: 'In stock',
  issued: 'Issued',
  installed: 'Installed',
  faulty: 'Faulty',
  returned: 'Returned',
  retired: 'Retired',

  faulty_reason: 'Faulty',
  upgrade: 'Upgrade',
  customer_cancelled: 'Customer cancelled',
  theft: 'Theft',
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

  warehouse: 'Warehouse',
  site: 'Site',
  tech_van: 'Tech van',

  field_tech: 'Field tech',
  warehouse_staff: 'Warehouse staff',
  pm: 'Project manager',
  admin: 'Administrator',

  receive: 'Received',
  transfer: 'Transferred',
  issue: 'Issued',
  install: 'Installed',
  return: 'Returned',
  adjustment: 'Corrected',
};

export const label = (value) => LABELS[value] ?? value ?? '—';

// Short, tap-friendly copy for the reason pills on the replace screen.
export const REMOVAL_REASON_LABELS = {
  faulty: 'Faulty',
  upgrade: 'Upgrade',
  customer_cancelled: 'Cancelled',
  theft: 'Theft',
  other: 'Other',
};
