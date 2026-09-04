import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute, RoleRoute } from './auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { ItemsPage } from './pages/ItemsPage';
import { LocationsPage } from './pages/LocationsPage';
import { LocationStockPage } from './pages/LocationStockPage';
import { ReceiveStockPage } from './pages/ReceiveStockPage';
import { TransferStockPage } from './pages/TransferStockPage';
import { WorkOrdersPage } from './pages/WorkOrdersPage';
import { WorkOrderDetailPage } from './pages/WorkOrderDetailPage';
import { PremisesSearchPage } from './pages/PremisesSearchPage';
import { PremisesDetailPage } from './pages/PremisesDetailPage';
import { RestockQueuePage } from './pages/RestockQueuePage';
import { UsersPage } from './pages/UsersPage';
import { LowStockReportPage } from './pages/reports/LowStockReportPage';
import { EmptyState, LoadingRows } from './components/states';

// The charting library is ~450 kB and only the three chart-bearing reports use
// it, so they load on demand rather than sitting in the bundle every operator
// downloads to look at stock. The low-stock report is deliberately NOT lazy —
// it has no chart, and it is the one a warehouse opens most.
const ConsumptionReportPage = lazyPage(
  () => import('./pages/reports/ConsumptionReportPage'),
  'ConsumptionReportPage'
);
const TechActivityReportPage = lazyPage(
  () => import('./pages/reports/TechActivityReportPage'),
  'TechActivityReportPage'
);
const InstallationTrendsReportPage = lazyPage(
  () => import('./pages/reports/InstallationTrendsReportPage'),
  'InstallationTrendsReportPage'
);

// These modules use named exports; React.lazy wants a default.
function lazyPage(loader, name) {
  const Component = lazy(() => loader().then((module) => ({ default: module[name] })));
  return function LazyPage() {
    return (
      <Suspense
        fallback={
          <div className="page">
            <LoadingRows rows={5} label="Loading report" />
          </div>
        }
      >
        <Component />
      </Suspense>
    );
  };
}

const STAFF = ['warehouse_staff', 'pm'];

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <OverviewPage /> },

          { path: 'items', element: <ItemsPage /> },
          { path: 'locations', element: <LocationsPage /> },
          { path: 'locations/:id/stock', element: <LocationStockPage /> },

          { path: 'premises', element: <PremisesSearchPage /> },
          { path: 'premises/:id', element: <PremisesDetailPage /> },

          { path: 'work-orders', element: <WorkOrdersPage /> },
          { path: 'work-orders/:id', element: <WorkOrderDetailPage /> },

          // Role gating here is UX only — it keeps someone off a page the API
          // would reject anyway. The API is what enforces authorization.
          {
            element: <RoleRoute roles={STAFF} />,
            children: [
              { path: 'stock/receive', element: <ReceiveStockPage /> },
              { path: 'stock/transfer', element: <TransferStockPage /> },
              { path: 'restock', element: <RestockQueuePage /> },
              { path: 'reports/low-stock', element: <LowStockReportPage /> },
              { path: 'reports/consumption', element: <ConsumptionReportPage /> },
              { path: 'reports/tech-activity', element: <TechActivityReportPage /> },
              { path: 'reports/installations', element: <InstallationTrendsReportPage /> },
            ],
          },
          {
            element: <RoleRoute roles={['pm']} />,
            children: [{ path: 'users', element: <UsersPage /> }],
          },

          { path: 'reports', element: <Navigate to="/reports/low-stock" replace /> },
          {
            path: '*',
            element: (
              <div className="page">
                <EmptyState title="Page not found">
                  That address does not exist in this dashboard.
                </EmptyState>
              </div>
            ),
          },
        ],
      },
    ],
  },
]);
