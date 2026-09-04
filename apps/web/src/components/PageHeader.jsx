export function PageHeader({ eyebrow, title, sub, actions }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 18,
      }}
    >
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2 style={{ fontSize: 18 }}>{title}</h2>
        {sub ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4 }}>{sub}</div>
        ) : null}
      </div>
      {actions ? <div className="btn-row">{actions}</div> : null}
    </div>
  );
}
