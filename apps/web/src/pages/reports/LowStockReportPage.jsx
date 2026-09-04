import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocations, useLowStock } from '../../hooks/useData';
import { Meter, SeverityLabel, severityOf } from '../../components/Meter';
import { EmptyState, ErrorState, LoadingRows } from '../../components/states';
import { PageHeader } from '../../components/PageHeader';
import { label } from '../../lib/constants';

// No chart here on purpose. A single ratio against a limit is a meter, not a
// chart — and a bar chart of "quantity" across items with different thresholds
// and different units would compare things that are not comparable.
export function LowStockReportPage() {
  const [locationId, setLocationId] = useState(null);
  const lowStock = useLowStock(locationId ? { location_id: locationId } : undefined);
  const locations = useLocations();

  const rows = useMemo(
    () =>
      (lowStock.data ?? [])
        .map((row) => ({ ...row, severity: severityOf(row.quantity, row.reorder_threshold) }))
        // Worst first: the point of this page is what to reorder today.
        .sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0)),
    [lowStock.data]
  );

  const stockingLocations = (locations.data ?? []).filter((l) => l.type !== 'site');
  const outOfStock = rows.filter((r) => r.quantity === 0).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Low stock"
        sub="Every item at or below its reorder threshold, at every warehouse and van"
      />

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${locationId === null ? 'active' : ''}`.trim()}
          onClick={() => setLocationId(null)}
        >
          All locations
        </button>
        {stockingLocations.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`chip ${locationId === l.id ? 'active' : ''}`.trim()}
            onClick={() => setLocationId(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      <div className="stat-row">
        <div className={`stat ${rows.length > 0 ? 'warn' : ''}`.trim()}>
          <div className="num">{lowStock.isPending ? '—' : rows.length}</div>
          <div className="lbl">Rows below threshold</div>
        </div>
        <div className={`stat ${outOfStock > 0 ? 'warn' : ''}`.trim()}>
          <div className="num">{lowStock.isPending ? '—' : outOfStock}</div>
          <div className="lbl">Completely out</div>
        </div>
      </div>

      {/* Worth naming, because it is the whole reason this report is a
        * server-side cross join rather than a GROUP BY: a location that ran out
        * of something has no row to group, so the naive query hides exactly the
        * item that most needs reordering. */}
      <div className="banner info">
        This includes items a location holds <strong>none</strong> of. Only items with a reorder
        threshold set appear — set one under Catalog to bring an item into this report.
      </div>

      {lowStock.isPending ? (
        <LoadingRows rows={6} />
      ) : lowStock.isError ? (
        <ErrorState error={lowStock.error} onRetry={lowStock.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="Everything is above its threshold">
          Nothing needs reordering right now.
        </EmptyState>
      ) : (
        <div className="table-wrap scroll-x">
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Item</th>
                <th>Location</th>
                <th>Against threshold</th>
                <th className="num">On hand</th>
                <th className="num">Reorder at</th>
                <th className="num">Short by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="low" key={`${row.location_id}-${row.item_id}`}>
                  <td>
                    <SeverityLabel quantity={row.quantity} threshold={row.reorder_threshold} />
                  </td>
                  <td>
                    <div className="item-name">{row.item_name}</div>
                    <div className="item-meta">
                      {row.category} · {label(row.tracking_type)}
                    </div>
                  </td>
                  <td>
                    <Link to={`/locations/${row.location_id}/stock`}>{row.location_name}</Link>
                    <div className="item-meta">{label(row.location_type)}</div>
                  </td>
                  <td>
                    <Meter quantity={row.quantity} threshold={row.reorder_threshold} />
                  </td>
                  <td className="num">
                    {row.quantity} {row.unit_of_measure}
                  </td>
                  <td className="num">{row.reorder_threshold}</td>
                  <td className="num">{row.reorder_threshold - row.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
