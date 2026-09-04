import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCurrentInstallation, usePremisesHistory, useWorkOrders } from '../hooks/useData';
import { Badge } from '../components/Badge';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { toTimelineEvents } from '../lib/groupSerialized';
import { formatDate, formatDateTime, formatPremisesCode } from '../lib/format';
import { label } from '../lib/constants';

export function PremisesDetailPage() {
  const { id } = useParams();
  const premisesId = Number(id);

  const history = usePremisesHistory(premisesId);
  const current = useCurrentInstallation(premisesId);
  const workOrders = useWorkOrders({ customer_premises_id: premisesId });

  const events = useMemo(
    () => toTimelineEvents(history.data?.timeline ?? []),
    [history.data]
  );

  if (history.isPending) {
    return (
      <div className="page">
        <LoadingRows rows={5} />
      </div>
    );
  }
  // /history 404s on an unknown id, unlike /current which answers
  // { current: null } with a 200. Both are handled; only this one is fatal.
  if (history.isError) {
    return (
      <div className="page">
        <ErrorState
          error={history.error}
          onRetry={history.refetch}
          title={history.error?.status === 404 ? 'No such premises' : undefined}
        />
      </div>
    );
  }

  const { premises, total_routers: totalRouters, replacement_count: replacements } = history.data;
  const openJobs = (workOrders.data ?? []).filter((wo) =>
    ['open', 'in_progress'].includes(wo.status)
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow={formatPremisesCode(premises.id)}
        title={premises.address}
        sub={premises.customer_account_id ? `Account ${premises.customer_account_id}` : undefined}
        actions={
          <Link className="btn-secondary" to="/premises">
            Back to search
          </Link>
        }
      />

      {/* Both figures come from the server: replacement_count is
        * total_routers - 1, so the first router is not counted as a
        * replacement. */}
      <div className="stat-row">
        <div className="stat">
          <div className="num">{totalRouters}</div>
          <div className="lbl">Total routers</div>
        </div>
        <div className="stat">
          <div className="num">{replacements}</div>
          <div className="lbl">Replacements</div>
        </div>
        <div className="stat">
          <div className="num">{openJobs.length}</div>
          <div className="lbl">Open jobs</div>
        </div>
      </div>

      <div className="section-label">Currently installed</div>
      {current.isPending ? (
        <LoadingRows rows={2} />
      ) : current.isError ? (
        <ErrorState error={current.error} onRetry={current.refetch} />
      ) : current.data === null ? (
        <EmptyState title="No active router at this address">
          Nothing is installed here right now. A field tech can install one from the mobile app.
        </EmptyState>
      ) : (
        <div className="card">
          <div className="card flat" style={{ border: 'none', padding: 0, margin: 0, background: 'transparent' }}>
            <div>
              <div className="item-name">{current.data.item_name}</div>
              <div className="item-meta">
                {current.data.serial_number}
                {current.data.mac_address ? ` · ${current.data.mac_address}` : ''}
              </div>
              <div className="item-meta">
                Installed {formatDate(current.data.installed_at)} by {current.data.installed_by_name}
              </div>
            </div>
            <Badge variant="installed">Active</Badge>
          </div>
        </div>
      )}

      <div className="section-label">Site history</div>
      {events.length === 0 ? (
        <EmptyState title="Nothing has been installed here yet" />
      ) : (
        <div className="card">
          <div className="timeline">
            {events.map((event, index) => {
              const isOldest = index === events.length - 1;
              return (
                <div
                  className={`t-item ${event.kind === 'removed' ? 'removed' : ''}`.trim()}
                  key={`${event.installationId}-${event.kind}`}
                >
                  <div className="t-date">{formatDateTime(event.at)}</div>
                  <div className="t-title">
                    {event.kind === 'installed'
                      ? isOldest
                        ? 'Initial install'
                        : 'Installed'
                      : 'Removed'}{' '}
                    — {event.item}
                  </div>
                  <div className="t-meta">
                    {event.serial}
                    {event.mac ? ` · ${event.mac}` : ''} · {event.by ?? 'unknown'}
                  </div>
                  {event.reason ? (
                    <span
                      className={`t-reason ${event.reason === 'upgrade' ? 'upgrade' : ''}`.trim()}
                    >
                      {label(event.reason)}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="section-label">Work orders at this address</div>
      {workOrders.isPending ? (
        <LoadingRows rows={2} />
      ) : (workOrders.data ?? []).length === 0 ? (
        <EmptyState title="No jobs recorded here">
          Work orders are optional — installs do not need one.
        </EmptyState>
      ) : (
        <div>
          {workOrders.data.map((wo) => (
            <Link
              className="result-item"
              to={`/work-orders/${wo.id}`}
              key={wo.id}
              style={{ display: 'block' }}
            >
              <div className="addr">
                #{wo.id} · {label(wo.type)} <Badge value={wo.status} />
              </div>
              <div className="id">
                {wo.assigned_tech_name ?? 'unassigned'}
                {wo.scheduled_date ? ` · ${formatDate(wo.scheduled_date)}` : ''}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
