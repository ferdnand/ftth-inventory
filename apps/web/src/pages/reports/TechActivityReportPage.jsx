import { useTechActivity } from '../../hooks/useData';
import { ChartFrame, ChartLegend } from '../../charts/ChartFrame';
import { StackedBar } from '../../charts/marks';
import { chart } from '../../charts/chartTheme';
import { EmptyState, ErrorState, LoadingRows } from '../../components/states';
import { PageHeader } from '../../components/PageHeader';
import { ReportFilters, useReportRange } from './ReportFilters';

// Installs and removals are two series, so identity matters and a legend is
// required. Stacked rather than dual-axis: both series are counts on the same
// scale, and this app does not do dual-axis charts.
const SERIES = [
  { value: 'installs', label: 'Installs' },
  { value: 'removals', label: 'Removals' },
];

export function TechActivityReportPage() {
  const range = useReportRange('30');
  const activity = useTechActivity({ from: range.from ?? undefined, to: range.to ?? undefined });

  const rows = (activity.data ?? []).filter(
    (row) => row.installs > 0 || row.removals > 0 || row.stock_movements > 0
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Tech activity"
        sub="Installs, removals and stock movements per field tech"
      />

      <ReportFilters range={range} />

      {/* Worth stating because it is a real modelling choice: a removal is
        * credited to whoever removed it, not to whoever originally installed
        * it. */}
      <div className="banner info">
        A removal is credited to the tech who removed the unit, not the one who installed it. A
        replacement therefore counts as one install and one removal, usually for the same person.
      </div>

      {activity.isPending ? (
        <LoadingRows rows={5} />
      ) : activity.isError ? (
        <ErrorState error={activity.error} onRetry={activity.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="No field activity in this period">
          Widen the date range, or have a tech install a router.
        </EmptyState>
      ) : (
        <>
          <ChartFrame
            title="Installs and removals per tech"
            isRefetching={activity.isRefetching}
            tableColumns={[
              { key: 'name', header: 'Tech' },
              { key: 'assigned_location_name', header: 'Van' },
              { key: 'installs', header: 'Installs', numeric: true },
              { key: 'removals', header: 'Removals', numeric: true },
              { key: 'stock_movements', header: 'Stock movements', numeric: true },
            ]}
            tableRows={rows}
          >
            <StackedBar
              data={rows}
              xKey="name"
              stackKeys={SERIES}
              layout="vertical"
              height={Math.max(rows.length * 44 + 40, 180)}
            />
            <ChartLegend
              items={SERIES.map((s, i) => ({ label: s.label, color: chart.series[i] }))}
            />
          </ChartFrame>

          <div className="section-label">Every tech</div>
          <div className="table-wrap scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Tech</th>
                  <th>Van</th>
                  <th className="num">Installs</th>
                  <th className="num">Removals</th>
                  <th className="num">Stock movements</th>
                </tr>
              </thead>
              <tbody>
                {(activity.data ?? []).map((row) => (
                  <tr key={row.user_id}>
                    <td className="item-name">{row.name}</td>
                    <td>{row.assigned_location_name ?? '—'}</td>
                    <td className="num">{row.installs}</td>
                    <td className="num">{row.removals}</td>
                    <td className="num">{row.stock_movements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
