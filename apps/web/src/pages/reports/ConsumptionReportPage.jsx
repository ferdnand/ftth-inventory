import { useConsumption } from '../../hooks/useData';
import { ChartFrame } from '../../charts/ChartFrame';
import { RankedBar } from '../../charts/marks';
import { EmptyState, ErrorState, LoadingRows } from '../../components/states';
import { PageHeader } from '../../components/PageHeader';
import { ReportFilters, useReportRange } from './ReportFilters';

const GROUPINGS = [
  { value: 'item', label: 'By item' },
  { value: 'category', label: 'By category' },
  { value: 'location', label: 'By source location' },
];

export function ConsumptionReportPage() {
  const range = useReportRange('30');
  const groupBy = range.params.get('group_by') ?? 'item';

  const consumption = useConsumption({
    from: range.from ?? undefined,
    to: range.to ?? undefined,
    group_by: groupBy,
  });

  // Top 12: a horizontal bar chart with 40 rows is a table with extra steps.
  const rows = (consumption.data?.consumption ?? []).slice(0, 12);
  const total = (consumption.data?.consumption ?? []).reduce((sum, r) => sum + r.quantity, 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Consumption"
        sub="Stock that left the business — routers installed and bulk material issued to jobs"
      />

      <ReportFilters range={range}>
        <div className="field">
          <label htmlFor="group_by">Group by</label>
          <select
            id="group_by"
            value={groupBy}
            onChange={(e) => range.setParam('group_by', e.target.value)}
          >
            {GROUPINGS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      </ReportFilters>

      {/* Say what is counted, because "consumption" is ambiguous in an
        * inventory system and getting it wrong silently doubles the numbers. */}
      <div className="banner info">
        A transfer between two locations is movement, not consumption, and is deliberately
        excluded. Serialized units count as 1 each; bulk items count their quantity, so mixing
        units in one chart is only meaningful when grouped by item.
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="num">{consumption.isPending ? '—' : Math.round(total)}</div>
          <div className="lbl">Total consumed (mixed units)</div>
        </div>
        <div className="stat">
          <div className="num">
            {consumption.isPending ? '—' : consumption.data.consumption.length}
          </div>
          <div className="lbl">Distinct {groupBy === 'item' ? 'items' : groupBy + 's'}</div>
        </div>
      </div>

      {consumption.isPending ? (
        <LoadingRows rows={6} />
      ) : consumption.isError ? (
        <ErrorState error={consumption.error} onRetry={consumption.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing consumed in this period">
          Widen the date range, or install a router to see it here.
        </EmptyState>
      ) : (
        <ChartFrame
          title={`Top ${rows.length} by consumption`}
          subtitle="Horizontal because item names are long; one hue because these are nominal categories, not a scale"
          isRefetching={consumption.isRefetching}
          tableColumns={[
            { key: 'label', header: 'Name' },
            { key: 'quantity', header: 'Consumed', numeric: true },
            { key: 'movement_count', header: 'Movements', numeric: true },
            ...(groupBy === 'item' ? [{ key: 'unit_of_measure', header: 'Unit' }] : []),
          ]}
          tableRows={consumption.data.consumption}
        >
          <RankedBar
            data={rows}
            labelKey="label"
            valueKey="quantity"
            valueName="Consumed"
          />
        </ChartFrame>
      )}
    </div>
  );
}
