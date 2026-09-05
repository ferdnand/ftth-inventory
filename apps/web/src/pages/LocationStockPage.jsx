import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useAdjustStock, useLocations, useStock } from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Meter } from '../components/Meter';
import { Modal } from '../components/Modal';
import { NumberInput, TextArea } from '../components/fields';
import { useToast } from '../components/Toast';
import { newIdempotencyKey } from '../lib/api';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { groupSerialized } from '../lib/groupSerialized';
import { label } from '../lib/constants';

// Reconciling a shelf against the record. Admin-only, because a stock level
// that disagrees with what is there is usually a movement nobody recorded — and
// the right fix for that is to record the movement, not to overwrite the count.
function AdjustStockDialog({ locationId, row, onClose }) {
  const adjust = useAdjustStock();
  const { notify, notifyError } = useToast();

  const [counted, setCounted] = useState(String(row.quantity));
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  // Held across retries so a resubmit after a dropped response corrects once.
  const [idempotencyKey] = useState(newIdempotencyKey);

  const delta = counted === '' ? null : Number(counted) - Number(row.quantity);

  async function onSubmit(event) {
    event.preventDefault();
    const next = {};
    if (counted === '' || Number.isNaN(Number(counted))) next.counted = 'Enter the counted amount';
    else if (Number(counted) < 0) next.counted = 'Cannot be negative';
    if (!notes.trim()) next.notes = 'Say why the record was wrong';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      const result = await adjust.mutateAsync({
        item_id: row.item_id,
        location_id: locationId,
        counted_quantity: Number(counted),
        notes: notes.trim(),
        idempotency_key: idempotencyKey,
      });
      notify(
        result.adjusted === false
          ? `${row.item_name} already matched the count`
          : `${row.item_name} corrected to ${counted} ${row.unit_of_measure}`
      );
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Modal
      title={`Correct ${row.item_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="adjust-form"
            className="btn-primary"
            disabled={adjust.isPending}
          >
            {adjust.isPending ? 'Saving…' : 'Record correction'}
          </button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={onSubmit}>
        <NumberInput
          id="counted"
          label={`Counted (${row.unit_of_measure})`}
          value={counted}
          onChange={setCounted}
          error={errors.counted}
          step="any"
          min="0"
          hint={
            delta === null || delta === 0
              ? `The record says ${row.quantity}. Enter what is actually there.`
              : `${delta > 0 ? '+' : ''}${delta} ${row.unit_of_measure} against the recorded ${row.quantity}.`
          }
        />
        <TextArea
          id="notes"
          label="Reason"
          value={notes}
          onChange={setNotes}
          error={errors.notes}
          rows={3}
          hint="Kept on the audit trail against your name. Required."
        />
      </form>
    </Modal>
  );
}

export function LocationStockPage() {
  const { id } = useParams();
  const locationId = Number(id);
  const { hasRole } = useAuth();

  const stock = useStock(locationId);
  const locations = useLocations();
  const [grouped, setGrouped] = useState(true);
  const [adjusting, setAdjusting] = useState(null);
  const canAdjust = hasRole('admin');

  const location = (locations.data ?? []).find((l) => l.id === locationId);
  const groups = useMemo(
    () => groupSerialized(stock.data?.serialized ?? []),
    [stock.data]
  );

  const bulkColumns = [
    {
      key: 'item_name',
      header: 'Item',
      render: (row) => (
        <>
          <div className="item-name">{row.item_name}</div>
          <div className="item-meta">{row.category}</div>
        </>
      ),
    },
    {
      key: 'quantity',
      header: 'On hand',
      numeric: true,
      render: (row) => (
        <span>
          {row.quantity} <span style={{ color: 'var(--meta)' }}>{row.unit_of_measure}</span>
        </span>
      ),
    },
    {
      key: 'level',
      header: 'Against threshold',
      render: (row) => (
        <Meter
          quantity={row.quantity}
          threshold={row.reorder_threshold}
          unit={row.unit_of_measure}
        />
      ),
    },
    {
      key: 'flag',
      header: '',
      // is_low_stock is COALESCEd to false server-side, but test identity rather
      // than truthiness so an older API build returning null cannot flag every
      // untracked item.
      render: (row) => (row.is_low_stock === true ? <Badge variant="low">Reorder soon</Badge> : null),
    },
    ...(canAdjust
      ? [
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setAdjusting(row)}
              >
                Correct
              </button>
            ),
          },
        ]
      : []),
  ];

  const flatColumns = [
    {
      key: 'serial_number',
      header: 'Serial',
      render: (row) => <span className="mono">{row.serial_number}</span>,
    },
    {
      key: 'mac_address',
      header: 'MAC',
      render: (row) => <span className="mono">{row.mac_address ?? '—'}</span>,
    },
    {
      key: 'item_name',
      header: 'Item',
      render: (row) => (
        <>
          <div className="item-name">{row.item_name}</div>
          <div className="item-meta">
            {[row.manufacturer, row.model].filter(Boolean).join(' ') || row.category}
          </div>
        </>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={location ? label(location.type) : 'Location'}
        title={location?.name ?? `Location ${locationId}`}
        sub={location?.address ?? undefined}
        actions={
          hasRole('warehouse_staff', 'pm') ? (
            <>
              <Link className="btn-secondary" to={`/stock/receive?location=${locationId}`}>
                Receive here
              </Link>
              <Link className="btn-primary" to={`/stock/transfer?from=${locationId}`}>
                Transfer out
              </Link>
            </>
          ) : null
        }
      />

      {stock.isPending ? (
        <LoadingRows rows={6} />
      ) : stock.isError ? (
        <ErrorState error={stock.error} onRetry={stock.refetch} />
      ) : (
        <>
          <div className="section-label" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>Serialized — CPE &amp; actives</span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setGrouped((v) => !v)}
              style={{ textTransform: 'none', letterSpacing: 0 }}
            >
              {grouped ? 'Show every serial' : 'Group by model'}
            </button>
          </div>

          {stock.data.serialized.length === 0 ? (
            <EmptyState title="No serialized units here">
              Receive units by serial number to stock this location.
            </EmptyState>
          ) : grouped ? (
            <div>
              {groups.map((group) => (
                <div className={`card ${group.installable.length === 0 ? 'low' : ''}`.trim()} key={group.item_id}>
                  <div className="card flat" style={{ border: 'none', padding: 0, margin: 0, background: 'transparent' }}>
                    <div>
                      <div className="item-name">{group.item_name}</div>
                      <div className="item-meta">
                        {[group.manufacturer, group.model].filter(Boolean).join(' ') || group.category}
                      </div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {group.installable.length > 0 ? (
                          <Badge variant="ok">
                            {group.installable.length} ready to install
                          </Badge>
                        ) : (
                          <Badge variant="low">None ready to install</Badge>
                        )}
                        {/* "Ready to install" would be a lie on a faulty unit,
                          * so these are counted separately. */}
                        {group.toReturn.length > 0 ? (
                          <Badge variant="danger">{group.toReturn.length} to collect</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="qty">
                      {group.units.length}
                      <span className="unit">units</span>
                    </div>
                  </div>

                  <details style={{ marginTop: 10 }}>
                    <summary
                      style={{ cursor: 'pointer', color: 'var(--text-2)', fontSize: 12.5 }}
                    >
                      Serial numbers
                    </summary>
                    <div style={{ marginTop: 8 }}>
                      {group.units.map((unit) => (
                        <div className="serial-row" key={unit.id}>
                          <div>
                            <div className="s-id">{unit.serial_number}</div>
                            <div className="s-status">{unit.mac_address ?? 'no MAC recorded'}</div>
                          </div>
                          <Badge value={unit.status} />
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <DataTable
              columns={flatColumns}
              rows={stock.data.serialized}
              rowKey={(row) => row.id}
            />
          )}

          <div className="section-label">Bulk — cable &amp; consumables</div>
          <DataTable
            columns={bulkColumns}
            rows={stock.data.bulk}
            rowKey={(row) => row.item_id}
            rowClassName={(row) => (row.is_low_stock === true ? 'low' : '')}
            empty={
              <EmptyState title="No bulk stock here">
                Transfer cable or consumables in to see them listed.
              </EmptyState>
            }
          />
        </>
      )}

      {adjusting ? (
        <AdjustStockDialog
          locationId={locationId}
          row={adjusting}
          onClose={() => setAdjusting(null)}
        />
      ) : null}
    </div>
  );
}
