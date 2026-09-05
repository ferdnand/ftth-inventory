import { getToken } from '../auth/tokenStore';
import { ApiError } from './ApiError';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

// Registered by AuthProvider so a 401 anywhere clears the session and routes to
// the login page, rather than each caller having to handle it.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = 'GET', body, params, signal } = {}) {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const token = getToken();
  const res = await fetch(url, {
    method,
    signal,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, 'Your session has ended. Sign in again.');
  }

  // Empty-body safe: a 204 has no JSON to parse.
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  }
  return data;
}

// A key the API uses to make a retried submit safe. Generated per user action,
// not per request, so a retry carries the same one.
export const newIdempotencyKey = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);

export const api = {
  // --- Auth ---
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me'),

  // --- Catalog ---
  items: (params) => request('/items', { params }),
  createItem: (body) => request('/items', { method: 'POST', body }),
  updateItem: (id, body) => request(`/items/${id}`, { method: 'PATCH', body }),

  services: (params) => request('/services', { params }),
  createService: (body) => request('/services', { method: 'POST', body }),
  updateService: (id, body) => request(`/services/${id}`, { method: 'PATCH', body }),

  locations: (type) => request('/locations', { params: { type } }),
  createLocation: (body) => request('/locations', { method: 'POST', body }),
  updateLocation: (id, body) => request(`/locations/${id}`, { method: 'PATCH', body }),

  users: (params) => request('/users', { params }),
  createUser: (body) => request('/users', { method: 'POST', body }),
  updateUser: (id, body) => request(`/users/${id}`, { method: 'PATCH', body }),

  // --- Stock ---
  stock: (locationId) => request('/stock', { params: { location_id: locationId } }),
  stockSummary: (locationId) => request('/stock/summary', { params: { location_id: locationId } }),

  itemInstances: (params) => request('/item-instances', { params }),
  createItemInstances: (body) => request('/item-instances', { method: 'POST', body }),
  retireItemInstance: (id) =>
    request(`/item-instances/${id}`, { method: 'PATCH', body: { status: 'retired' } }),

  transactions: (params) => request('/transactions', { params }),
  createTransaction: (body) => request('/transactions', { method: 'POST', body }),

  // Admin-only. Takes the counted quantity, not a difference — the API works
  // out the correction, so submitting the same count twice is a no-op.
  adjustStock: (body) => request('/stock/adjustments', { method: 'POST', body }),

  // --- Premises & installations ---
  searchPremises: (q, signal) => request('/premises/search', { params: { q }, signal }),
  premises: (id) => request(`/premises/${id}`),
  createPremises: (body) => request('/premises', { method: 'POST', body }),
  updatePremises: (id, body) => request(`/premises/${id}`, { method: 'PATCH', body }),
  currentInstallation: (premisesId) => request(`/premises/${premisesId}/current`),
  premisesHistory: (premisesId) => request(`/premises/${premisesId}/history`),

  install: (body) => request('/installations', { method: 'POST', body }),
  // NOTE: the path segment is a customer_premises id, not an installation id.
  replaceRouter: (premisesId, body) =>
    request(`/installations/${premisesId}/replace`, { method: 'POST', body }),
  // The complete list, not an addition — sending [] clears the recorded work.
  setInstallationServices: (installationId, services) =>
    request(`/installations/${installationId}/services`, { method: 'PUT', body: { services } }),

  // --- Work orders ---
  workOrders: (params) => request('/work-orders', { params }),
  workOrder: (id) => request(`/work-orders/${id}`),
  createWorkOrder: (body) => request('/work-orders', { method: 'POST', body }),
  updateWorkOrder: (id, body) => request(`/work-orders/${id}`, { method: 'PATCH', body }),

  // --- Restock ---
  restockRequests: (params) => request('/restock-requests', { params }),
  restockRequest: (id) => request(`/restock-requests/${id}`),
  updateRestockRequest: (id, body) =>
    request(`/restock-requests/${id}`, { method: 'PATCH', body }),

  // --- Reports ---
  reportSummary: () => request('/reports/summary'),
  reportLowStock: (params) => request('/reports/low-stock', { params }),
  reportConsumption: (params) => request('/reports/consumption', { params }),
  reportTechActivity: (params) => request('/reports/tech-activity', { params }),
  reportInstallationTrends: (params) => request('/reports/installation-trends', { params }),
  reportServices: (params) => request('/reports/services', { params }),
  reportStockByLocation: () => request('/reports/stock-by-location'),
};
