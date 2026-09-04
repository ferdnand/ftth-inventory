import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLocations, useStock } from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Meter } from '../components/Meter';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { groupSerialized } from '../lib/groupSerialized';
import { label } from '../lib/constants';

export function LocationStockPage() {
  const { id } = useParams();
  const locationId = Number(id);
  const { hasRole } = useAuth();

  const stock = useStock(locationId);
  const locations = useLocations();
  const [grouped, setGrouped] = useState(true);

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
    </div>
  );
}
