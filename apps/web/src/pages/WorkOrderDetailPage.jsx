import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  useTransactions,
  useUpdateWorkOrder,
  useUsers,
  useWorkOrder,
} from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Select } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { formatDate, formatDateTime, formatPremisesCode } from '../lib/format';
import { label } from '../lib/constants';

// Mirrors STATUS_TRANSITIONS in the API. A completed or cancelled job is
// terminal — reopening one would make completed_at meaningless.
const NEXT_STATUSES = {
  open: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'open'],
  completed: [],
  cancelled: [],
};

export function WorkOrderDetailPage() {
  const { id } = useParams();
  const workOrderId = Number(id);
  const { hasRole } = useAuth();

  const workOrder = useWorkOrder(workOrderId);
  const parts = useTransactions({ work_order_id: workOrderId });
  const techs = useUsers({ role: 'field_tech', is_active: true });
  const update = useUpdateWorkOrder();
  const { notify, notifyError } = useToast();

  async function setStatus(status) {
    try {
      await update.mutateAsync({ id: workOrderId, status });
      notify(`Job #${workOrderId} is now ${label(status).toLowerCase()}`);
    } catch (err) {
      notifyError(err);
    }
  }

  async function reassign(techId) {
    try {
      await update.mutateAsync({
        id: workOrderId,
        assigned_tech_id: techId === '' ? null : Number(techId),
      });
      notify('Job reassigned');
    } catch (err) {
      notifyError(err);
    }
  }

  if (workOrder.isPending) {
    return (
      <div className="page">
        <LoadingRows rows={4} />
      </div>
    );
  }
  if (workOrder.isError) {
    return (
      <div className="page">
        <ErrorState error={workOrder.error} onRetry={workOrder.refetch} />
      </div>
    );
  }

  const wo = workOrder.data;
  const nextStatuses = NEXT_STATUSES[wo.status];

  const partColumns = [
    { key: 'type', header: 'Movement', render: (row) => label(row.type) },
    {
      key: 'item_name',
      header: 'Item',
      render: (row) => (
        <>
          <div className="item-name">{row.item_name}</div>
          <div className="item-meta">{row.serial_number ?? row.category}</div>
        </>
      ),
    },
    {
      key: 'quantity',
      header: 'Amount',
      numeric: true,
      render: (row) =>
        row.quantity !== null ? `${row.quantity} ${row.unit_of_measure}` : '1 unit',
    },
    { key: 'performed_by_name', header: 'By' },
    { key: 'created_at', header: 'When', render: (row) => formatDateTime(row.created_at) },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={`Job #${wo.id} · ${label(wo.type)}`}
        title={wo.address}
        sub={`${formatPremisesCode(wo.customer_premises_id)}${
          wo.customer_account_id ? ` · ${wo.customer_account_id}` : ''
        }`}
        actions={
          <Link className="btn-secondary" to={`/premises/${wo.customer_premises_id}`}>
            Site history
          </Link>
        }
      />

      <div className="stat-row">
        <div className="stat">
          <div className="num" style={{ fontSize: 16, paddingTop: 6 }}>
            <Badge value={wo.status} />
          </div>
          <div className="lbl">Status</div>
        </div>
        <div className="stat">
          <div className="num" style={{ fontSize: 15 }}>
            {wo.assigned_tech_name ?? '—'}
          </div>
          <div className="lbl">Assigned tech</div>
        </div>
        <div className="stat">
          <div className="num" style={{ fontSize: 15 }}>
            {formatDate(wo.scheduled_date)}
          </div>
          <div className="lbl">Scheduled</div>
        </div>
        <div className="stat">
          <div className="num" style={{ fontSize: 15 }}>
            {wo.completed_at ? formatDate(wo.completed_at) : '—'}
          </div>
          <div className="lbl">Completed</div>
        </div>
      </div>

      <div className="section-label">Progress</div>
      <div className="card">
        {nextStatuses.length === 0 ? (
          <div style={{ color: 'var(--text-2)', fontSize: 13 }}>
            This job is {label(wo.status).toLowerCase()} and cannot change status again.
          </div>
        ) : (
          <div className="stepper">
            {nextStatuses.map((status) => (
              <button
                key={status}
                type="button"
                className={status === 'cancelled' ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}
                onClick={() => setStatus(status)}
                disabled={update.isPending}
              >
                {status === 'open' ? 'Reopen' : `Mark ${label(status).toLowerCase()}`}
              </button>
            ))}
          </div>
        )}

        {hasRole('warehouse_staff', 'pm') ? (
          <div style={{ marginTop: 14, maxWidth: 320 }}>
            <Select
              id="reassign"
              label="Reassign"
              value={wo.assigned_tech_id ? String(wo.assigned_tech_id) : ''}
              onChange={reassign}
              placeholder="Unassigned"
              options={(techs.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
            />
          </div>
        ) : null}

        {wo.notes ? (
          <>
            <div className="divider" />
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{wo.notes}</div>
          </>
        ) : null}
      </div>

      <div className="section-label">Parts used on this job</div>
      {parts.isPending ? (
        <LoadingRows rows={3} />
      ) : parts.isError ? (
        <ErrorState error={parts.error} onRetry={parts.refetch} />
      ) : (
        <DataTable
          columns={partColumns}
          rows={parts.data}
          rowKey={(row) => row.id}
          empty={
            <EmptyState title="No stock linked to this job">
              Movements only appear here if they were recorded against this work order — the link is
              always optional.
            </EmptyState>
          }
        />
      )}
    </div>
  );
}
