import { lazy, Suspense } from 'react';

// Recharts is around 450 kB. Loading it in the main bundle would mean every
// warehouse operator downloads a charting library to look at a stock table, so
// the mark components are code-split behind these wrappers. Import from here,
// not from ./marks, anywhere outside a report that is itself already lazy.
function lazyMark(name) {
  const Component = lazy(() => import('./marks').then((module) => ({ default: module[name] })));
  return function LazyMark(props) {
    return (
      <Suspense
        fallback={
          <div
            style={{ height: props.height ?? 240, display: 'grid', placeItems: 'center', color: 'var(--text-2)', fontSize: 12 }}
          >
            Loading chart…
          </div>
        }
      >
        <Component {...props} />
      </Suspense>
    );
  };
}

export const TrendLine = lazyMark('TrendLine');
export const RankedBar = lazyMark('RankedBar');
export const StackedBar = lazyMark('StackedBar');
export const SeverityBar = lazyMark('SeverityBar');
