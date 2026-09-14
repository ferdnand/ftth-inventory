import { useJobCosts } from '../../hooks/useData';
import { ChartFrame } from '../../charts/ChartFrame';
import { StackedBar } from '../../charts/marks';
import { EmptyState, ErrorState, LoadingRows } from '../../components/states';
import { PageHeader } from '../../components/PageHeader';
import { ReportFilters, useReportRange } from './ReportFilters';
import { formatAmount, formatMoney } from '../../lib/money';
import { label } from '../../lib/constants';

const GROUPINGS = [
  { value: 'site', label: 'By site' },
  { value: 'type', label: 'By job type' },
  { value: 'tech', label: 'By tech' },
  { value: 'month', label: 'By month' },
];

// The four buckets a job cost splits into. Stacked rather than four separate
// charts because the question is "what did this cost, and of what" — and one
// stacked bar per group answers both at once.
//
// Deliberately NOT a dual axis or a share-of-total pie: see ChartFrame for the
// rules this dashboard holds to.
const STACK = [
  { value: 'materials_total', label: 'Materials' },
  { value: 'labour_total', label: 'Labour' },
  { value: 'expenses_total', label: 'Other costs' },
  { value: 'hardware_total', label: 'Hardware' },
];

// What a connection costs, which is the question none of the other reports
// could answer.
//
// /consumption counts stock leaving the business and /services counts labour;
// neither of them knows about the fare that got the tech to the compound. This
// one reads the job's own lines, which is where all three now live.
export function JobCostsReportPage() {
  const range = useReportRange('30');
  const groupBy = range.params.get('group_by') ?? 'site';

  const report = useJobCosts({
    from: range.from ?? undefined,
    to: range.to ?? undefined,
    group_by: groupBy,
  });

  const rows = report.data?.job_costs ?? [];
  const totals = report.data?.totals;

  // Job types come back as enum values; the chart axis should read the way the
  // rest of the app does.
  const rowsForChart = rows
    .slice(0, 12)
    .map((row) => ({ ...row, label: groupBy === 'type' ? label(row.label) : row.label }));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Job costs"
        sub="What the work cost — materials, labour, expenses and hardware, per job"
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

      {/* Three things that are easy to assume wrong, and each assumption makes
        * the numbers mean something other than what they say. */}
      <div className="banner info">
        Counted on the day the work was done, not the day it was recorded. Cancelled jobs are
        excluded. Hardware is priced from the catalog at the time you read this — the other three
        buckets carry the figures agreed on the day.
      </div>

      {/* The honesty banner. A total sitting next to unpriced lines is a floor,
        * and a dashboard that presents it as the answer is worse than one that
        * shows no number. */}
      {totals?.unpriced_lines > 0 ? (
        <div className="banner">
          {totals.unpriced_lines} {totals.unpriced_lines === 1 ? 'line has' : 'lines have'} no
          price set, so every total below is a floor rather than the real cost. Set unit costs
          under Catalog → Items and rates under Catalog → Services.
        </div>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <div className="num">{report.isPending ? '—' : totals.jobs}</div>
          <div className="lbl">Jobs</div>
        </div>
        <div className="stat">
          <div className="num" style={{ fontSize: 20 }}>
            {report.isPending ? '—' : formatMoney(totals.total)}
          </div>
          <div className="lbl">Total cost</div>
        </div>
        <div className="stat">
          <div className="num" style={{ fontSize: 20 }}>
            {report.isPending || !totals.jobs
              ? '—'
              : formatMoney(Math.round((totals.total / totals.jobs) * 100) / 100)}
          </div>
          <div className="lbl">Average per job</div>
        </div>
        <div className="stat">
          <div className="num" style={{ fontSize: 20 }}>
            {report.isPending ? '—' : formatMoney(totals.expenses_total)}
          </div>
          <div className="lbl">Of that, expenses</div>
        </div>
      </div>

      {report.isPending ? (
        <LoadingRows rows={6} />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={report.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="No jobs in this period">
          Widen the date range, or record a job from the field app. A job with no lines on it costs
          nothing and still counts here.
        </EmptyState>
      ) : (
        <ChartFrame
          title={`Cost ${GROUPINGS.find((g) => g.value === groupBy).label.toLowerCase()}`}
          subtitle="Each bar splits into the four kinds of spend behind it, in KES"
          isRefetching={report.isRefetching}
          tableColumns={[
            { key: 'label', header: GROUPINGS.find((g) => g.value === groupBy).label.slice(3) },
            { key: 'jobs', header: 'Jobs', numeric: true },
            {
              key: 'materials_total',
              header: 'Materials',
              numeric: true,
              render: (row) => formatAmount(row.materials_total),
            },
            {
              key: 'labour_total',
              header: 'Labour',
              numeric: true,
              render: (row) => formatAmount(row.labour_total),
            },
            {
              key: 'expenses_total',
              header: 'Other',
              numeric: true,
              render: (row) => formatAmount(row.expenses_total),
            },
            {
              key: 'hardware_total',
              header: 'Hardware',
              numeric: true,
              render: (row) => formatAmount(row.hardware_total),
            },
            {
              key: 'total',
              header: 'Total',
              numeric: true,
              render: (row) => formatAmount(row.total),
            },
            {
              key: 'average_per_job',
              header: 'Per job',
              numeric: true,
              render: (row) => formatAmount(row.average_per_job),
            },
          ]}
          tableRows={rowsForChart}
        >
          <StackedBar
            data={rowsForChart}
            xKey="label"
            stackKeys={STACK}
            layout="vertical"
            formatValue={formatAmount}
          />
        </ChartFrame>
      )}
    </div>
  );
}
