import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { label } from '../lib/constants';

// Grouped so the nav reads as the job, not as the API surface.
const NAV = [
  {
    title: 'Operations',
    links: [
      { to: '/', text: 'Overview', end: true },
      { to: '/work-orders', text: 'Jobs' },
      { to: '/premises', text: 'Premises' },
    ],
  },
  {
    title: 'Stock',
    links: [
      { to: '/locations', text: 'Locations' },
      { to: '/stock/overview', text: 'Stock on hand', roles: ['warehouse_staff', 'pm'] },
      { to: '/stock/receive', text: 'Receive stock', roles: ['warehouse_staff', 'pm'] },
      { to: '/stock/transfer', text: 'Transfer stock', roles: ['warehouse_staff', 'pm'] },
      { to: '/restock', text: 'Restock queue', roles: ['warehouse_staff', 'pm'] },
    ],
  },
  {
    title: 'Catalog',
    links: [
      { to: '/items', text: 'Items' },
      { to: '/services', text: 'Services' },
    ],
  },
  {
    title: 'Reports',
    links: [
      { to: '/reports/low-stock', text: 'Low stock', roles: ['warehouse_staff', 'pm'] },
      { to: '/reports/consumption', text: 'Consumption', roles: ['warehouse_staff', 'pm'] },
      { to: '/reports/tech-activity', text: 'Tech activity', roles: ['warehouse_staff', 'pm'] },
      { to: '/reports/installations', text: 'Installations', roles: ['warehouse_staff', 'pm'] },
      { to: '/reports/services', text: 'Services', roles: ['warehouse_staff', 'pm'] },
      { to: '/reports/job-costs', text: 'Job costs', roles: ['warehouse_staff', 'pm'] },
    ],
  },
  {
    title: 'Admin',
    links: [{ to: '/users', text: 'Users', roles: ['pm'] }],
  },
];

export function AppShell() {
  const { user, signOut, hasRole } = useAuth();
  const location = useLocation();
  // Below 900px the sidebar becomes an off-canvas drawer; this is only read there.
  const [navOpen, setNavOpen] = useState(false);

  // Picking a link, or any other navigation, should reveal the page.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const groups = NAV.map((group) => ({
    ...group,
    links: group.links.filter((link) => !link.roles || hasRole(...link.roles)),
  })).filter((group) => group.links.length > 0);

  return (
    <div className="shell">
      <nav id="main-nav" className={`sidenav ${navOpen ? 'open' : ''}`.trim()} aria-label="Main">
        <div className="brand">
          FTTH Inventory
          <div className="sub">Field ops</div>
        </div>
        <div className="trace" />
        {groups.map((group) => (
          <div className="nav-group" key={group.title}>
            <div className="section-label">{group.title}</div>
            {group.links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`.trim()}
              >
                {link.text}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      {navOpen ? (
        <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
      ) : null}

      <div className="main">
        <div className="topbar">
          <button
            type="button"
            className="icon-btn nav-toggle"
            aria-label="Menu"
            aria-controls="main-nav"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <div className="topbar-title">
            <div className="eyebrow">Warehouse dashboard</div>
            <h1>FTTH field inventory</h1>
          </div>
          <div className="topbar-actions">
            <div className="who">
              <strong>{user?.name}</strong>
              {label(user?.role)}
              {user?.assigned_location_name ? ` · ${user.assigned_location_name}` : ''}
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
