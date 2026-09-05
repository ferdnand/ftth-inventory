import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { label } from '../lib/constants';

// Grouped so the nav reads as the job, not as the API surface.
const NAV = [
  {
    title: 'Operations',
    links: [
      { to: '/', text: 'Overview', end: true },
      { to: '/work-orders', text: 'Work orders' },
      { to: '/premises', text: 'Premises' },
    ],
  },
  {
    title: 'Stock',
    links: [
      { to: '/locations', text: 'Locations' },
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
    ],
  },
  {
    title: 'Admin',
    links: [{ to: '/users', text: 'Users', roles: ['pm'] }],
  },
];

export function AppShell() {
  const { user, signOut, hasRole } = useAuth();

  const groups = NAV.map((group) => ({
    ...group,
    links: group.links.filter((link) => !link.roles || hasRole(...link.roles)),
  })).filter((group) => group.links.length > 0);

  return (
    <div className="shell">
      <nav className="sidenav" aria-label="Main">
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

      <div className="main">
        <div className="topbar">
          <div>
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
