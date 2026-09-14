import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { num } from '../lib/format';

export const keys = {
  me: ['me'],
  stock: (locationId) => ['stock', locationId],
  items: ['items'],
  services: ['services'],
  locations: (type) => ['locations', type ?? 'all'],
  premisesSearch: (q, siteId) => ['premises', 'search', q, siteId ?? 'all'],
  premisesAtSite: (siteId) => ['premises', 'site', siteId],
  currentInstallation: (id) => ['premises', id, 'current'],
  premisesHistory: (id) => ['premises', id, 'history'],
  transactions: (params) => ['transactions', params ?? {}],
  workOrders: (params) => ['work-orders', params ?? {}],
  restockRequests: (params) => ['restock-requests', params ?? {}],
  job: (id) => ['work-orders', 'detail', id],
};

// pg sends NUMERIC as a string; coerce once here so nothing downstream compares
// numbers lexically.
const normalizeStock = (payload) => ({
  location_id: payload.location_id,
  serialized: payload.serialized,
  bulk: payload.bulk.map((row) => ({
    ...row,
    quantity: num(row.quantity),
    reorder_threshold: num(row.reorder_threshold),
    unit_cost: num(row.unit_cost),
    is_low_stock: row.is_low_stock === true,
  })),
});

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api.me(), select: (d) => d.user });

export const useStock = (locationId) =>
  useQuery({
    queryKey: keys.stock(locationId),
    queryFn: () => api.stock(locationId),
    select: normalizeStock,
    enabled: Boolean(locationId),
  });

export const useItems = () =>
  useQuery({
    queryKey: keys.items,
    queryFn: () => api.items(),
    select: (d) => d.items,
    staleTime: 10 * 60_000,
  });

export const useServices = () =>
  useQuery({
    queryKey: keys.services,
    queryFn: () => api.services(),
    select: (d) => d.services,
    staleTime: 5 * 60_000,
  });

export const useLocations = (type) =>
  useQuery({
    queryKey: keys.locations(type),
    queryFn: () => api.locations(type),
    select: (d) => d.locations,
    staleTime: 10 * 60_000,
  });

export const usePremisesSearch = (query, siteId) =>
  useQuery({
    queryKey: keys.premisesSearch(query, siteId),
    queryFn: () => api.searchPremises(query, siteId),
    select: (d) => d.results,
    // The API answers { results: [] } with a 200 under 2 characters and the UI
    // shows a hint, so there is nothing to ask for.
    enabled: (query ?? '').trim().length >= 2,
  });

// Browsing a site rather than searching it. A compound recorded as a GPS pin
// and a landmark is invisible to a search box, because the tech has nothing to
// type — so the list has to be there.
export const usePremisesAtSite = (siteId) =>
  useQuery({
    queryKey: keys.premisesAtSite(siteId),
    queryFn: () => api.premisesAtSite(siteId),
    select: (d) => d.premises,
    enabled: Boolean(siteId),
  });

// The two sites. Reference data that changes about never, so it is cached hard.
export const useSites = () =>
  useQuery({
    queryKey: keys.locations('site'),
    queryFn: () => api.locations('site'),
    select: (d) => d.locations,
    staleTime: 60 * 60_000,
  });

// One job with everything on it: the premises, the unit fitted, the materials,
// the labour, the expenses and the totals. One request, because the tech opens
// this screen on a village connection and then works from what it returned.
export const useJob = (id) =>
  useQuery({
    queryKey: keys.job(id),
    queryFn: () => api.workOrder(id),
    select: (d) => d.work_order,
    enabled: Boolean(id),
  });

export const useCurrentInstallation = (premisesId) =>
  useQuery({
    queryKey: keys.currentInstallation(premisesId),
    queryFn: () => api.currentInstallation(premisesId),
    select: (d) => d.current,
    enabled: Boolean(premisesId),
  });

export const usePremisesHistory = (premisesId) =>
  useQuery({
    queryKey: keys.premisesHistory(premisesId),
    queryFn: () => api.premisesHistory(premisesId),
    enabled: Boolean(premisesId),
  });

export const useTransactions = (params) =>
  useQuery({
    queryKey: keys.transactions(params),
    queryFn: () => api.transactions(params),
    select: (d) => d.transactions.map((t) => ({ ...t, quantity: num(t.quantity) })),
  });

export const useWorkOrders = (params) =>
  useQuery({
    queryKey: keys.workOrders(params),
    queryFn: () => api.workOrders(params),
    select: (d) => d.work_orders,
  });

export const useRestockRequests = (params) =>
  useQuery({
    queryKey: keys.restockRequests(params),
    queryFn: () => api.restockRequests(params),
    select: (d) => d.restock_requests,
  });

// --- Mutations ------------------------------------------------------------

// After an install or a replacement, the van's stock, this premises' current
// router and its history, and the tech's job list are all stale at once.
function invalidateInstallation(queryClient, premisesId) {
  queryClient.invalidateQueries({ queryKey: ['stock'] });
  queryClient.invalidateQueries({ queryKey: ['premises', premisesId] });
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  // Every job list and job detail: the install put hardware into one of their
  // cost totals, and may have opened the job itself.
  queryClient.invalidateQueries({ queryKey: ['work-orders'] });
}

export function useInstall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.install(body),
    onSuccess: (_data, variables) =>
      invalidateInstallation(queryClient, variables.customer_premises_id),
  });
}

export function useReplaceRouter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ premisesId, ...body }) => api.replaceRouter(premisesId, body),
    onSuccess: (_data, variables) => invalidateInstallation(queryClient, variables.premisesId),
  });
}

// Recorded labour changes nothing about stock, so only the premises views go
// stale — not the van.
export function useSetInstallationServices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ installationId, services }) =>
      api.setInstallationServices(installationId, services),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ['premises', variables.premisesId] }),
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createTransaction(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useCreateRestockRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createRestockRequest(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['restock-requests'] }),
  });
}

export function useUpdateWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.updateWorkOrder(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
  });
}

export function useCreatePremises() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createPremises(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['premises'] }),
  });
}

// A better GPS fix on an existing premises. Any tech may do this — see the
// PATCH /api/premises/:id comment for why that is not the same as letting them
// rename an address.
export function useUpdatePremisesLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ premisesId, ...body }) => api.updatePremises(premisesId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['premises'] });
      // A job row carries its premises' label and coordinates, so a better fix
      // changes what the job list shows too.
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    },
  });
}

// --- Jobs -----------------------------------------------------------------

// Opening a job may also have created the premises, so both lists are stale.
export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createWorkOrder(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['premises'] });
    },
  });
}

function invalidateJob(queryClient, jobId) {
  queryClient.invalidateQueries({ queryKey: keys.job(jobId) });
  queryClient.invalidateQueries({ queryKey: ['work-orders'] });
}

// Materials are the only job lines that move stock, so they are the only ones
// that make the van's own view stale.
export function useSetJobMaterials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, materials }) => api.setJobMaterials(jobId, materials),
    onSuccess: (_data, variables) => {
      invalidateJob(queryClient, variables.jobId);
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useSetJobServices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, services }) => api.setJobServices(jobId, services),
    onSuccess: (_data, variables) => {
      invalidateJob(queryClient, variables.jobId);
      // Labour now hangs off the job, so the premises timeline reads it back
      // through the installation's job and goes stale with it.
      queryClient.invalidateQueries({ queryKey: ['premises'] });
    },
  });
}

export function useSetJobExpenses() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, expenses }) => api.setJobExpenses(jobId, expenses),
    onSuccess: (_data, variables) => invalidateJob(queryClient, variables.jobId),
  });
}
