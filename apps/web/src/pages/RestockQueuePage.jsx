import { useState } from 'react';
import { useRestockRequests, useStock, useUpdateRestockRequest } from '../hooks/useData';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { NumberInput, TextArea } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { formatDateTime, formatRelative } from '../lib/format';
import { RESTOCK_STATUSES, label } from '../lib/constants';

// Fulfilment is where the stock actually moves: one applyMove per line plus a
// transfer transaction each, all inside one database transaction. If the
// warehouse cannot cover a line, the whole fulfilment is refused — hence the
// per-line override for "we only had 120 of the 200 they asked for".
function FulfilDialog({ request, onClose }) {
  const update = useUpdateRestockRequest();
  const warehouseStock = useStock(request.from_location_id);
  const { notify, notifyError } = useToast();

  const [amounts, setAmounts] = useState(() =>
    Object.fromEntries(request.lines.map((l) => [l.item_id, String(l.quantity_requested)]))
  );
  const [notes, setNotes] = useState('');

  const onHand = new Map((warehouseStock.data?.bulk ?? []).map((r) => [r.item_id, r.quantity]));

  const problems = request.lines
    .map((line) => {
      const wanted = Number(amounts[line.item_id] ?? 0);
      const available = onHand.get(line.item_id) ?? 0;
      return wanted > available
        ? `${line.item_name}: only ${available} ${line.unit_of_measure} on hand`
        : null;
    })
    .filter(Boolean);

  async function onSubmit(event) {
    event.preventDefault();
    try {
      await update.mutateAsync({
        id: request.id,
        status: 'fulfilled',
        resolution_notes: notes.trim() || undefined,
        fulfilments: request.lines.map((line) => ({
          item_id: line.item_id,
          quantity_fulfilled: Number(amounts[line.item_id] ?? 0),
        })),
      });
      notify(`Request #${request.id} fulfilled`);
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title={`Fulfil request #${request.id}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="fulfil-form"
            className="btn-primary"
            disabled={update.isPending || problems.length > 0}
          >
            {update.isPending ? 'Transferring…' : 'Fulfil and transfer'}
          </button>
        </>
      }
    >
      <form id="fulfil-form" onSubmit={onSubmit}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
          {request.requesting_user_name} asked for stock from{' '}
          <strong>{request.from_location_name}</strong> into{' '}
          <strong>{request.to_location_name}</strong>.
        </p>

        {warehouseStock.isPending ? <LoadingRows rows={2} /> : null}

        {problems.length > 0 ? (
          <div className="banner" role="alert">
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
            Lower the amount to what you can actually send — a fulfilment that overdraws is
            refused as a whole.
          </div>
        ) : null}

        {request.lines.map((line) => (
          <NumberInput
            key={line.item_id}
            id={`line-${line.item_id}`}
            label={`${line.item_name} (${line.unit_of_measure})`}
            value={amounts[line.item_id]}
            onChange={(value) => setAmounts((a) => ({ ...a, [line.item_id]: value }))}
            min="0"
            step="any"
            hint={`Asked for ${line.quantity_requested} · ${
              onHand.get(line.item_id) ?? 0
            } on hand at ${request.from_location_name}`}
          />
        ))}

        <TextArea
          id="resolution"
          label="Note back to the tech"
          value={notes}
          onChange={setNotes}
          style={{ minHeight: 70 }}
        />
      </form>
    </Modal>
  );
}

export function RestockQueuePage() {
  const [status, setStatus] = useState('requested');
  const requests = useRestockRequests(status ? { status } : undefined);
  const update = useUpdateRestockRequest();
  const { notify, notifyError } = useToast();
  const [fulfilling, setFulfilling] = useState(null);

  async function setRequestStatus(id, next) {
    try {
      await update.mutateAsync({ id, status: next });
      notify(`Request #${id} ${label(next).toLowerCase()}`);
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Stock"
        title="Restock queue"
        sub="Field techs ask for stock here; fulfilling a request is what moves it"
      />

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${status === null ? 'active' : ''}`.trim()}
          onClick={() => setStatus(null)}
        >
          All
        </button>
        {RESTOCK_STATUSES.map((s) => (
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

      {requests.isPending ? (
        <LoadingRows rows={4} />
      ) : requests.isError ? (
        <ErrorState error={requests.error} onRetry={requests.refetch} />
      ) : requests.data.length === 0 ? (
        <EmptyState title="Nothing in the queue">
          {status === 'requested'
            ? 'No open restock requests. Techs raise these from the field app.'
            : `No requests with status ${label(status ?? '').toLowerCase()}.`}
        </EmptyState>
      ) : (
        requests.data.map((request) => (
          <div className="card" key={request.id}>
            <div
              className="card flat"
              style={{ border: 'none', padding: 0, margin: 0, background: 'transparent' }}
            >
              <div>
                <div className="item-name">
                  #{request.id} · {request.requesting_user_name}{' '}
                  <Badge value={request.status} />
                </div>
                <div className="item-meta">
                  {request.from_location_name} → {request.to_location_name} ·{' '}
                  {formatRelative(request.created_at)}
                </div>
                {request.notes ? (
                  <div style={{ fontSize: 13, marginTop: 6 }}>“{request.notes}”</div>
                ) : null}
              </div>
              {['requested', 'approved'].includes(request.status) ? (
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => setFulfilling(request)}
                  >
                    Fulfil
                  </button>
                  {request.status === 'requested' ? (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setRequestStatus(request.id, 'approved')}
                    >
                      Approve
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => setRequestStatus(request.id, 'rejected')}
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <div className="item-meta">
                  {request.resolved_by_name
                    ? `${label(request.status)} by ${request.resolved_by_name} · ${formatDateTime(
                        request.resolved_at
                      )}`
                    : label(request.status)}
                </div>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              {request.lines.map((line) => (
                <div className="serial-row" key={line.id}>
                  <div>
                    <div className="s-id">{line.item_name}</div>
                    <div className="s-status">{line.category}</div>
                  </div>
                  <div className="qty" style={{ fontSize: 15 }}>
                    {line.quantity_fulfilled !== null
                      ? `${line.quantity_fulfilled} / ${line.quantity_requested}`
                      : line.quantity_requested}
                    <span className="unit">{line.unit_of_measure}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {fulfilling ? (
        <FulfilDialog request={fulfilling} onClose={() => setFulfilling(null)} />
      ) : null}
    </div>
  );
}
