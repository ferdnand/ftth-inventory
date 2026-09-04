import { useMemo } from 'react';
import { useInstallationTrends } from '../../hooks/useData';
import { ChartFrame, ChartLegend } from '../../charts/ChartFrame';
import { StackedBar, TrendLine } from '../../charts/marks';
import { REMOVAL_REASON_COLORS } from '../../charts/chartTheme';
import { EmptyState, ErrorState, LoadingRows } from '../../components/states';
import { PageHeader } from '../../components/PageHeader';
import { ReportFilters, useReportRange } from './ReportFilters';
import { REMOVAL_REASONS, label } from '../../lib/constants';
import { formatMonth } from '../../lib/format';

const REASON_SERIES = REMOVAL_REASONS.map((reason) => ({
  value: reason,
  label: label(reason),
}));

export function InstallationTrendsReportPage() {
  const range = useReportRange('90');
  const interval = range.params.get('interval') ?? 'week';

  const trends = useInstallationTrends({
    from: range.from ?? undefined,
    to: range.to ?? undefined,
    interval,
  });

  // The API returns one row per (bucket, reason). Pivot to one row per bucket
  // with a column per reason, which is what a stacked column needs.
  const reasonRows = useMemo(() => {
    const byBucket = new Map();
    for (const row of trends.data?.removal_reasons_by_bucket ?? []) {
      const key = row.bucket;
      if (!byBucket.has(key)) {
        byBucket.set(key, {
          bucket: key,
          ...Object.fromEntries(REMOVAL_REASONS.map((r) => [r, 0])),
        });
      }
      byBucket.get(key)[row.removal_reason] = row.removals;
    }
    return [...byBucket.values()].sort((a, b) => new Date(a.bucket) - new Date(b.bucket));
  }, [trends.data]);

  const totalInstalls = (trends.data?.trends ?? []).reduce((sum, r) => sum + r.installs, 0);
  const totalRemovals = (trends.data?.trends ?? []).reduce((sum, r) => sum + r.removals, 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Installations"
        sub="Routers put into and taken out of service over time"
      />

      <ReportFilters range={range}>
        <div className="field">
          <label htmlFor="interval">Bucket</label>
          <select
            id="interval"
            value={interval}
            onChange={(e) => range.setParam('interval', e.target.value)}
          >
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
      </ReportFilters>

      <div className="stat-row">
        <div className="stat">
          <div className="num">{trends.isPending ? '—' : totalInstalls}</div>
          <div className="lbl">Installs in period</div>
        </div>
        <div className="stat">
          <div className="num">{trends.isPending ? '—' : totalRemovals}</div>
          <div className="lbl">Removals in period</div>
        </div>
      </div>

      {trends.isPending ? (
        <LoadingRows rows={6} />
      ) : trends.isError ? (
        <ErrorState error={trends.error} onRetry={trends.refetch} />
      ) : trends.data.trends.length === 0 ? (
        <EmptyState title="No installation activity in this period" />
      ) : (
        <>
          {/* Two stacked charts sharing the filter row above — deliberately not
            * one chart with two y-axes. */}
          <ChartFrame
            title="Installs over time"
            subtitle="Empty buckets are shown as zero rather than skipped, so a gap reads as a gap"
            isRefetching={trends.isRefetching}
            tableColumns={[
              { key: 'bucket', header: 'Period', render: (r) => formatMonth(r.bucket) },
              { key: 'installs', header: 'Installs', numeric: true },
            ]}
            tableRows={trends.data.trends}
          >
            <TrendLine
              data={trends.data.trends}
              xKey="bucket"
              yKey="installs"
              yName="Installs"
              formatX={formatMonth}
            />
          </ChartFrame>

          <ChartFrame
            title="Removals over time"
            isRefetching={trends.isRefetching}
            tableColumns={[
              { key: 'bucket', header: 'Period', render: (r) => formatMonth(r.bucket) },
              { key: 'removals', header: 'Removals', numeric: true },
            ]}
            tableRows={trends.data.trends}
          >
            <TrendLine
              data={trends.data.trends}
              xKey="bucket"
              yKey="removals"
              yName="Removals"
              formatX={formatMonth}
            />
          </ChartFrame>

          {reasonRows.length > 0 ? (
            <ChartFrame
              title="Why routers came out"
              subtitle="Part-to-whole across periods — the five reasons keep the same colour in every range"
              isRefetching={trends.isRefetching}
              tableColumns={[
                { key: 'bucket', header: 'Period', render: (r) => formatMonth(r.bucket) },
                ...REASON_SERIES.map((s) => ({
                  key: s.value,
                  header: s.label,
                  numeric: true,
                })),
              ]}
              tableRows={reasonRows}
            >
              <StackedBar
                data={reasonRows}
                xKey="bucket"
                stackKeys={REASON_SERIES}
                colorFor={(reason) => REMOVAL_REASON_COLORS[reason]}
                formatX={formatMonth}
              />
              <ChartLegend
                items={REASON_SERIES.map((s) => ({
                  label: s.label,
                  color: REMOVAL_REASON_COLORS[s.value],
                }))}
              />
            </ChartFrame>
          ) : (
            <EmptyState title="No removals in this period">
              Nothing has been taken out of service, so there are no reasons to break down.
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}
