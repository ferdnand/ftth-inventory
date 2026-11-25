import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  useCurrentInstallation,
  useDeletePremises,
  usePremisesHistory,
  useUpdatePremises,
  useWorkOrders,
} from '../hooks/useData';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
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
    if (form.connection_type === 'hotspot' && !form.hotspot_arrangement) {
      setErrors({ hotspot_arrangement: 'Say whether the host gets a token or a voucher' });
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

function DeletePremisesDialog({ premises, onClose, onDeleted }) {
  const remove = useDeletePremises();
  const { notify, notifyError } = useToast();

  async function onConfirm() {
    try {
      await remove.mutateAsync(premises.id);
      notify(`${premises.label} deleted`);
      onDeleted();
    } catch (err) {
      // A 409 means it has jobs or routers; its message says to mark it a
      // former client instead.
      notifyError(err);
      onClose();
    }
  }

  return (
    <ConfirmDialog
      title={`Delete ${premises.label}?`}
      confirmLabel="Delete permanently"
      pendingLabel="Deleting…"
      pending={remove.isPending}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        This removes the premises for good and cannot be undone. It only works for one that never
        had a job or a router — one added by mistake, or that never became a client.
      </p>
      <p>
        For a customer who has left, use <strong>Mark as former client</strong> instead: the
        record and its history stay, but it leaves the lists.
      </p>
    </ConfirmDialog>
  );
}

export function PremisesDetailPage() {
  const { id } = useParams();
  const premisesId = Number(id);

  const history = usePremisesHistory(premisesId);
  const current = useCurrentInstallation(premisesId);
  const workOrders = useWorkOrders({ customer_premises_id: premisesId });
  const { hasRole } = useAuth();
  const [editingServices, setEditingServices] = useState(null); // the router being edited
  const [editingPremises, setEditingPremises] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const update = useUpdatePremises();
  const navigate = useNavigate();
  const { notify, notifyError } = useToast();

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
  const isHotspot = premises.connection_type === 'hotspot';
  const routers = current.data ?? [];

  // A former client keeps the record but leaves every list, so a customer who
  // comes back can be reinstated rather than captured again.
  async function setFormerClient(former) {
    try {
      await update.mutateAsync({ id: premises.id, is_active: !former });
      notify(former ? 'Marked as a former client' : 'Reinstated as a client');
    } catch (err) {
      notifyError(err);
    }
  }
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
            {canRecordWork ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={update.isPending}
                onClick={() => setFormerClient(premises.is_active)}
              >
                {premises.is_active ? 'Mark as former client' : 'Reinstate client'}
              </button>
            ) : null}
            {hasRole('admin') ? (
              <button type="button" className="btn-secondary" onClick={() => setDeleting(true)}>
                Delete…
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
      {!premises.is_active ? (
        <div className="banner info">
          This is a former client. It no longer shows in the premises lists, and nothing new can
          be started here until it is reinstated.
        </div>
      ) : null}

      <div className="section-label">The place</div>
      <div className="card">
        <div className="item-meta">
          {[
            label(premises.connection_type),
            label(premises.premises_type),
            premises.village,
            premises.site_name,
          ]
            .filter(Boolean)
            .join(' · ') || 'No site or village recorded'}
        </div>
        {isHotspot ? (
          <div className="item-meta">Host gets: {label(premises.hotspot_arrangement)}</div>
        ) : null}
        {premises.customer_name ? (
          <div className="item-name">
            {isHotspot ? `Contact: ${premises.customer_name}` : premises.customer_name}
          </div>
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

      <div className="section-label">
        {isHotspot ? `Currently installed · ${routers.length}` : 'Currently installed'}
      </div>
      {current.isPending ? (
        <LoadingRows rows={2} />
      ) : current.isError ? (
        <ErrorState error={current.error} onRetry={current.refetch} />
      ) : routers.length === 0 ? (
        <EmptyState title="No active router at this address">
          Nothing is installed here right now. A field tech can install one from the mobile app.
        </EmptyState>
      ) : (
        <>
          {/* A hotspot can carry several, so one card per router. A PPPoE
            * premises only ever shows the one. */}
          {routers.map((router) => (
            <div className="card" key={router.installation_id}>
              <div
                className="card flat"
                style={{ border: 'none', padding: 0, margin: 0, background: 'transparent' }}
              >
                <div>
                  <div className="item-name">{router.item_name}</div>
                  <div className="item-meta">
                    {router.serial_number}
                    {router.mac_address ? ` · ${router.mac_address}` : ''}
                  </div>
                  <div className="item-meta">
                    Installed {formatDate(router.installed_at)} by {router.installed_by_name}
                  </div>
                  <ServicesSummary services={router.services} />
                </div>
                <Badge variant="installed">Active</Badge>
              </div>
              {canRecordWork ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingServices(router)}
                >
                  {router.services?.length ? 'Edit recorded work' : 'Record work performed'}
                </button>
              ) : null}
            </div>
          ))}
        </>
      )}

      {editingServices ? (
        <EditServicesDialog
          installationId={editingServices.installation_id}
          premisesId={premisesId}
          current={editingServices.services}
          onClose={() => setEditingServices(null)}
        />
      ) : null}

      {editingPremises ? (
        <PremisesFormDialog premises={premises} onClose={() => setEditingPremises(false)} />
      ) : null}
      {deleting ? (
        <DeletePremisesDialog
          premises={premises}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate('/premises')}
        />
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
