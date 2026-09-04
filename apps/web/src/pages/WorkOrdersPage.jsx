import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  useCreateWorkOrder,
  usePremisesSearch,
  useUsers,
  useWorkOrders,
} from '../hooks/useData';
import { useDebounced } from '../hooks/useDebounced';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { DateInput, Select, TextArea } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { formatDate, formatPremisesCode } from '../lib/format';
import { WORK_ORDER_STATUSES, WORK_ORDER_TYPES, label } from '../lib/constants';

// Debounced combobox over /premises/search. Extracted because both the work
// order form and the restock queue need it.
function PremisesPicker({ value, onChange, error }) {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 300);
  const search = usePremisesSearch(debounced);
  const tooShort = debounced.trim().length < 2;

  if (value) {
    return (
      <div className="field">
        <label>Premises</label>
        <div className="result-item selected" style={{ cursor: 'default' }}>
          <div className="addr">{value.address}</div>
          <div className="id">{formatPremisesCode(value.id)}</div>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor="premises-search">Premises</label>
      <input
        id="premises-search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search by address or account"
      />
      {error ? <div className="error">{error}</div> : null}
      {tooShort ? (
        <div className="hint">Type at least 2 characters.</div>
      ) : search.isPending ? (
        <div className="hint">Searching…</div>
      ) : search.data.length === 0 ? (
        <div className="hint">No matches. Add the address under Premises first.</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {search.data.slice(0, 6).map((row) => (
            <div className="result-item" key={row.id} onClick={() => onChange(row)}>
              <div className="addr">{row.address}</div>
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

  const [premises, setPremises] = useState(null);
  const [type, setType] = useState('new_install');
  const [techId, setTechId] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    if (!premises) {
      setError('Choose a premises');
      return;
    }
    try {
      const { work_order: created } = await create.mutateAsync({
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
        <PremisesPicker value={premises} onChange={setPremises} error={error} />
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

export function WorkOrdersPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const workOrders = useWorkOrders(status ? { status } : undefined);

  const columns = [
    { key: 'id', header: 'Job', numeric: true, render: (row) => `#${row.id}` },
    {
      key: 'address',
      header: 'Premises',
      render: (row) => (
        <>
          <div className="item-name">{row.address}</div>
          <div className="item-meta">{formatPremisesCode(row.customer_premises_id)}</div>
        </>
      ),
    },
    { key: 'type', header: 'Type', render: (row) => label(row.type) },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
    { key: 'assigned_tech_name', header: 'Tech', render: (row) => row.assigned_tech_name ?? '—' },
    { key: 'scheduled_date', header: 'Scheduled', render: (row) => formatDate(row.scheduled_date) },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations"
        title="Work orders"
        sub="Jobs are an optional layer — an install does not need one"
        actions={
          hasRole('warehouse_staff', 'pm') ? (
            <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
              New work order
            </button>
          ) : null
        }
      />

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
    </div>
  );
}

export { PremisesPicker };
