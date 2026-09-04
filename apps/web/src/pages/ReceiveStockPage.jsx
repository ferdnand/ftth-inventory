import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useCreateItemInstances,
  useCreateTransaction,
  useItems,
  useLocations,
} from '../hooks/useData';
import { NumberInput, Select, TextArea, TextInput } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { newIdempotencyKey } from '../lib/api';

// Parses the pasted block for serialized receiving. One unit per line, serial
// first, MAC optional after a comma / tab / whitespace:
//   HW8245Q2-991A, F0:9E:63:22:8B:C1
//   HW8245Q2-991B
function parseUnits(text) {
  const units = [];
  const errors = [];
  const seen = new Set();

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const [serial, mac] = line.split(/[,\t]|\s{2,}/).map((p) => p?.trim());
      if (!serial) {
        errors.push(`Line ${index + 1}: no serial number`);
        return;
      }
      const key = serial.toLowerCase();
      if (seen.has(key)) {
        // The UNIQUE index would report this as an opaque conflict on the
        // second row, so catch it here where we can name the line.
        errors.push(`Line ${index + 1}: serial ${serial} is repeated`);
        return;
      }
      seen.add(key);
      units.push({ serial_number: serial, mac_address: mac || undefined });
    });

  return { units, errors };
}

function BulkReceive({ items, locations, defaultLocation }) {
  const create = useCreateTransaction();
  const { notify, notifyError } = useToast();

  const bulkItems = items.filter((i) => i.tracking_type === 'bulk');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [locationId, setLocationId] = useState(defaultLocation ?? '');
  const [notes, setNotes] = useState('');

  const item = bulkItems.find((i) => String(i.id) === itemId);

  async function onSubmit(event) {
    event.preventDefault();
    try {
      await create.mutateAsync({
        item_id: Number(itemId),
        quantity: Number(quantity),
        to_location_id: Number(locationId),
        type: 'receive',
        notes: notes.trim() || undefined,
        idempotency_key: newIdempotencyKey(),
      });
      notify(`Received ${quantity} ${item?.unit_of_measure ?? ''} of ${item?.name ?? 'stock'}`);
      setQuantity('');
      setNotes('');
    } catch (err) {
      notifyError(err);
    }
  }

  const ready = itemId && Number(quantity) > 0 && locationId;

  return (
    <form className="form-card" onSubmit={onSubmit}>
      <Select
        id="item"
        label="Item"
        value={itemId}
        onChange={setItemId}
        placeholder="Choose a bulk item"
        options={bulkItems.map((i) => ({ value: String(i.id), label: `${i.name} (${i.category})` }))}
      />
      <div className="field-row">
        <NumberInput
          id="quantity"
          label={`Quantity${item ? ` (${item.unit_of_measure})` : ''}`}
          value={quantity}
          onChange={setQuantity}
          min="0"
          step="any"
        />
        <Select
          id="destination"
          label="Into"
          value={locationId}
          onChange={setLocationId}
          placeholder="Choose a location"
          options={locations.map((l) => ({ value: String(l.id), label: l.name }))}
        />
      </div>
      <TextInput
        id="notes"
        label="Notes"
        value={notes}
        onChange={setNotes}
        placeholder="Supplier delivery note number"
      />
      <button type="submit" className="btn-primary" disabled={!ready || create.isPending}>
        {create.isPending ? 'Receiving…' : 'Receive stock'}
      </button>
    </form>
  );
}

