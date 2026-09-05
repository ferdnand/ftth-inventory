import { useServicesReport } from '../../hooks/useData';
import { ChartFrame } from '../../charts/ChartFrame';
import { RankedBar } from '../../charts/marks';
import { EmptyState, ErrorState, LoadingRows } from '../../components/states';
import { PageHeader } from '../../components/PageHeader';
import { ReportFilters, useReportRange } from './ReportFilters';
import { formatQuantity } from '../../lib/format';

const GROUPINGS = [
  { value: 'service', label: 'By service' },
  { value: 'tech', label: 'By tech' },
];

// "412 m · 37 jobs" — never one summed number, because metres and jobs do not
// add up to anything a person can act on.
function formatUnitTotals(byUnit) {
  if (!byUnit || byUnit.length === 0) return '—';
  return byUnit
    .map((row) =>
      formatQuantity(row.quantity, row.unit_of_measure === 'meter' ? 'm' : row.unit_of_measure)
    )
    .join(' · ');
}

export function ServicesReportPage() {
  const range = useReportRange('30');
  const groupBy = range.params.get('group_by') ?? 'service';

  const report = useServicesReport({
    from: range.from ?? undefined,
    to: range.to ?? undefined,
    group_by: groupBy,
  });

  const byService = groupBy === 'service';
  const rows = (report.data?.services ?? []).slice(0, 12);
  const totals = report.data?.totals;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Services"
        sub="Labour performed on site — splicing, cable runs, router setups"
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

      {/* Both of these are easy to assume wrong, and either assumption makes
        * the numbers mean something other than what they say. */}
      <div className="banner info">
        Counted on the day the work was done, not the day it was recorded. Services are not stock,
        so none of this appears in the consumption report
        {byService ? '.' : ' — and grouped by tech, quantities are omitted because metres and jobs do not add up.'}
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="num">{report.isPending ? '—' : totals.visits}</div>
          <div className="lbl">Visits with work recorded</div>
        </div>
        <div className="stat">
          <div className="num">{report.isPending ? '—' : totals.services_performed}</div>
          <div className="lbl">Services performed</div>
        </div>
        <div className="stat">
          <div className="num" style={{ fontSize: 20 }}>
            {report.isPending ? '—' : formatUnitTotals(totals.by_unit)}
          </div>
          <div className="lbl">Total by unit</div>
        </div>
      </div>

      {report.isPending ? (
        <LoadingRows rows={6} />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={report.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="No work recorded in this period">
          Widen the date range, or record work against an installation from the field app.
        </EmptyState>
      ) : (
        <ChartFrame
          title={byService ? `Top ${rows.length} by amount` : 'Work performed per tech'}
          subtitle={
            byService
              ? 'Bars mix units across services — read each bar against its own row in the table'
              : 'Counted as services performed, since quantities across units are not comparable'
          }
          isRefetching={report.isRefetching}
          tableColumns={[
            { key: 'label', header: byService ? 'Service' : 'Tech' },
            ...(byService
              ? [
                  { key: 'quantity', header: 'Amount', numeric: true },
                  { key: 'unit_of_measure', header: 'Unit' },
                ]
              : []),
            { key: 'services_performed', header: 'Services', numeric: true },
            { key: 'visits', header: 'Visits', numeric: true },
          ]}
          tableRows={report.data.services}
        >
          <RankedBar
            data={rows}
            labelKey="label"
            valueKey={byService ? 'quantity' : 'services_performed'}
            valueName={byService ? 'Amount' : 'Services performed'}
          />
        </ChartFrame>
      )}
    </div>
  );
}
