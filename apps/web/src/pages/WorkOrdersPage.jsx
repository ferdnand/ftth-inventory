import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  useCreateWorkOrder,
  useDeleteWorkOrder,
  usePremisesList,
  usePremisesSearch,
  useSites,
  useUpdateWorkOrder,
  useUsers,
  useWorkOrders,
} from '../hooks/useData';
import { useDebounced } from '../hooks/useDebounced';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RowMenu } from '../components/RowMenu';
import { DateInput, Select, TextArea } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { formatDate, formatPremisesCode } from '../lib/format';
import { formatMoney } from '../lib/money';
import { WORK_ORDER_STATUSES, WORK_ORDER_TYPES, label } from '../lib/constants';

// Premises combobox, scoped to the site the job is at. Before anything is typed
// it lists that site's premises, because most compounds out here have no
// address anybody would think to search for; typing narrows within the site.
function PremisesPicker({ siteId, value, onChange, error }) {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 300);
  const searching = debounced.trim().length >= 2;

  const search = usePremisesSearch(debounced, siteId);
  const browse = usePremisesList({ site_id: siteId, limit: 100 }, { enabled: Boolean(siteId) });

  if (value) {
    return (
      <div className="field">
        <label>Premises</label>
        <div className="result-item selected" style={{ cursor: 'default' }}>
          <div className="addr">{value.label}</div>
          <div className="id">{formatPremisesCode(value.id)}</div>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  if (!siteId) {
    return (
      <div className="field">
        <label>Premises</label>
        <div className="hint">Choose the site first — the premises list is filtered to it.</div>
        {error ? <div className="error">{error}</div> : null}
      </div>
    );
  }

  const query = searching ? search : browse;
  const rows = query.data ?? [];

  return (
    <div className="field">
      <label htmlFor="premises-search">Premises at this site</label>
      <input
        id="premises-search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Filter by name, village, landmark, phone or account"
      />
      {error ? <div className="error">{error}</div> : null}
      {query.isPending ? (
        <div className="hint">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="hint">
          {searching
            ? 'No matches at this site. '
            : 'No premises are recorded at this site yet. '}
          Add the premises under Premises first, or let the tech capture it in the field app when
          they get there.
        </div>
      ) : (
        <div style={{ marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
          {rows.map((row) => (
            <div className="result-item" key={row.id} onClick={() => onChange(row)}>
              <div className="addr">{row.label}</div>
              <div className="id">{formatPremisesCode(row.id)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkOrderFormDialog({ onClose }) {
  const create = useCreateWorkOrder();
  const techs = useUsers({ role: 'field_tech', is_active: true });
  const { notify, notifyError } = useToast();
  const navigate = useNavigate();

  const sites = useSites();
  const [siteId, setSiteId] = useState('');
  const [premises, setPremises] = useState(null);
  const [type, setType] = useState('new_install');
  const [techId, setTechId] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    if (!siteId) {
      setError('Choose a site');
      return;
    }
    if (!premises) {
      setError('Choose a premises');
      return;
    }
    try {
      const { work_order: created } = await create.mutateAsync({
        site_id: Number(siteId),
        customer_premises_id: premises.id,
        type,
        assigned_tech_id: techId ? Number(techId) : undefined,
        scheduled_date: scheduled || undefined,
        notes: notes.trim() || undefined,
      });
      notify(`Job #${created.id} created`);
      navigate(`/work-orders/${created.id}`);
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title="New work order"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="wo-form" className="btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create job'}
          </button>
        </>
      }
    >
      <form id="wo-form" onSubmit={onSubmit}>
        <Select
          id="wo-site"
          label="Site"
          value={siteId}
          onChange={(v) => {
            setSiteId(v);
            // The premises list is per site, so one picked under the previous
            // site no longer applies.
            setPremises(null);
            setError(null);
          }}
          placeholder="Choose a site"
          options={(sites.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
        />
        <PremisesPicker
          siteId={siteId ? Number(siteId) : null}
          value={premises}
          onChange={setPremises}
          error={error}
        />
        <Select
          id="wo-type"
          label="Type"
          value={type}
          onChange={setType}
          options={WORK_ORDER_TYPES.map((t) => ({ value: t, label: label(t) }))}
        />
        <div className="field-row">
          <Select
            id="wo-tech"
            label="Assign to"
            value={techId}
            onChange={setTechId}
            placeholder="Unassigned"
            options={(techs.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
          />
          <DateInput id="wo-date" label="Scheduled" value={scheduled} onChange={setScheduled} />
        </div>
        <TextArea
          id="wo-notes"
          label="Notes"
          value={notes}
          onChange={setNotes}
          style={{ minHeight: 80 }}
        />
      </form>
    </Modal>
  );
}

// The dispatcher's fields: who, when, and the note. What the visit used and cost
// is edited on the job's own page, where the lines live.
function EditJobDialog({ job, onClose }) {
  const update = useUpdateWorkOrder();
  const techs = useUsers({ role: 'field_tech', is_active: true });
  const { notify, notifyError } = useToast();

  const [techId, setTechId] = useState(job.assigned_tech_id ? String(job.assigned_tech_id) : '');
  const [scheduled, setScheduled] = useState(job.scheduled_date ?? '');
  const [notes, setNotes] = useState(job.notes ?? '');

  async function onSubmit(event) {
    event.preventDefault();
    try {
      // null clears a field; leaving it out would keep the old value.
      await update.mutateAsync({
        id: job.id,
        assigned_tech_id: techId ? Number(techId) : null,
        scheduled_date: scheduled || null,
        notes: notes.trim() || null,
      });
      notify(`Job #${job.id} updated`);
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title={`Edit job #${job.id}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-job-form" className="btn-primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="edit-job-form" onSubmit={onSubmit}>
        <div className="field-row">
          <Select
            id="edit-job-tech"
            label="Assign to"
            value={techId}
            onChange={setTechId}
            placeholder="Unassigned"
            options={(techs.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
          />
          <DateInput id="edit-job-date" label="Scheduled" value={scheduled} onChange={setScheduled} />
        </div>
        <TextArea
          id="edit-job-notes"
          label="Notes"
          value={notes}
          onChange={setNotes}
          style={{ minHeight: 80 }}
        />
      </form>
    </Modal>
  );
}

function DeleteJobDialog({ job, onClose }) {
  const remove = useDeleteWorkOrder();
  const { notify, notifyError } = useToast();

  async function onConfirm() {
    try {
      await remove.mutateAsync(job.id);
      notify(`Job #${job.id} deleted`);
    } catch (err) {
      // A 409 means work was recorded against it; its message says to cancel.
      notifyError(err);
    }
    onClose();
  }

  return (
    <ConfirmDialog
      title={`Delete job #${job.id}?`}
      confirmLabel="Delete permanently"
      pendingLabel="Deleting…"
      pending={remove.isPending}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        This removes the job for good and cannot be undone. It only works for a job dispatched
        by mistake — one with no fitted unit, no stock drawn, and no labour or expenses recorded.
      </p>
      <p>
        Otherwise use <strong>Cancel job</strong>: the record stays, but it stops counting.
      </p>
    </ConfirmDialog>
  );
}

export function WorkOrdersPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const canEdit = hasRole('warehouse_staff', 'pm');
  const canDelete = hasRole('admin');
  const update = useUpdateWorkOrder();
  const { notify, notifyError } = useToast();
  const [status, setStatus] = useState(null);
  const [siteFilter, setSiteFilter] = useState(null);
  const sites = useSites();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // Completed and cancelled are terminal in the API, so only a job still in
  // play can be cancelled.
  async function cancelJob(row) {
    try {
      await update.mutateAsync({ id: row.id, status: 'cancelled' });
      notify(`Job #${row.id} cancelled`);
    } catch (err) {
      notifyError(err);
    }
  }
  // with_costs is opt-in because the roll-up is four aggregates per job; this
  // list is the one place a manager wants them, so it asks.
  const workOrders = useWorkOrders({
    with_costs: 'true',
    ...(status ? { status } : {}),
    ...(siteFilter ? { site_id: siteFilter } : {}),
  });

  const columns = [
    { key: 'id', header: 'Job', numeric: true, render: (row) => `#${row.id}` },
    {
      key: 'label',
      header: 'Premises',
      render: (row) => (
        <>
          <div className="item-name">{row.label}</div>
          <div className="item-meta">{formatPremisesCode(row.customer_premises_id)}</div>
        </>
      ),
    },
    { key: 'site_name', header: 'Site', render: (row) => row.site_name ?? '—' },
    { key: 'type', header: 'Type', render: (row) => label(row.type) },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
    { key: 'assigned_tech_name', header: 'Tech', render: (row) => row.assigned_tech_name ?? '—' },
    {
      key: 'performed_on',
      header: 'Work done',
      render: (row) => formatDate(row.performed_on ?? row.scheduled_date),
    },
    {
      key: 'cost',
      header: 'Cost',
      numeric: true,
      render: (row) => formatMoney(row.costs?.total),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <RowMenu
          label={`Actions for job #${row.id}`}
          items={[
            { label: 'Open', onSelect: () => navigate(`/work-orders/${row.id}`) },
            { label: 'Edit details', hidden: !canEdit, onSelect: () => setEditing(row) },
            {
              label: 'Cancel job',
              hidden: !canEdit || !['open', 'in_progress'].includes(row.status),
              disabled: update.isPending,
              onSelect: () => cancelJob(row),
            },
            { label: 'Delete…', danger: true, hidden: !canDelete, onSelect: () => setDeleting(row) },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations"
        title="Jobs"
        sub="One row per visit. Dispatch one here, or read back what a tech recorded in the field"
        actions={
          hasRole('warehouse_staff', 'pm') ? (
            <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
              Dispatch a job
            </button>
          ) : null
        }
      />

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${siteFilter === null ? 'active' : ''}`.trim()}
          onClick={() => setSiteFilter(null)}
        >
          All sites
        </button>
        {(sites.data ?? []).map((site) => (
          <button
            key={site.id}
            type="button"
            className={`chip ${siteFilter === site.id ? 'active' : ''}`.trim()}
            onClick={() => setSiteFilter(site.id)}
          >
            {site.name}
          </button>
        ))}
      </div>

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${status === null ? 'active' : ''}`.trim()}
          onClick={() => setStatus(null)}
        >
          All
        </button>
        {WORK_ORDER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip ${status === s ? 'active' : ''}`.trim()}
            onClick={() => setStatus(s)}
          >
            {label(s)}
          </button>
        ))}
      </div>

      {workOrders.isPending ? (
        <LoadingRows />
      ) : workOrders.isError ? (
        <ErrorState error={workOrders.error} onRetry={workOrders.refetch} />
      ) : (
        <DataTable
          columns={columns}
          rows={workOrders.data}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/work-orders/${row.id}`)}
          empty={
            <EmptyState title="No work orders">
              {status ? (
                <>
                  Nothing with status {label(status)}.{' '}
                  <button type="button" className="chip" onClick={() => setStatus(null)}>
                    Show all
                  </button>
                </>
              ) : (
                <>
                  Create one to schedule a job, or head to{' '}
                  <Link to="/premises">Premises</Link> to work without one.
                </>
              )}
            </EmptyState>
          }
        />
      )}

      {showForm ? <WorkOrderFormDialog onClose={() => setShowForm(false)} /> : null}
      {editing ? <EditJobDialog job={editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <DeleteJobDialog job={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

export { PremisesPicker };
