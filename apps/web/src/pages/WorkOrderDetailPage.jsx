import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTransactions, useUpdateWorkOrder, useUsers, useWorkOrder } from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { DateInput, Select } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import {
  EditJobExpensesDialog,
  EditJobMaterialsDialog,
  EditJobServicesDialog,
  JobCostCard,
} from '../components/JobLines';
import { formatDate, formatDateTime, formatPremisesCode, formatQuantity } from '../lib/format';
import { formatMoney } from '../lib/money';
import { label } from '../lib/constants';

// Mirrors STATUS_TRANSITIONS in the API. A completed or cancelled job is
// terminal — reopening one would make completed_at meaningless.
const NEXT_STATUSES = {
  open: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'open'],
  completed: [],
  cancelled: [],
};

// One job, and everything it produced: the unit fitted, the materials, the
// labour, the money, and what it all came to.
//
// The dashboard cannot open a job — jobs happen in the field — so everything
// here is either progressing one or correcting it. The three dialogs are the
// back office for a phone: a cable length typed wrong, a fare remembered on the
// drive home, a price nobody had set on the day.
export function WorkOrderDetailPage() {
  const { id } = useParams();
  const workOrderId = Number(id);
  const { hasRole } = useAuth();

  const workOrder = useWorkOrder(workOrderId);
  const parts = useTransactions({ work_order_id: workOrderId });
  const techs = useUsers({ role: 'field_tech', is_active: true });
  const update = useUpdateWorkOrder();
  const { notify, notifyError } = useToast();

  const [editing, setEditing] = useState(null);

  async function patch(body, message) {
    try {
      await update.mutateAsync({ id: workOrderId, ...body });
      notify(message);
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
  const premises = wo.premises ?? {};
  const nextStatuses = NEXT_STATUSES[wo.status];
  const materials = wo.materials ?? [];
  const services = wo.services ?? [];
  const expenses = wo.expenses ?? [];
  const canEdit = hasRole('warehouse_staff', 'pm');

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
        title={wo.label}
        sub={[
          formatPremisesCode(wo.customer_premises_id),
          wo.site_name,
          premises.customer_name,
          premises.customer_phone,
        ]
          .filter(Boolean)
          .join(' · ')}
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
        {/* The day the work was DONE, which is the figure every cost report
          * windows on — not the day it reached the server. */}
        <div className="stat">
          <div className="num" style={{ fontSize: 15 }}>
            {formatDate(wo.performed_on)}
          </div>
          <div className="lbl">Work done</div>
        </div>
        <div className="stat">
          <div className="num" style={{ fontSize: 15 }}>
            {formatMoney(wo.costs?.total)}
          </div>
          <div className="lbl">Job cost</div>
        </div>
      </div>

      {/* --- Where ------------------------------------------------------- */}
      <div className="section-label">The premises</div>
      <div className="card">
        <div className="item-name">{premises.label ?? wo.label}</div>
        <div className="item-meta">
          {[label(premises.premises_type), premises.village, wo.site_name]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {premises.landmark ? <div className="item-meta">{premises.landmark}</div> : null}
        <div className="item-meta">
          {premises.gps_lat === null || premises.gps_lat === undefined
            ? 'No GPS pin — nobody can find this place from the record alone'
            : `Pin ${Number(premises.gps_lat).toFixed(5)}, ${Number(premises.gps_lng).toFixed(5)}` +
              (premises.gps_accuracy_m ? ` (±${premises.gps_accuracy_m} m)` : '')}
        </div>
      </div>

      {/* --- Progress ---------------------------------------------------- */}
      <div className="section-label">Progress</div>
      <div className="card">
        {nextStatuses.length === 0 ? (
          <div style={{ color: 'var(--text-2)', fontSize: 13 }}>
            This job is {label(wo.status).toLowerCase()} and cannot change status again. Its lines
            can still be corrected{wo.status === 'cancelled' ? ' — except on a cancelled job' : ''}.
          </div>
        ) : (
          <div className="stepper">
            {nextStatuses.map((status) => (
              <button
                key={status}
                type="button"
                className={status === 'cancelled' ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}
                onClick={() =>
                  patch({ status }, `Job #${workOrderId} is now ${label(status).toLowerCase()}`)
                }
                disabled={update.isPending}
              >
                {status === 'open' ? 'Reopen' : `Mark ${label(status).toLowerCase()}`}
              </button>
            ))}
          </div>
        )}

        {canEdit ? (
          <div className="field-row" style={{ marginTop: 14 }}>
            <Select
              id="reassign"
              label="Reassign"
              value={wo.assigned_tech_id ? String(wo.assigned_tech_id) : ''}
              onChange={(techId) =>
                patch(
                  { assigned_tech_id: techId === '' ? null : Number(techId) },
                  'Job reassigned'
                )
              }
              placeholder="Unassigned"
              options={(techs.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
            />
            {/* Correctable because the tech is often recording Friday's work on
              * Monday, and every cost report buckets on this date. */}
            <DateInput
              id="performed-on"
              label="Day the work was done"
              value={wo.performed_on ?? ''}
              onChange={(value) =>
                patch({ performed_on: value === '' ? null : value }, 'Work date updated')
              }
            />
            <DateInput
              id="scheduled"
              label="Scheduled for"
              value={wo.scheduled_date ?? ''}
              onChange={(value) =>
                patch({ scheduled_date: value === '' ? null : value }, 'Schedule updated')
              }
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

      {/* --- What was fitted --------------------------------------------- */}
      <div className="section-label">Hardware fitted</div>
      {(wo.installations ?? []).length === 0 ? (
        <EmptyState title="No router fitted on this job">
          A repair or a survey may not need one. Installs are recorded in the field.
        </EmptyState>
      ) : (
        <div className="card">
          {wo.installations.map((row) => (
            <div className="card flat" key={row.installation_id}>
              <div>
                <div className="item-name">{row.item_name}</div>
                <div className="item-meta">
                  {row.serial_number}
                  {row.mac_address ? ` · ${row.mac_address}` : ''}
                </div>
                <div className="item-meta">
                  Fitted {formatDate(row.installed_at)} by {row.installed_by_name}
                  {row.removed_at ? ` · removed ${formatDate(row.removed_at)}` : ''}
                </div>
              </div>
              <div className="num">{formatMoney(row.unit_cost)}</div>
            </div>
          ))}
        </div>
      )}

      {/* --- The three kinds of line ------------------------------------- */}
      <div className="section-label">Materials used</div>
      <div className="card">
        {materials.length === 0 ? (
          <div className="item-meta">Nothing recorded.</div>
        ) : (
          <table className="lines-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Amount</th>
                <th className="num">Unit cost</th>
                <th className="num">Line</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((line) => (
                <tr key={line.item_id}>
                  <td>
                    <div className="item-name">{line.name}</div>
                    {line.notes ? <div className="item-meta">{line.notes}</div> : null}
                  </td>
                  <td className="num">{formatQuantity(line.quantity, line.unit_of_measure)}</td>
                  <td className="num">{formatMoney(line.unit_cost)}</td>
                  <td className="num">{formatMoney(line.line_total)}</td>
                  <td className="item-meta">{line.from_location_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setEditing('materials')}
          >
            {materials.length === 0 ? 'Record materials' : 'Correct materials'}
          </button>
        ) : null}
      </div>

      <div className="section-label">Work performed</div>
      <div className="card">
        {services.length === 0 ? (
          <div className="item-meta">Nothing recorded.</div>
        ) : (
          <table className="lines-table">
            <thead>
              <tr>
                <th>Service</th>
                <th className="num">Amount</th>
                <th className="num">Rate</th>
                <th className="num">Line</th>
              </tr>
            </thead>
            <tbody>
              {services.map((line) => (
                <tr key={line.service_id}>
                  <td>
                    <div className="item-name">{line.name}</div>
                    {line.notes ? <div className="item-meta">{line.notes}</div> : null}
                  </td>
                  <td className="num">
                    {line.unit_of_measure === 'job'
                      ? '1 visit'
                      : formatQuantity(line.quantity, line.unit_of_measure)}
                  </td>
                  <td className="num">{formatMoney(line.unit_rate)}</td>
                  <td className="num">{formatMoney(line.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setEditing('services')}
          >
            {services.length === 0 ? 'Record work' : 'Correct work'}
          </button>
        ) : null}
      </div>

      <div className="section-label">Other costs</div>
      <div className="card">
        {expenses.length === 0 ? (
          <div className="item-meta">Nothing recorded.</div>
        ) : (
          <table className="lines-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>What for</th>
                <th className="num">Amount</th>
                <th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((line) => (
                <tr key={line.id}>
                  <td>{label(line.category)}</td>
                  <td className="item-meta">{line.description ?? '—'}</td>
                  <td className="num">{formatMoney(line.amount)}</td>
                  <td className="item-meta">{line.recorded_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setEditing('expenses')}
          >
            {expenses.length === 0 ? 'Record costs' : 'Correct costs'}
          </button>
        ) : null}
      </div>

      <div className="section-label">What the job cost</div>
      <JobCostCard costs={wo.costs} />

      {/* --- The audit trail --------------------------------------------- */}
      <div className="section-label">Stock movements behind this job</div>
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
              Recording materials or fitting a router writes rows here. A correction that puts
              stock back writes one too — the trail is append-only.
            </EmptyState>
          }
        />
      )}

      {editing === 'materials' ? (
        <EditJobMaterialsDialog
          jobId={workOrderId}
          siteId={wo.site_id}
          current={materials}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing === 'services' ? (
        <EditJobServicesDialog
          jobId={workOrderId}
          current={services}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editing === 'expenses' ? (
        <EditJobExpensesDialog
          jobId={workOrderId}
          current={expenses}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
