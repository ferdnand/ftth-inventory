import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStockOverview } from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Select } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';

// Folds the API's one-row-per-item-per-location list into one row per item,
// with the locations it sits in kept as a breakdown. Done here, after the
// location filter, so a filtered total is the total for that place only.
function groupByItem(rows) {
  const byItem = new Map();
  for (const row of rows) {
    let item = byItem.get(row.item_id);
    if (!item) {
      item = {
        item_id: row.item_id,
        item_name: row.item_name,
        category: row.category,
        tracking_type: row.tracking_type,
        unit_of_measure: row.unit_of_measure,
        total: 0,
        installable: 0,
        to_return: 0,
        locations: [],
      };
      byItem.set(row.item_id, item);
    }
    item.total += Number(row.quantity);
    item.installable += Number(row.installable);
    item.to_return += Number(row.to_return);
    item.locations.push(row);
  }
  return [...byItem.values()];
}

export function StockOverviewPage() {
  const stock = useStockOverview();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(null);
  const [locationId, setLocationId] = useState('');

  const rows = useMemo(() => stock.data ?? [], [stock.data]);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);

  // Only locations that actually hold something are worth filtering by.
  const locations = useMemo(() => {
    const seen = new Map();
    for (const r of rows) seen.set(r.location_id, r);
    return [...seen.values()]
      .sort((a, b) => a.location_name.localeCompare(b.location_name))
      .map((r) => ({
        value: String(r.location_id),
        label: `${r.location_name}${r.location_active ? '' : ' (retired)'}`,
      }));
  }, [rows]);

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (category && r.category !== category) return false;
      if (locationId && String(r.location_id) !== locationId) return false;
      if (term && !r.item_name.toLowerCase().includes(term)) return false;
      return true;
    });
    return groupByItem(filtered);
  }, [rows, search, category, locationId]);

  const columns = [
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
      key: 'tracking_type',
      header: 'Tracking',
      render: (row) => (
        <Badge value={row.tracking_type} variant={row.tracking_type === 'serialized' ? 'installed' : ''} />
      ),
    },
    {
      key: 'total',
      header: 'On hand',
      numeric: true,
      render: (row) => (
        <>
          <div>
            {row.total}{' '}
            <span style={{ color: 'var(--meta)' }}>
              {row.tracking_type === 'serialized' ? 'units' : row.unit_of_measure}
            </span>
          </div>
          {row.tracking_type === 'serialized' ? (
            <div className="item-meta">
              {row.installable} ready{row.to_return ? ` · ${row.to_return} to collect` : ''}
            </div>
          ) : null}
        </>
      ),
    },
    {
      key: 'where',
      header: 'Where',
      render: (row) => (
        <div className="stock-where">
          {row.locations.map((l) => (
            <Link key={l.location_id} to={`/locations/${l.location_id}/stock`}>
              {l.location_name}
              {l.location_active ? '' : ' (retired)'}
              <span className="stock-where-qty"> {l.quantity}</span>
            </Link>
          ))}
        </div>
      ),
    },
  ];

  const unitsTotal = items.length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Stock"
        title="Stock on hand"
        sub="Every item we hold, how many, and where. Click a location to see its serials."
      />

      <div className="premise-search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by item name"
          aria-label="Filter items"
        />
      </div>

      <div className="field-row" style={{ maxWidth: 360 }}>
        <Select
          id="stock-location"
          label="Location"
          value={locationId}
          onChange={setLocationId}
          placeholder="All locations"
          options={locations}
        />
      </div>

      <div className="chip-row">
        <button
          type="button"
          className={`chip ${category === null ? 'active' : ''}`.trim()}
          onClick={() => setCategory(null)}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip ${category === c ? 'active' : ''}`.trim()}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {stock.isPending ? (
        <LoadingRows />
      ) : stock.isError ? (
        <ErrorState error={stock.error} onRetry={stock.refetch} />
      ) : (
        <>
          <div className="item-meta" style={{ marginBottom: 8 }}>
            {unitsTotal} item{unitsTotal === 1 ? '' : 's'} in stock
          </div>
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(row) => row.item_id}
            empty={
              <EmptyState title="Nothing in stock">
                {search || category || locationId
                  ? 'Clear the filters to see everything.'
                  : 'Receive stock under Stock → Receive stock and it will show up here.'}
              </EmptyState>
            }
          />
        </>
      )}
    </div>
  );
}
