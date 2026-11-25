import { useState } from 'react';
import {
  useItems,
  useLocations,
  useServices,
  useSetJobExpenses,
  useSetJobMaterials,
  useSetJobServices,
  useStock,
} from '../hooks/useData';
import { Modal } from './Modal';
import { NumberInput, Select, TextInput } from './fields';
import { EmptyState, ErrorState, LoadingRows } from './states';
import { useToast } from './Toast';
import { formatAmount, formatMoney, parseAmount } from '../lib/money';
import { JOB_EXPENSE_CATEGORIES, label } from '../lib/constants';

// What a job used, did and cost — the back-office side of it.
//
// The dashboard never creates a job; jobs happen in the field. What it does is
// correct one: a cable length typed wrong on a phone, a fare the tech forgot,
// a price nobody had set when the work was done. Each dialog below sends the
// COMPLETE list, so re-submitting the same thing changes nothing.

// ------------------------------------------------------------------ costs ---

const BUCKETS = [
  ['Materials', 'materials_total'],
  ['Labour', 'labour_total'],
  ['Other costs', 'expenses_total'],
  ['Hardware', 'hardware_total'],
];

export function JobCostCard({ costs }) {
  if (!costs) return null;

  return (
    <div className="card">
      <table className="cost-table">
        <tbody>
          {BUCKETS.map(([text, key]) => (
            <tr key={key}>
              <th scope="row">{text}</th>
              <td className="num">{formatAmount(costs[key])}</td>
            </tr>
          ))}
          <tr className="total">
            <th scope="row">Total</th>
            <td className="num">{formatMoney(costs.total)}</td>
          </tr>
        </tbody>
      </table>

      {/* The honesty line. A total with unpriced lines behind it is a floor,
        * and a dashboard that shows it as the answer is worse than one that
        * shows nothing. */}
      {costs.unpriced_lines > 0 ? (
        <p className="warn-note">
          {costs.unpriced_lines} {costs.unpriced_lines === 1 ? 'line has' : 'lines have'} no price
          set, so the real total is higher. Set unit costs under Catalog.
        </p>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------- materials ---

export function EditJobMaterialsDialog({ jobId, siteId, current, onClose }) {
  const items = useItems();
  const locations = useLocations();
  const save = useSetJobMaterials();
  const { notify, notifyError } = useToast();

  const [lines, setLines] = useState(() =>
    Object.fromEntries(
      (current ?? []).map((line) => [
        line.item_id,
        { quantity: String(line.quantity), notes: line.notes ?? '' },
      ])
    )
  );

  // Where a NEW line comes out of: the job's own site unless someone picks
  // another. Existing lines keep the stock they were first drawn from, whoever
  // edits them, so this only matters when adding.
  const [fromLocationId, setFromLocationId] = useState(() =>
    String(siteId ?? (current ?? [])[0]?.from_location_id ?? '')
  );

  // What that source actually holds, so the list is "what is here to use" rather
  // than the whole catalog.
  const stock = useStock(fromLocationId ? Number(fromLocationId) : null);
  const onHand = Object.fromEntries((stock.data?.bulk ?? []).map((r) => [r.item_id, r.quantity]));

  const recorded = Object.fromEntries((current ?? []).map((l) => [l.item_id, l]));

  // Bulk only. A router is traced to the premises through an installation, and
  // the API refuses a serialized item here — counting one as a material would
  // double it in the cost total.
  const bulk = (items.data ?? []).filter(
    (item) =>
      item.tracking_type === 'bulk' && ((onHand[item.id] ?? 0) > 0 || recorded[item.id] !== undefined)
  );

  // The most a line may claim. A line already on the job gets back what it took
  // when it came from this same source — the API moves only the difference.
  // One drawn from somewhere else is not capped here; the API checks that one.
  const claimable = (item) => {
    const line = recorded[item.id];
    if (line && String(line.from_location_id) !== fromLocationId) return null;
    return (onHand[item.id] ?? 0) + (line ? Number(line.quantity) : 0);
  };

  const toggle = (item) =>
    setLines((prev) => {
      const next = { ...prev };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = { quantity: '', notes: '' };
      return next;
    });

  const edit = (id, key) => (value) =>
    setLines((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));

  const chosen = Object.entries(lines);
  const addingNew = chosen.some(([itemId]) => !recorded[Number(itemId)]);
  const itemById = Object.fromEntries((items.data ?? []).map((i) => [i.id, i]));
  const overdrawn = (itemId, line) => {
    const cap = itemById[itemId] ? claimable(itemById[itemId]) : null;
    return cap !== null && Number(line.quantity) > cap;
  };
  const everyQuantityGiven = chosen.every(([, line]) => Number(line.quantity) > 0);
  const nothingOverdrawn = chosen.every(([itemId, line]) => !overdrawn(Number(itemId), line));
  const ready =
    everyQuantityGiven && nothingOverdrawn && (!addingNew || fromLocationId !== '');

  const sourceName =
    (locations.data ?? []).find((l) => String(l.id) === fromLocationId)?.name ?? 'this location';

  async function onSubmit(event) {
    event.preventDefault();
    try {
      await save.mutateAsync({
        jobId,
        fromLocationId: fromLocationId === '' ? undefined : Number(fromLocationId),
        materials: chosen.map(([itemId, line]) => ({
          item_id: Number(itemId),
          quantity: Number(line.quantity),
          notes: line.notes.trim() || undefined,
        })),
      });
      notify('Materials updated, and the stock moved with them');
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title="Materials used on this job"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="materials-form"
            className="btn-primary"
            disabled={save.isPending || !ready}
          >
            {save.isPending ? 'Saving…' : 'Save materials'}
          </button>
        </>
      }
    >
      {items.isPending || locations.isPending ? (
        <LoadingRows rows={3} />
      ) : items.isError ? (
        <ErrorState error={items.error} onRetry={items.refetch} />
      ) : (
        <form id="materials-form" onSubmit={onSubmit}>
          <Select
            id="materials-from"
            label="Take materials from"
            value={fromLocationId}
            onChange={setFromLocationId}
            placeholder="Choose where the stock is"
            options={(locations.data ?? []).map((l) => ({
              value: String(l.id),
              label: `${l.name} (${label(l.type)})${String(l.id) === String(siteId) ? ' — job site' : ''}`,
            }))}
            hint="Defaults to the job's site. Lines already on the job keep the stock they were first drawn from."
          />

          <p className="hint">
            Saving moves this stock out of {sourceName}. Change a number and only the difference
            moves; remove a line and all of it goes back.
          </p>

          {stock.isPending && fromLocationId ? (
            <LoadingRows rows={2} />
          ) : bulk.length === 0 ? (
            <EmptyState title={`No bulk stock at ${sourceName}`}>
              Materials are bulk items — cable, sleeves, connectors. Transfer some to this
              location under Stock → Transfer, or choose another source above.
            </EmptyState>
          ) : (
            bulk.map((item) => {
              const line = lines[item.id];
              const cap = claimable(item);
              const tooMuch = line && overdrawn(item.id, line);
              return (
                <div className="card flat" key={item.id}>
                  <label className="check-row">
                    <input type="checkbox" checked={Boolean(line)} onChange={() => toggle(item)} />
                    <span>
                      <span className="item-name">{item.name}</span>
                      <span className="item-meta">
                        {item.category} · {onHand[item.id] ?? 0} {item.unit_of_measure} available at{' '}
                        {sourceName}
                        {item.unit_cost ? ` · ${formatMoney(item.unit_cost)} per unit` : ' · no price set'}
                      </span>
                    </span>
                  </label>

                  {line ? (
                    <div className="field-row">
                      <NumberInput
                        id={`mat-qty-${item.id}`}
                        label={`Amount (${item.unit_of_measure})`}
                        value={line.quantity}
                        onChange={edit(item.id, 'quantity')}
                        min="0"
                        step="any"
                        error={tooMuch ? `Only ${cap} ${item.unit_of_measure} available` : undefined}
                      />
                      <TextInput
                        id={`mat-notes-${item.id}`}
                        label="Notes"
                        value={line.notes}
                        onChange={edit(item.id, 'notes')}
                        placeholder="Optional"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </form>
      )}
    </Modal>
  );
}

// ----------------------------------------------------------------- labour ---

export function EditJobServicesDialog({ jobId, current, onClose }) {
  const services = useServices();
  const save = useSetJobServices();
  const { notify, notifyError } = useToast();

  const [lines, setLines] = useState(() =>
    Object.fromEntries(
      (current ?? []).map((line) => [
        line.service_id,
        { quantity: String(line.quantity), notes: line.notes ?? '' },
      ])
    )
  );

  const toggle = (service) =>
    setLines((prev) => {
      const next = { ...prev };
      if (next[service.id]) delete next[service.id];
      // A flat-rate service is always 1, so it needs no typing to be valid.
      else next[service.id] = { quantity: '1', notes: '' };
      return next;
    });

  const edit = (id, key) => (value) =>
    setLines((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));

  async function onSubmit(event) {
    event.preventDefault();
    try {
      await save.mutateAsync({
        jobId,
        services: Object.entries(lines).map(([serviceId, line]) => ({
          service_id: Number(serviceId),
          quantity: Number(line.quantity),
          notes: line.notes.trim() || undefined,
        })),
      });
      notify('Recorded work updated');
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  const chosen = Object.keys(lines).length;

  return (
    <Modal
      title="Work performed on this job"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="job-services-form"
            className="btn-primary"
            disabled={save.isPending}
          >
            {save.isPending ? 'Saving…' : `Save ${chosen} service${chosen === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      {services.isPending ? (
        <LoadingRows rows={3} />
      ) : services.isError ? (
        <ErrorState error={services.error} onRetry={services.refetch} />
      ) : services.data.length === 0 ? (
        <EmptyState title="No services in the catalog">
          Add one under Catalog → Services first.
        </EmptyState>
      ) : (
        <form id="job-services-form" onSubmit={onSubmit}>
          {services.data.map((service) => {
            const line = lines[service.id];
            return (
              <div className="card flat" key={service.id}>
                <label className="check-row">
                  <input type="checkbox" checked={Boolean(line)} onChange={() => toggle(service)} />
                  <span>
                    <span className="item-name">{service.name}</span>
                    <span className="item-meta">
                      {service.unit_of_measure === 'job'
                        ? 'Per visit'
                        : `Per ${service.unit_of_measure}`}
                      {service.unit_rate ? ` · ${formatMoney(service.unit_rate)}` : ' · no rate set'}
                    </span>
                  </span>
                </label>

                {line ? (
                  <div className="field-row">
                    {/* Flat-rate work is always one per visit, so there is
                        nothing to ask. Measured work needs the number. */}
                    {service.unit_of_measure === 'job' ? null : (
                      <NumberInput
                        id={`svc-qty-${service.id}`}
                        label={`Amount (${service.unit_of_measure})`}
                        value={line.quantity}
                        onChange={edit(service.id, 'quantity')}
                        min="0"
                        step="any"
                      />
                    )}
                    <TextInput
                      id={`svc-notes-${service.id}`}
                      label="Notes"
                      value={line.notes}
                      onChange={edit(service.id, 'notes')}
                      placeholder="Optional"
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </form>
      )}
    </Modal>
  );
}

// --------------------------------------------------------------- expenses ---

export function EditJobExpensesDialog({ jobId, current, onClose }) {
  const save = useSetJobExpenses();
  const { notify, notifyError } = useToast();

  // A list, not a map: two fares on one job are two facts, and the API puts no
  // uniqueness rule on the category for that reason.
  const [rows, setRows] = useState(() =>
    (current ?? []).map((line, index) => ({
      key: `e-${line.id ?? index}`,
      category: line.category,
      amount: String(line.amount),
      description: line.description ?? '',
    }))
  );

  const add = () =>
    setRows((prev) => [
      ...prev,
      { key: `e-new-${Date.now()}`, category: 'transport', amount: '', description: '' },
    ]);

  const edit = (key, field) => (value) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));

  const remove = (key) => setRows((prev) => prev.filter((row) => row.key !== key));

  const ready = rows.every((row) => (parseAmount(row.amount) ?? 0) > 0);
  const total = rows.reduce((sum, row) => sum + (parseAmount(row.amount) ?? 0), 0);

  async function onSubmit(event) {
    event.preventDefault();
    try {
      await save.mutateAsync({
        jobId,
        expenses: rows.map((row) => ({
          category: row.category,
          amount: parseAmount(row.amount),
          description: row.description.trim() || undefined,
        })),
      });
      notify('Costs updated');
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title="Other costs on this job"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="job-expenses-form"
            className="btn-primary"
            disabled={save.isPending || !ready}
          >
            {save.isPending ? 'Saving…' : `Save ${formatMoney(total)}`}
          </button>
        </>
      }
    >
      <form id="job-expenses-form" onSubmit={onSubmit}>
        <p className="hint">
          Fares, casual help, permits — what the job cost that was neither stock nor labour.
        </p>

        {rows.length === 0 ? (
          <EmptyState title="No other costs recorded" />
        ) : (
          rows.map((row) => (
            <div className="card flat" key={row.key}>
              <div className="field-row">
                <Select
                  id={`exp-cat-${row.key}`}
                  label="Kind"
                  value={row.category}
                  onChange={edit(row.key, 'category')}
                  options={JOB_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: label(c) }))}
                />
                <NumberInput
                  id={`exp-amt-${row.key}`}
                  label="Amount (KES)"
                  value={row.amount}
                  onChange={edit(row.key, 'amount')}
                  min="0"
                  step="any"
                  error={
                    row.amount.trim() !== '' && !((parseAmount(row.amount) ?? 0) > 0)
                      ? 'Give an amount greater than zero'
                      : undefined
                  }
                />
                <TextInput
                  id={`exp-desc-${row.key}`}
                  label="What for"
                  value={row.description}
                  onChange={edit(row.key, 'description')}
                  placeholder="Boda from Kanduyi"
                />
              </div>
              <button type="button" className="btn-danger btn-sm" onClick={() => remove(row.key)}>
                Remove
              </button>
            </div>
          ))
        )}

        <button type="button" className="btn-secondary btn-sm" onClick={add}>
          + Add a cost
        </button>
      </form>
    </Modal>
  );
}