function SerializedReceive({ items, locations, defaultLocation }) {
  const createInstances = useCreateItemInstances();
  const { notify, notifyError } = useToast();

  const serializedItems = items.filter((i) => i.tracking_type === 'serialized');
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState(defaultLocation ?? '');
  const [text, setText] = useState('');

  const parsed = useMemo(() => parseUnits(text), [text]);
  const item = serializedItems.find((i) => String(i.id) === itemId);
  const ready = itemId && locationId && parsed.units.length > 0 && parsed.errors.length === 0;

  async function onSubmit(event) {
    event.preventDefault();
    try {
      // POST /api/item-instances both creates the rows and writes one 'receive'
      // transaction per unit, in a single database transaction — a duplicate
      // serial anywhere rejects the whole batch rather than half-registering it.
      const result = await createInstances.mutateAsync({
        item_id: Number(itemId),
        location_id: Number(locationId),
        units: parsed.units,
      });
      notify(`Registered ${result.created} unit${result.created === 1 ? '' : 's'}`);
      setText('');
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      <div className="field-row">
        <Select
          id="s-item"
          label="Item"
          value={itemId}
          onChange={setItemId}
          placeholder="Choose a serialized item"
          options={serializedItems.map((i) => ({
            value: String(i.id),
            label: `${i.name} (${i.category})`,
          }))}
        />
        <Select
          id="s-destination"
          label="Into"
          value={locationId}
          onChange={setLocationId}
          placeholder="Choose a location"
          options={locations.map((l) => ({ value: String(l.id), label: l.name }))}
        />
      </div>

      <TextArea
        id="serials"
        label="Serial numbers"
        value={text}
        onChange={setText}
        placeholder={'HW8245Q2-991A, F0:9E:63:22:8B:C1\nHW8245Q2-991B, F0:9E:63:22:8B:C2\nHW8245Q2-991C'}
        hint="One unit per line. Serial first, MAC address after a comma if you have it."
      />

      {parsed.errors.length > 0 ? (
        <div className="banner" role="alert">
          {parsed.errors.slice(0, 5).map((e) => (
            <div key={e}>{e}</div>
          ))}
          {parsed.errors.length > 5 ? <div>…and {parsed.errors.length - 5} more</div> : null}
        </div>
      ) : null}

      {parsed.units.length > 0 ? (
        <>
          <div className="section-label">
            Preview — {parsed.units.length} unit{parsed.units.length === 1 ? '' : 's'}
          </div>
          <div className="table-wrap scroll-x" style={{ marginBottom: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>MAC</th>
                  <th>Item</th>
                </tr>
              </thead>
              <tbody>
                {parsed.units.slice(0, 25).map((unit) => (
                  <tr key={unit.serial_number}>
                    <td className="mono">{unit.serial_number}</td>
                    <td className="mono">{unit.mac_address ?? '—'}</td>
                    <td>{item?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.units.length > 25 ? (
            <div className="hint" style={{ marginBottom: 12 }}>
              Showing the first 25 of {parsed.units.length}.
            </div>
          ) : null}
        </>
      ) : null}

      <button type="submit" className="btn-primary" disabled={!ready || createInstances.isPending}>
        {createInstances.isPending ? 'Registering…' : `Register ${parsed.units.length || ''} units`}
      </button>
    </form>
  );
}

export function ReceiveStockPage() {
  const [params] = useSearchParams();
  const items = useItems();
  const locations = useLocations();
  const [mode, setMode] = useState('serialized');

  const defaultLocation = params.get('location') ?? '';

  if (items.isPending || locations.isPending) {
    return (
      <div className="page">
        <LoadingRows rows={4} />
      </div>
    );
  }
  if (items.isError || locations.isError) {
    return (
      <div className="page">
        <ErrorState
          error={items.error ?? locations.error}
          onRetry={items.isError ? items.refetch : locations.refetch}
        />
      </div>
    );
  }

  const stockingLocations = locations.data.filter((l) => l.type !== 'site');

  return (
    <div className="page">
      <PageHeader
        eyebrow="Stock"
        title="Receive stock"
        sub="Bring new stock into a warehouse or van from a supplier"
      />

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${mode === 'serialized' ? 'active' : ''}`.trim()}
          onClick={() => setMode('serialized')}
        >
          Serialized (by serial number)
        </button>
        <button
          type="button"
          className={`chip ${mode === 'bulk' ? 'active' : ''}`.trim()}
          onClick={() => setMode('bulk')}
        >
          Bulk (by quantity)
        </button>
      </div>

      {items.data.length === 0 ? (
        <EmptyState title="The catalog is empty">
          Add items under Catalog before receiving stock.
        </EmptyState>
      ) : mode === 'bulk' ? (
        <BulkReceive
          items={items.data}
          locations={stockingLocations}
          defaultLocation={defaultLocation}
        />
      ) : (
        <SerializedReceive
          items={items.data}
          locations={stockingLocations}
          defaultLocation={defaultLocation}
        />
      )}
    </div>
  );
}
