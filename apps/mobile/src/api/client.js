import { API_BASE_URL } from '../lib/config';
import { getToken } from '../auth/tokenStore';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// A field network drops. Without a timeout a request can hang until the OS
// gives up, which reads to the tech as a frozen app.
const TIMEOUT_MS = 15000;

async function request(path, { method = 'GET', body, params } = {}) {
  const query = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    }
  }
  const qs = query.toString();
  const url = `${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`;

  // Async, unlike the web client's synchronous localStorage read.
  const token = await getToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Name the actual likely cause. On a physical device this is almost always
    // the API host, not the API itself.
    if (err.name === 'AbortError') {
      throw new ApiError(0, 'The request timed out. Check your signal and try again.');
    }
    throw new ApiError(
      0,
      `Cannot reach the server at ${API_BASE_URL}. Check you are on the same network as it.`
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, 'Your session has ended. Sign in again.');
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // Every failing route returns { error: '<sentence>' } written for a person.
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  }
  return data;
}

// One key per user-initiated submit, resent on retry, so a flaky connection
// cannot double-install a router.
export const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me'),

  stock: (locationId) => request('/stock', { params: { location_id: locationId } }),

  searchPremises: (q, siteId) =>
    request('/premises/search', { params: { q, site_id: siteId } }),
  // Browsing a site, for the compounds that have no address to type.
  premisesAtSite: (siteId) => request('/premises', { params: { site_id: siteId } }),
  premises: (id) => request(`/premises/${id}`),
  createPremises: (body) => request('/premises', { method: 'POST', body }),
  updatePremises: (id, body) => request(`/premises/${id}`, { method: 'PATCH', body }),
  currentInstallation: (id) => request(`/premises/${id}/current`),
  premisesHistory: (id) => request(`/premises/${id}/history`),

  install: (body) => request('/installations', { method: 'POST', body }),
  // NOTE: the path segment is a customer_premises id, NOT an installation id.
  replaceRouter: (premisesId, body) =>
    request(`/installations/${premisesId}/replace`, { method: 'POST', body }),

  transactions: (params) => request('/transactions', { params }),
  createTransaction: (body) => request('/transactions', { method: 'POST', body }),

  items: () => request('/items'),
  services: () => request('/services'),
  // The complete list, not an addition — sending [] clears the recorded work.
  setInstallationServices: (installationId, services) =>
    request(`/installations/${installationId}/services`, { method: 'PUT', body: { services } }),
  locations: (type) => request('/locations', { params: { type } }),

  // Jobs. The API path is /work-orders because that is what the manager calls
  // one; the app says "job" because that is what the tech calls it.
  workOrders: (params) => request('/work-orders', { params }),
  workOrder: (id) => request(`/work-orders/${id}`),
  createWorkOrder: (body) => request('/work-orders', { method: 'POST', body }),
  updateWorkOrder: (id, body) => request(`/work-orders/${id}`, { method: 'PATCH', body }),

  // All three take the COMPLETE list and replace what is there, so a retry on
  // a dying connection cannot double-count. Materials move van stock by the
  // difference, which is why re-sending the same list moves nothing.
  // `fromLocationId` is the stock the materials come out of — the job's site.
  // Left out, the API falls back to the job's site on its own.
  setJobMaterials: (id, materials, fromLocationId) =>
    request(`/work-orders/${id}/materials`, {
      method: 'PUT',
      body: { materials, from_location_id: fromLocationId },
    }),
  setJobServices: (id, services) =>
    request(`/work-orders/${id}/services`, { method: 'PUT', body: { services } }),
  setJobExpenses: (id, expenses) =>
    request(`/work-orders/${id}/expenses`, { method: 'PUT', body: { expenses } }),

  restockRequests: (params) => request('/restock-requests', { params }),
  createRestockRequest: (body) => request('/restock-requests', { method: 'POST', body }),
};
