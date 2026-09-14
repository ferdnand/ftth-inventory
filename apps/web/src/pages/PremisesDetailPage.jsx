import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  useCurrentInstallation,
  usePremisesHistory,
  useUpdatePremises,
  useWorkOrders,
} from '../hooks/useData';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import {
  PremisesFields,
  premisesFormBody,
  premisesFormFrom,
  premisesFormLocatable,
} from '../components/PremisesFields';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { EditServicesDialog, ServicesSummary } from '../components/InstallationServices';
import { toTimelineEvents } from '../lib/groupSerialized';
import { formatDate, formatDateTime, formatPremisesCode } from '../lib/format';
import { label } from '../lib/constants';

// A premises row is the anchor of an install history, so the address on it is
// what every past visit says the work was done at. Correcting a typo is a
// back-office job — the API will not take this from a tech.
function PremisesFormDialog({ premises, onClose }) {
  const update = useUpdatePremises();
  const { notify, notifyError } = useToast();

  const [form, setForm] = useState(() => premisesFormFrom(premises));
  const [errors, setErrors] = useState({});
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(event) {
    event.preventDefault();
    // The old rule was "an address is required". It is not: what a premises
    // needs is to be findable again, and out here that is usually a pin and a
    // landmark. Same rule as premises_must_be_locatable in the database.
    if (!premisesFormLocatable(form)) {
      setErrors({ address: 'Give this, or a landmark, or a GPS pin' });
      return;
    }
    try {
      // nulls: true — on an edit, an emptied box has to be sent as null to
      // actually clear it. A missing key means "leave this alone".
      await update.mutateAsync({ id: premises.id, ...premisesFormBody(form, { nulls: true }) });
      notify('Premises updated');
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title="Edit premises"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="premises-form"
            className="btn-primary"
            disabled={update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="premises-form" onSubmit={onSubmit}>
        <PremisesFields form={form} set={set} errors={errors} />
      </form>
    </Modal>
  );
}

export function PremisesDetailPage() {
  const { id } = useParams();
  const premisesId = Number(id);

  const history = usePremisesHistory(premisesId);
  const current = useCurrentInstallation(premisesId);
  const workOrders = useWorkOrders({ customer_premises_id: premisesId });
  const { hasRole } = useAuth();
  const [editingServices, setEditingServices] = useState(false);
  const [editingPremises, setEditingPremises] = useState(false);

  // Installs happen in the field, so the dashboard's role here is correcting
  // the record afterwards — a mistyped cable length, a splice nobody logged.
  const canRecordWork = hasRole('warehouse_staff', 'pm');

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
        title={premises.label}
        sub={premises.customer_account_id ? `Account ${premises.customer_account_id}` : undefined}
        actions={
          <>
            {canRecordWork ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditingPremises(true)}
              >
                Edit premises
              </button>
            ) : null}
            <Link className="btn-secondary" to="/premises">
              Back to search
            </Link>
          </>
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

      {/* An address used to be the whole story. Now the pin and the phone
        * number are the parts that get anyone here, so they come first. */}
      <div className="section-label">The place</div>
      <div className="card">
        <div className="item-meta">
          {[label(premises.premises_type), premises.village, premises.site_name]
            .filter(Boolean)
            .join(' · ') || 'No site or village recorded'}
        </div>
        {premises.customer_name ? (
          <div className="item-name">{premises.customer_name}</div>
        ) : null}
        {premises.customer_phone ? (
          <div className="item-meta">{premises.customer_phone}</div>
        ) : null}
        {premises.landmark ? <div className="item-meta">{premises.landmark}</div> : null}
        <div className="item-meta">
          {premises.gps_lat === null || premises.gps_lat === undefined
            ? 'No GPS pin — a tech can drop one from the field app'
            : `Pin ${Number(premises.gps_lat).toFixed(5)}, ${Number(premises.gps_lng).toFixed(5)}` +
              (premises.gps_accuracy_m ? ` (±${premises.gps_accuracy_m} m)` : '')}
        </div>
        {premises.created_by_name ? (
          <div className="item-meta">Captured by {premises.created_by_name}</div>
        ) : null}
        {premises.notes ? (
          <div className="item-meta" style={{ whiteSpace: 'pre-wrap' }}>
            {premises.notes}
          </div>
        ) : null}
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
              <ServicesSummary services={current.data.services} />
            </div>
            <Badge variant="installed">Active</Badge>
          </div>
          {canRecordWork ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEditingServices(true)}
            >
              {current.data.services?.length ? 'Edit recorded work' : 'Record work performed'}
            </button>
          ) : null}
        </div>
      )}

      {editingServices && current.data ? (
        <EditServicesDialog
          installationId={current.data.installation_id}
          premisesId={premisesId}
          current={current.data.services}
          onClose={() => setEditingServices(false)}
        />
      ) : null}

      {editingPremises ? (
        <PremisesFormDialog premises={premises} onClose={() => setEditingPremises(false)} />
      ) : null}

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
                  {event.kind === 'installed' ? (
                    <ServicesSummary services={event.services} />
                  ) : null}
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

      <div className="section-label">Jobs at this premises</div>
      {workOrders.isPending ? (
        <LoadingRows rows={2} />
      ) : (workOrders.data ?? []).length === 0 ? (
        <EmptyState title="No jobs recorded here">
          Nobody has visited yet. A tech opens a job when they arrive, and every install belongs
          to one.
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
