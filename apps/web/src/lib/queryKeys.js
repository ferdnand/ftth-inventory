// One factory for every query key, so invalidation is never a typo.
//
// The invalidation graph is the real work in this app: one POST
// /api/transactions makes the source location's stock, the destination's stock,
// low-stock, consumption and the dashboard tiles all stale at once. Prefix
// invalidation (`['stock']`) handles that in one line — but only if every key
// starts from here.
export const keys = {
  me: ['me'],

  items: (params) => ['items', params ?? {}],
  locations: (type) => ['locations', type ?? 'all'],
  users: (params) => ['users', params ?? {}],

  stock: (locationId) => ['stock', locationId],
  stockSummary: (locationId) => ['stock', 'summary', locationId],
  itemInstances: (params) => ['item-instances', params ?? {}],

  transactions: (params) => ['transactions', params ?? {}],

  premisesSearch: (q) => ['premises', 'search', q],
  premises: (id) => ['premises', id],
  currentInstallation: (id) => ['premises', id, 'current'],
  premisesHistory: (id) => ['premises', id, 'history'],

  workOrders: (params) => ['work-orders', params ?? {}],
  workOrder: (id) => ['work-orders', id],

  restockRequests: (params) => ['restock-requests', params ?? {}],
  restockRequest: (id) => ['restock-requests', id],

  reports: ['reports'],
  reportSummary: ['reports', 'summary'],
  reportLowStock: (params) => ['reports', 'low-stock', params ?? {}],
  reportConsumption: (params) => ['reports', 'consumption', params ?? {}],
  reportTechActivity: (params) => ['reports', 'tech-activity', params ?? {}],
  reportInstallationTrends: (params) => ['reports', 'installation-trends', params ?? {}],
  reportStockByLocation: ['reports', 'stock-by-location'],
};

// Everything a stock movement makes stale. Called from every mutation that
// changes stock so no screen is left showing a number that is no longer true.
export function invalidateAfterStockChange(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['stock'] });
  queryClient.invalidateQueries({ queryKey: ['item-instances'] });
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['reports'] });
  queryClient.invalidateQueries({ queryKey: ['restock-requests'] });
}

// Everything an install or replacement makes stale.
export function invalidateAfterInstallation(queryClient, premisesId) {
  invalidateAfterStockChange(queryClient);
  queryClient.invalidateQueries({ queryKey: ['premises', premisesId] });
  queryClient.invalidateQueries({ queryKey: ['work-orders'] });
}
