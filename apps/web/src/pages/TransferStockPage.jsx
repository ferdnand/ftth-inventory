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

let lineSeq = 0;
const newLine = () => ({ key: ++lineSeq, itemId: '', quantity: '', error: null });

// Several items in one go. Each line is its own request (the API moves one item
// at a time and takes a row lock per item), so a line that cannot be moved —
// say another operator just drew the stock down — stays on the form with its
// reason, while the lines that did move are cleared away.
function BulkTransfer({ locations, workOrders, initialFrom }) {
  const create = useCreateTransaction();
  const { notify, notifyError } = useToast();

  const [type, setType] = useState('transfer');
  const [fromId, setFromId] = useState(initialFrom ?? '');
  const [toId, setToId] = useState('');
  const [lines, setLines] = useState(() => [newLine()]);
  const [workOrderId, setWorkOrderId] = useState('');
  const [notes, setNotes] = useState('');

  const sourceStock = useStock(fromId ? Number(fromId) : null);
  const bulkRows = sourceStock.data?.bulk ?? [];
  const rowFor = (itemId) => bulkRows.find((r) => String(r.item_id) === itemId);

  const needsDestination = type === 'transfer' || type === 'return';

  const updateLine = (key, patch) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch, error: null } : line))
    );
  const removeLine = (key) =>
    setLines((current) =>
      current.length === 1 ? [newLine()] : current.filter((l) => l.key !== key)
    );

  // null when the line can be sent, otherwise why it cannot. 'incomplete' is the
  // quiet case — nothing to flag yet, the line just is not finished.
  const lineProblem = (line) => {
    const row = rowFor(line.itemId);
    const amount = Number(line.quantity);
    if (!row || !(amount > 0)) return 'incomplete';
    if (amount > row.quantity) return `Only ${row.quantity} ${row.unit_of_measure} on hand`;
    return null;
  };
  const filled = lines.filter((l) => l.itemId || l.quantity);
  const everyLineValid = filled.length > 0 && filled.every((l) => lineProblem(l) === null);
  const ready = fromId && everyLineValid && (!needsDestination || (toId && toId !== fromId));

  async function onSubmit(event) {
    event.preventDefault();
    const outcomes = [];

    for (const line of filled) {
      try {
        await create.mutateAsync({
          item_id: Number(line.itemId),
          quantity: Number(line.quantity),
          from_location_id: Number(fromId),
          to_location_id: needsDestination ? Number(toId) : undefined,
          type,
          work_order_id: workOrderId ? Number(workOrderId) : undefined,
          notes: notes.trim() || undefined,
          idempotency_key: newIdempotencyKey(),
        });
        outcomes.push({ key: line.key, ok: true });
      } catch (err) {
        outcomes.push({ key: line.key, ok: false, message: err.message });
      }
    }

    const moved = outcomes.filter((o) => o.ok).length;
    const failed = outcomes.filter((o) => !o.ok);

    // Keep only what still needs doing, each failed line carrying its reason.
    setLines((current) => {
      const kept = current
        .filter((l) => failed.some((f) => f.key === l.key))
        .map((l) => ({ ...l, error: failed.find((f) => f.key === l.key).message }));
      return kept.length > 0 ? kept : [newLine()];
    });

    if (moved > 0) notify(`Moved ${moved} item${moved === 1 ? '' : 's'}`);
    if (failed.length > 0) {
      notifyError(`${failed.length} item${failed.length === 1 ? '' : 's'} could not be moved`);
    } else {
      setNotes('');
    }
  }

  const chosenIds = new Set(lines.map((l) => l.itemId).filter(Boolean));

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
            setLines([newLine()]);
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
          <div className="section-label">Items to move</div>
          {lines.map((line, index) => {
            const row = rowFor(line.itemId);
            const amount = Number(line.quantity);
            const problem = lineProblem(line);
            const overdrawn = problem && problem !== 'incomplete';
            return (
              <div className="card flat" key={line.key}>
                <div className="field-row">
                  <Select
                    id={`item-${line.key}`}
                    label={index === 0 ? 'Item' : `Item ${index + 1}`}
                    value={line.itemId}
                    onChange={(v) => updateLine(line.key, { itemId: v })}
                    placeholder="Choose an item"
                    options={bulkRows
                      .filter(
                        (r) => String(r.item_id) === line.itemId || !chosenIds.has(String(r.item_id))
                      )
                      .map((r) => ({
                        value: String(r.item_id),
                        label: `${r.item_name} — ${r.quantity} ${r.unit_of_measure} on hand`,
                      }))}
                  />
                  <NumberInput
                    id={`quantity-${line.key}`}
                    label={`Quantity${row ? ` (${row.unit_of_measure})` : ''}`}
                    value={line.quantity}
                    onChange={(v) => updateLine(line.key, { quantity: v })}
                    min="0"
                    step="any"
                    max={row ? String(row.quantity) : undefined}
                    error={overdrawn ? problem : (line.error ?? undefined)}
                    hint={
                      row && amount > 0 && !overdrawn
                        ? `${row.item_name}: ${row.quantity} → ${row.quantity - amount} ${row.unit_of_measure}`
                        : undefined
                    }
                  />
                </div>
                {lines.length > 1 || line.itemId ? (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => removeLine(line.key)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            );
          })}

          {chosenIds.size < bulkRows.length ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              style={{ marginBottom: 14 }}
              onClick={() => setLines((current) => [...current, newLine()])}
            >
              + Add another item
            </button>
          ) : null}
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
          label: `#${wo.id} · ${label(wo.type)} · ${wo.label}`,
        }))}
      />
      <TextInput id="notes" label="Notes" value={notes} onChange={setNotes} />

      <button type="submit" className="btn-primary" disabled={!ready || create.isPending}>
        {create.isPending
          ? 'Moving…'
          : `Record movement${filled.length > 1 ? ` (${filled.length} items)` : ''}`}
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
