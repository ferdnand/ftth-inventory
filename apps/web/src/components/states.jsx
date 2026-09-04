// The four states every screen needs. The mockup shows only the populated
// happy path, so these exist to stop 20 screens each inventing their own.

export function LoadingRows({ rows = 4, label = 'Loading' }) {
  return (
    <div className="table-wrap" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i} style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Could not load this' }) {
  return (
    <div className="error-state" role="alert">
      <h3>{title}</h3>
      {/* Every API failure carries a { error } sentence written for a person,
        * so showing it directly is better than a generic apology. */}
      <p>{error?.message ?? 'Something went wrong.'}</p>
      {onRetry ? (
        <button type="button" className="btn-secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
