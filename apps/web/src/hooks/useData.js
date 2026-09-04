import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { keys, invalidateAfterStockChange, invalidateAfterInstallation } from '../lib/queryKeys';
import {
  normalizeStock,
  normalizeStockSummary,
  normalizeItems,
  normalizeTransactions,
  normalizeLowStock,
  normalizeConsumption,
} from '../lib/num';

// Coercion happens in `select`, so a component never receives a NUMERIC as the
// string pg actually sends.

// --- Catalog --------------------------------------------------------------

export const useItems = (params) =>
  useQuery({
    queryKey: keys.items(params),
    queryFn: () => api.items(params),
    select: (data) => normalizeItems(data.items),
    staleTime: 5 * 60_000, // the catalog barely changes
  });

export const useLocations = (type) =>
  useQuery({
    queryKey: keys.locations(type),
    queryFn: () => api.locations(type),
    select: (data) => data.locations,
    staleTime: 5 * 60_000,
  });

export const useUsers = (params) =>
  useQuery({
    queryKey: keys.users(params),
    queryFn: () => api.users(params),
    select: (data) => data.users,
    staleTime: 5 * 60_000,
  });

// --- Stock ----------------------------------------------------------------

export const useStock = (locationId) =>
  useQuery({
    queryKey: keys.stock(locationId),
    queryFn: () => api.stock(locationId),
    select: normalizeStock,
    enabled: Boolean(locationId),
  });

export const useStockSummary = (locationId) =>
  useQuery({
    queryKey: keys.stockSummary(locationId),
    queryFn: () => api.stockSummary(locationId),
    select: normalizeStockSummary,
    enabled: Boolean(locationId),
  });

export const useTransactions = (params, options = {}) =>
  useQuery({
    queryKey: keys.transactions(params),
    queryFn: () => api.transactions(params),
    select: (data) => normalizeTransactions(data.transactions),
    ...options,
  });

// --- Premises -------------------------------------------------------------

export const usePremisesSearch = (query) =>
  useQuery({
    queryKey: keys.premisesSearch(query),
    queryFn: () => api.searchPremises(query),
    select: (data) => data.results,
    // The API returns { results: [] } with a 200 under 2 characters, and the UI
    // renders a hint rather than an empty state — so don't even ask.
    enabled: (query ?? '').trim().length >= 2,
  });

export const usePremises = (id) =>
  useQuery({
    queryKey: keys.premises(id),
    queryFn: () => api.premises(id),
    select: (data) => data.premises,
    enabled: Boolean(id),
  });

export const useCurrentInstallation = (premisesId) =>
  useQuery({
    queryKey: keys.currentInstallation(premisesId),
    queryFn: () => api.currentInstallation(premisesId),
    select: (data) => data.current,
    enabled: Boolean(premisesId),
  });

export const usePremisesHistory = (premisesId) =>
  useQuery({
    queryKey: keys.premisesHistory(premisesId),
    queryFn: () => api.premisesHistory(premisesId),
    enabled: Boolean(premisesId),
  });

// --- Work orders ----------------------------------------------------------

export const useWorkOrders = (params) =>
  useQuery({
    queryKey: keys.workOrders(params),
    queryFn: () => api.workOrders(params),
    select: (data) => data.work_orders,
  });

export const useWorkOrder = (id) =>
  useQuery({
    queryKey: keys.workOrder(id),
    queryFn: () => api.workOrder(id),
    select: (data) => data.work_order,
    enabled: Boolean(id),
  });

// --- Restock --------------------------------------------------------------

export const useRestockRequests = (params) =>
  useQuery({
    queryKey: keys.restockRequests(params),
    queryFn: () => api.restockRequests(params),
    select: (data) => data.restock_requests,
  });

// --- Reports --------------------------------------------------------------

export const useReportSummary = () =>
  useQuery({
    queryKey: keys.reportSummary,
    queryFn: () => api.reportSummary(),
    select: (data) => data.summary,
  });

export const useLowStock = (params) =>
  useQuery({
    queryKey: keys.reportLowStock(params),
    queryFn: () => api.reportLowStock(params),
    select: (data) => normalizeLowStock(data.low_stock),
  });

export const useConsumption = (params) =>
  useQuery({
    queryKey: keys.reportConsumption(params),
    queryFn: () => api.reportConsumption(params),
    select: (data) => ({ ...data, consumption: normalizeConsumption(data.consumption) }),
  });

export const useTechActivity = (params) =>
  useQuery({
    queryKey: keys.reportTechActivity(params),
    queryFn: () => api.reportTechActivity(params),
    select: (data) => data.tech_activity,
  });

export const useInstallationTrends = (params) =>
  useQuery({
    queryKey: keys.reportInstallationTrends(params),
    queryFn: () => api.reportInstallationTrends(params),
  });

export const useStockByLocation = () =>
  useQuery({
    queryKey: keys.reportStockByLocation,
    queryFn: () => api.reportStockByLocation(),
    select: (data) => data.stock_by_location,
  });

// --- Mutations ------------------------------------------------------------

// Every stock-changing mutation invalidates the same set, in one place, so no
// screen is left showing a number that stopped being true.
function useStockMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateAfterStockChange(queryClient),
  });
}

export const useCreateTransaction = () => useStockMutation((body) => api.createTransaction(body));
export const useCreateItemInstances = () =>
  useStockMutation((body) => api.createItemInstances(body));
export const useUpdateRestockRequest = () =>
  useStockMutation(({ id, ...body }) => api.updateRestockRequest(id, body));

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createItem(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] }),
  });
}

export function useUpdateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.updateItem(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] }),
  });
}

export function useCreateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createLocation(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['locations'] }),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createUser(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.updateUser(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      // A reassigned van changes what that tech sees.
      queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
  });
}

export function useCreatePremises() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createPremises(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['premises'] }),
  });
}

export function useCreateWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createWorkOrder(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useUpdateWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => api.updateWorkOrder(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useInstall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.install(body),
    onSuccess: (_data, variables) =>
      invalidateAfterInstallation(queryClient, variables.customer_premises_id),
  });
}

export function useReplaceRouter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ premisesId, ...body }) => api.replaceRouter(premisesId, body),
    onSuccess: (_data, variables) =>
      invalidateAfterInstallation(queryClient, variables.premisesId),
  });
}
