import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCreateTransaction, useLocations, useStock, useWorkOrders } from '../hooks/useData';
import { NumberInput, Select, TextInput } from '../components/fields';
import { Badge } from '../components/Badge';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { newIdempotencyKey } from '../lib/api';
import { groupSerialized } from '../lib/groupSerialized';
import { label } from '../lib/constants';

// Only the movements a warehouse operator actually initiates from here. A
// 'receive' has its own page, and 'install' is not accepted by this endpoint at
// all — an install has to go through /api/installations.
const MOVEMENTS = [
  { value: 'transfer', label: 'Transfer — between two locations' },
  { value: 'issue', label: 'Issue — out to a job (no destination)' },
  { value: 'return', label: 'Return — back into stock' },
  { value: 'faulty', label: 'Faulty — flag a unit as broken' },
];

function BulkTransfer({ locations, workOrders, initialFrom }) {
  const create = useCreateTransaction();
  const { notify, notifyError } = useToast();

  const [type, setType] = useState('transfer');
  const [fromId, setFromId] = useState(initialFrom ?? '');
  const [toId, setToId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [notes, setNotes] = useState('');

  const sourceStock = useStock(fromId ? Number(fromId) : null);
  const bulkRows = sourceStock.data?.bulk ?? [];
  const row = bulkRows.find((r) => String(r.item_id) === itemId);

  const needsDestination = type === 'transfer' || type === 'return';
  const amount = Number(quantity);
  const overdrawn = row && amount > row.quantity;

  const ready =
    fromId &&
    itemId &&
    amount > 0 &&
    !overdrawn &&
    (!needsDestination || (toId && toId !== fromId));

  async function onSubmit(event) {
    event.preventDefault();
    try {
      await create.mutateAsync({
        item_id: Number(itemId),
        quantity: amount,
        from_location_id: Number(fromId),
        to_location_id: needsDestination ? Number(toId) : undefined,
        type,
        work_order_id: workOrderId ? Number(workOrderId) : undefined,
        notes: notes.trim() || undefined,
        idempotency_key: newIdempotencyKey(),
      });
      notify(`Moved ${amount} ${row?.unit_of_measure ?? ''} of ${row?.item_name ?? 'stock'}`);
      setQuantity('');
      setNotes('');
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      <Select id="type" label="Movement" value={type} onChange={setType} options={MOVEMENTS} />

      <div className="field-row">
        <Select
          id="from"
          label="Out of"
          value={fromId}
          onChange={(v) => {
            setFromId(v);
            setItemId('');
          }}
          placeholder="Choose a source"
          options={locations.map((l) => ({ value: String(l.id), label: l.name }))}
        />
        {needsDestination ? (
          <Select
            id="to"
            label="Into"
            value={toId}
            onChange={setToId}
            placeholder="Choose a destination"
            options={locations
              .filter((l) => String(l.id) !== fromId)
              .map((l) => ({ value: String(l.id), label: l.name }))}
          />
        ) : null}
      </div>

      {!fromId ? (
        <div className="hint">Choose a source location to see what it holds.</div>
      ) : sourceStock.isPending ? (
        <LoadingRows rows={2} />
      ) : bulkRows.length === 0 ? (
        <EmptyState title="That location holds no bulk stock" />
      ) : (
        <>
          <Select
            id="item"
            label="Item"
            value={itemId}
            onChange={setItemId}
            placeholder="Choose an item"
            options={bulkRows.map((r) => ({
              value: String(r.item_id),
              label: `${r.item_name} — ${r.quantity} ${r.unit_of_measure} on hand`,
            }))}
          />

          <NumberInput
            id="quantity"
            label={`Quantity${row ? ` (${row.unit_of_measure})` : ''}`}
            value={quantity}
            onChange={setQuantity}
            min="0"
            step="any"
            max={row ? String(row.quantity) : undefined}
            error={overdrawn ? `Only ${row.quantity} ${row.unit_of_measure} on hand` : undefined}
            hint={
              row && amount > 0 && !overdrawn
                ? `${row.item_name}: ${row.quantity} → ${row.quantity - amount} ${row.unit_of_measure}`
                : undefined
            }
          />
        </>
      )}

      <Select
        id="work_order"
        label="Work order (optional)"
        value={workOrderId}
        onChange={setWorkOrderId}
        placeholder="Not linked to a job"
        options={workOrders.map((wo) => ({
          value: String(wo.id),
          label: `#${wo.id} · ${label(wo.type)} · ${wo.address}`,
        }))}
      />
      <TextInput id="notes" label="Notes" value={notes} onChange={setNotes} />

      <button type="submit" className="btn-primary" disabled={!ready || create.isPending}>
        {create.isPending ? 'Moving…' : 'Record movement'}
      </button>
    </form>
  );
}

function SerializedTransfer({ locations, initialFrom }) {
  const create = useCreateTransaction();
  const { notify, notifyError } = useToast();

  const [type, setType] = useState('transfer');
  const [fromId, setFromId] = useState(initialFrom ?? '');
  const [toId, setToId] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [results, setResults] = useState(null);

  const sourceStock = useStock(fromId ? Number(fromId) : null);
  const groups = useMemo(() => groupSerialized(sourceStock.data?.serialized ?? []), [
    sourceStock.data,
  ]);

  const term = filter.trim().toLowerCase();
  const visible = groups
    .map((g) => ({
      ...g,
      units: g.units.filter(
        (u) => !term || u.serial_number.toLowerCase().includes(term)
      ),
    }))
    .filter((g) => g.units.length > 0);

  const needsDestination = type !== 'faulty';
  const ready = fromId && selected.size > 0 && (!needsDestination || (toId && toId !== fromId));

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // One request per unit: the API moves one instance at a time. Reporting per
  // row rather than aborting on the first failure means a bad serial does not
  // hide the twelve that worked.
  async function onSubmit(event) {
    event.preventDefault();
    const ids = [...selected];
    const outcomes = [];

    for (const id of ids) {
      const unit = sourceStock.data.serialized.find((u) => u.id === id);
      try {
        await create.mutateAsync({
          item_instance_id: id,
          from_location_id: Number(fromId),
          to_location_id: needsDestination ? Number(toId) : undefined,
          type,
          idempotency_key: newIdempotencyKey(),
        });
        outcomes.push({ serial: unit?.serial_number ?? id, ok: true });
      } catch (err) {
        outcomes.push({ serial: unit?.serial_number ?? id, ok: false, message: err.message });
      }
    }

    setResults(outcomes);
    setSelected(new Set());

    const moved = outcomes.filter((o) => o.ok).length;
    if (moved > 0) notify(`Moved ${moved} of ${ids.length} unit${ids.length === 1 ? '' : 's'}`);
    if (moved < ids.length) notifyError(`${ids.length - moved} unit(s) could not be moved`);
  }

  return (
    <form className="form-card" onSubmit={onSubmit} style={{ maxWidth: 720 }}>
      <Select id="s-type" label="Movement" value={type} onChange={setType} options={MOVEMENTS} />

      <div className="field-row">
        <Select
          id="s-from"
          label="Out of"
          value={fromId}
          onChange={(v) => {
            setFromId(v);
            setSelected(new Set());
          }}
          placeholder="Choose a source"
          options={locations.map((l) => ({ value: String(l.id), label: l.name }))}
        />
        {needsDestination ? (
          <Select
            id="s-to"
            label="Into"
            value={toId}
            onChange={setToId}
            placeholder="Choose a destination"
            options={locations
              .filter((l) => String(l.id) !== fromId)
              .map((l) => ({ value: String(l.id), label: l.name }))}
          />
        ) : null}
      </div>

      {!fromId ? (
        <div className="hint">Choose a source location to pick units.</div>
      ) : sourceStock.isPending ? (
        <LoadingRows rows={3} />
      ) : groups.length === 0 ? (
        <EmptyState title="That location holds no serialized units" />
      ) : (
        <>
          <div className="premise-search">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by serial number"
              aria-label="Filter by serial number"
            />
          </div>

          {visible.map((group) => (
            <div className="card" key={group.item_id}>
              <div className="item-name">{group.item_name}</div>
              <div className="item-meta">
                {[group.manufacturer, group.model].filter(Boolean).join(' ') || group.category}
              </div>
              <div style={{ marginTop: 8 }}>
                {group.units.map((unit) => (
                  <label className="serial-row" key={unit.id} style={{ cursor: 'pointer' }}>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(unit.id)}
                        onChange={() => toggle(unit.id)}
                        style={{ width: 16, height: 16 }}
                      />
                      <span>
                        <span className="s-id">{unit.serial_number}</span>
                        <span className="s-status">{unit.mac_address ?? 'no MAC recorded'}</span>
                      </span>
                    </span>
                    <Badge value={unit.status} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {results ? (
        <>
          <div className="section-label">Result</div>
          <div className="table-wrap" style={{ marginBottom: 14 }}>
            <table>
              <tbody>
                {results.map((r) => (
                  <tr key={r.serial}>
                    <td className="mono">{r.serial}</td>
                    <td>
                      {r.ok ? <Badge variant="ok">Moved</Badge> : <Badge variant="danger">Failed</Badge>}
                      {r.message ? (
                        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{r.message}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <button type="submit" className="btn-primary" disabled={!ready || create.isPending}>
        {create.isPending
          ? 'Moving…'
          : `Move ${selected.size || ''} unit${selected.size === 1 ? '' : 's'}`}
      </button>
    </form>
  );
}

export function TransferStockPage() {
  const [params] = useSearchParams();
  const locations = useLocations();
  const workOrders = useWorkOrders({ status: 'in_progress' });
  const [mode, setMode] = useState('bulk');

  if (locations.isPending) {
    return (
      <div className="page">
        <LoadingRows rows={4} />
      </div>
    );
  }
  if (locations.isError) {
    return (
      <div className="page">
        <ErrorState error={locations.error} onRetry={locations.refetch} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Stock"
        title="Transfer stock"
        sub="Move stock between locations, issue it to a job, or flag it faulty"
      />

      {/* Say this plainly rather than implying the preview is a guarantee: the
        * balance shown while typing is a client-side check. The API takes a row
        * lock and refuses an overdraw, which is the actual protection. */}
      <div className="banner info">
        The running balance below is a convenience. The API takes a row lock and refuses any
        movement that would leave stock negative, so a race between two operators cannot overdraw.
      </div>

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${mode === 'bulk' ? 'active' : ''}`.trim()}
          onClick={() => setMode('bulk')}
        >
          Bulk (by quantity)
        </button>
        <button
          type="button"
          className={`chip ${mode === 'serialized' ? 'active' : ''}`.trim()}
          onClick={() => setMode('serialized')}
        >
          Serialized (pick units)
        </button>
      </div>

      {mode === 'bulk' ? (
        <BulkTransfer
          locations={locations.data}
          workOrders={workOrders.data ?? []}
          initialFrom={params.get('from') ?? ''}
        />
      ) : (
        <SerializedTransfer locations={locations.data} initialFrom={params.get('from') ?? ''} />
      )}
    </div>
  );
}
