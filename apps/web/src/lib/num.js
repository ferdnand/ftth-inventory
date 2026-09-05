// Numeric coercion at the API boundary.
//
// pg returns NUMERIC columns as STRINGS: GET /api/stock gives quantity: "180"
// and reorder_threshold: "100". Two things go wrong if that reaches a component:
// JS compares strings lexically ('180' < '90' is true, so sorting breaks), and
// Recharts renders string values incorrectly.
//
// The API owns its wire format; the clients own the coercion. Do it once, in
// each hook's `select`, so no component ever sees a raw string.

export const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// GET /api/stock computes is_low_stock server-side and COALESCEs it to false,
// so this is a plain boolean now. Kept as an identity test rather than a
// truthiness test because any older API build can still return null.
export const isLow = (row) => row.is_low_stock === true;

export function normalizeStock(payload) {
  return {
    location_id: payload.location_id,
    serialized: payload.serialized.map((r) => ({
      ...r,
      reorder_threshold: num(r.reorder_threshold),
    })),
    bulk: payload.bulk.map((r) => ({
      ...r,
      quantity: num(r.quantity),
      reorder_threshold: num(r.reorder_threshold),
      is_low_stock: r.is_low_stock === true,
    })),
  };
}

export function normalizeStockSummary(payload) {
  return {
    ...payload,
    serialized: payload.serialized.map((r) => ({
      ...r,
      reorder_threshold: num(r.reorder_threshold),
      is_low_stock: r.is_low_stock === true,
    })),
    bulk: payload.bulk.map((r) => ({
      ...r,
      quantity: num(r.quantity),
      reorder_threshold: num(r.reorder_threshold),
      is_low_stock: r.is_low_stock === true,
    })),
  };
}

export const normalizeItems = (items) =>
  items.map((i) => ({ ...i, reorder_threshold: num(i.reorder_threshold) }));

export const normalizeTransactions = (rows) =>
  rows.map((t) => ({ ...t, quantity: num(t.quantity) }));

export const normalizeLowStock = (rows) =>
  rows.map((r) => ({
    ...r,
    quantity: num(r.quantity),
    reorder_threshold: num(r.reorder_threshold),
    ratio: num(r.ratio),
  }));

export const normalizeConsumption = (rows) =>
  rows.map((r) => ({ ...r, quantity: num(r.quantity) }));

// Grouped by tech, quantity is deliberately NULL (jobs and metres do not add
// up), so num() keeps it null rather than coercing it to 0 and implying none
// was done.
export const normalizeServicesReport = (payload) => ({
  ...payload,
  services: payload.services.map((r) => ({ ...r, quantity: num(r.quantity) })),
  totals: {
    ...payload.totals,
    by_unit: payload.totals.by_unit.map((r) => ({ ...r, quantity: num(r.quantity) })),
  },
});
