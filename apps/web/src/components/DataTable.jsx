import { EmptyState } from './states';

// Columns: { key, header, render?, numeric?, width? }
//
// Wide tables scroll inside their own container — the page body must never
// scroll horizontally.
export function DataTable({ columns, rows, rowKey, onRowClick, rowClassName, empty }) {
  if (rows.length === 0) {
    return empty ?? <EmptyState title="Nothing here yet" />;
  }

  return (
    <div className="table-wrap scroll-x">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.numeric ? 'num' : undefined}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const extra = rowClassName?.(row);
            return (
              <tr
                key={rowKey(row)}
                className={[onRowClick ? 'clickable' : '', extra ?? ''].join(' ').trim()}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className={col.numeric ? 'num' : undefined}>
                    {col.render ? col.render(row) : row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
