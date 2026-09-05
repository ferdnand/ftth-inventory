import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { num } from '../lib/format';

export const keys = {
  me: ['me'],
  stock: (locationId) => ['stock', locationId],
  items: ['items'],
  services: ['services'],
  locations: (type) => ['locations', type ?? 'all'],
  premisesSearch: (q) => ['premises', 'search', q],
  currentInstallation: (id) => ['premises', id, 'current'],
  premisesHistory: (id) => ['premises', id, 'history'],
  transactions: (params) => ['transactions', params ?? {}],
  workOrders: (params) => ['work-orders', params ?? {}],
  restockRequests: (params) => ['restock-requests', params ?? {}],
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

export const usePremisesSearch = (query) =>
  useQuery({
    queryKey: keys.premisesSearch(query),
    queryFn: () => api.searchPremises(query),
    select: (d) => d.results,
    // The API answers { results: [] } with a 200 under 2 characters and the UI
    // shows a hint, so there is nothing to ask for.
    enabled: (query ?? '').trim().length >= 2,
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
