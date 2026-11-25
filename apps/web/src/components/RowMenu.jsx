import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// The three-dots menu at the end of a table row.
//
// items: [{ label, onSelect, danger?, disabled?, hidden? }]
//
// The popover is portalled to <body> and positioned from the button's rect.
// Rendered inside the table it would be clipped by the table wrapper's
// horizontal scroll, which is exactly where the last rows' menus would open.
export function RowMenu({ items, label = 'Row actions' }) {
  const visible = items.filter((item) => !item.hidden);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  const close = () => setPos(null);

  function toggle(event) {
    // The row itself is often clickable; the menu must not trigger it.
    event.stopPropagation();
    if (pos) return close();
    const rect = buttonRef.current.getBoundingClientRect();
    // Open upward when there is no room below, so the last row's menu is not cut off.
    const estimatedHeight = visible.length * 38 + 12;
    const openUp = rect.bottom + estimatedHeight > window.innerHeight;
    setPos({
      right: window.innerWidth - rect.right,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }

  useEffect(() => {
    if (!pos) return undefined;
    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    // A fixed-position popover would drift away from its row on scroll or resize.
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn row-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(pos)}
        onClick={toggle}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {pos
        ? createPortal(
            <div ref={menuRef} className="row-menu" role="menu" style={pos}>
              {visible.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={`row-menu-item ${item.danger ? 'danger' : ''}`.trim()}
                  disabled={item.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    close();
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
