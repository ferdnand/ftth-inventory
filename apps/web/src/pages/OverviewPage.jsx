import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  useInstallationTrends,
  useLowStock,
  useReportSummary,
  useTransactions,
} from '../hooks/useData';
import { ChartFrame } from '../charts/ChartFrame';
import { TrendLine } from '../charts/LazyMarks';
import { Meter, SeverityLabel } from '../components/Meter';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { daysAgo, formatMonth, formatRelative } from '../lib/format';
import { label } from '../lib/constants';

// A tech has no business on this page — the API rejects /reports for them — so
// they get their van instead of a wall of 403s.
function TechOverview({ user }) {
  return (
    <div className="page">
      <PageHeader
        title={`Hello, ${user.name}`}
        sub="The dashboard's reports are for warehouse staff and managers. Your stock lives in the mobile app."
      />
      <EmptyState title="Use the field app for your van">
        Your assigned location is{' '}
        <strong>{user.assigned_location_name ?? 'not set — ask a manager'}</strong>. You can still
        look up premises and your jobs here.
        <div className="btn-row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <Link className="btn-secondary" to="/premises">
            Find a premises
          </Link>
          <Link className="btn-secondary" to="/work-orders">
            My jobs
          </Link>
        </div>
      </EmptyState>
    </div>
  );
}

// Split rather than early-returning inside one component: the hooks below must
// not be called at all for a field tech, and calling them conditionally would
// break the rules of hooks.
export function OverviewPage() {
  const { user, hasRole } = useAuth();
  return hasRole('warehouse_staff', 'pm') ? <StaffOverview user={user} /> : <TechOverview user={user} />;
}

function StaffOverview({ user }) {
  const summary = useReportSummary();
  const lowStock = useLowStock();
  const trends = useInstallationTrends({ from: daysAgo(84), interval: 'week' });
  const activity = useTransactions({ limit: 10 });

  if (summary.isError) {
    return (
      <div className="page">
        <ErrorState error={summary.error} onRetry={summary.refetch} />
      </div>
    );
  }

  const s = summary.data;
  const worstFive = (lowStock.data ?? []).slice(0, 5);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Today"
        title="Overview"
        sub={`Signed in as ${user.name} · ${label(user.role)}`}
      />

      {/* ONE hero figure. Headline numbers are not charts, and a one-bar bar
        * chart is an anti-pattern. */}
      <div className="cols-2" style={{ marginBottom: 16 }}>
        <div className="hero-figure">
          <div className="num">{summary.isPending ? '—' : s.active_installations}</div>
          <div className="lbl">Routers in service</div>
        </div>
        <div className="stat-row" style={{ marginBottom: 0 }}>
          <div className="stat">
            <div className="num">{summary.isPending ? '—' : s.serialized_units_in_stock}</div>
            <div className="lbl">Units in stock</div>
          </div>
          <div className={`stat ${worstFive.length > 0 ? 'warn' : ''}`.trim()}>
            <div className="num">{lowStock.isPending ? '—' : lowStock.data.length}</div>
            <div className="lbl">Low stock rows</div>
          </div>
          <div className="stat">
            <div className="num">{summary.isPending ? '—' : s.open_work_orders}</div>
            <div className="lbl">Open jobs</div>
          </div>
          <div className="stat">
            <div className="num">{summary.isPending ? '—' : s.installs_this_month}</div>
            <div className="lbl">Installs this month</div>
          </div>
          <div className="stat">
            <div className="num">{summary.isPending ? '—' : s.units_awaiting_return}</div>
            <div className="lbl">Units to collect</div>
          </div>
          <div className="stat">
            <div className="num">{summary.isPending ? '—' : s.pending_restock_requests}</div>
            <div className="lbl">Restock requests</div>
          </div>
        </div>
      </div>

      <div className="cols-2">
        <ChartFrame
          title="Installs, last 12 weeks"
          subtitle="Weekly count of routers put into service"
          isRefetching={trends.isRefetching}
          tableColumns={[
            { key: 'bucket', header: 'Week', render: (r) => formatMonth(r.bucket) },
            { key: 'installs', header: 'Installs', numeric: true },
            { key: 'removals', header: 'Removals', numeric: true },
          ]}
          tableRows={trends.data?.trends ?? []}
        >
          {trends.isPending ? (
            <LoadingRows rows={3} />
          ) : trends.isError ? (
            <ErrorState error={trends.error} onRetry={trends.refetch} />
          ) : (
            <TrendLine
              data={trends.data.trends}
              xKey="bucket"
              yKey="installs"
              yName="Installs"
              formatX={formatMonth}
            />
          )}
        </ChartFrame>

        <section className="chart-card">
          <div className="chart-head">
            <div>
              <h3>Recent activity</h3>
              <div className="sub">Last 10 stock movements</div>
            </div>
            <Link className="btn-secondary btn-sm" to="/locations">
              All stock
            </Link>
          </div>
          {activity.isPending ? (
            <LoadingRows rows={5} />
          ) : activity.isError ? (
            <ErrorState error={activity.error} onRetry={activity.refetch} />
          ) : activity.data.length === 0 ? (
            <EmptyState title="No movements yet">
              Receiving or transferring stock will show up here.
            </EmptyState>
          ) : (
            <div className="activity-list">
              {activity.data.map((t) => (
                <div className="activity-row" key={t.id}>
                  <span className="what">
                    <strong>{label(t.type)}</strong> {t.item_name}
                    {t.serial_number ? ` · ${t.serial_number}` : ''}
                    {t.quantity !== null ? ` · ${t.quantity} ${t.unit_of_measure}` : ''}
                    <div style={{ color: 'var(--text-2)', fontSize: 12 }}>
                      {[t.from_location_name, t.to_location_name].filter(Boolean).join(' → ') ||
                        'customer premises'}{' '}
                      · {t.performed_by_name}
                    </div>
                  </span>
                  <span className="when">{formatRelative(t.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* A ratio against a limit is a meter table, not a chart. */}
      <div className="section-label">Needs attention</div>
      {lowStock.isPending ? (
        <LoadingRows rows={4} />
      ) : lowStock.isError ? (
        <ErrorState error={lowStock.error} onRetry={lowStock.refetch} />
      ) : worstFive.length === 0 ? (
        <EmptyState title="Nothing is below its reorder threshold">
          Every item with a threshold is above it at every warehouse and van.
        </EmptyState>
      ) : (
        <div className="table-wrap scroll-x">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Location</th>
                <th>Level</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {worstFive.map((row) => (
                <tr className="low" key={`${row.location_id}-${row.item_id}`}>
                  <td>
                    <div className="item-name">{row.item_name}</div>
                    <div className="item-meta">{row.category}</div>
                  </td>
                  <td>{row.location_name}</td>
                  <td>
                    <Meter
                      quantity={row.quantity}
                      threshold={row.reorder_threshold}
                      unit={row.unit_of_measure}
                    />
                  </td>
                  <td>
                    <SeverityLabel quantity={row.quantity} threshold={row.reorder_threshold} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 12 }}>
        <Link className="btn-secondary" to="/reports/low-stock">
          Full low-stock report
        </Link>
      </div>
    </div>
  );
}
