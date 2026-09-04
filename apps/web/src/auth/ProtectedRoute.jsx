import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { isBootstrapping, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return <div className="full-loader">Restoring your session…</div>;
  }
  if (!isAuthenticated) {
    // Remember where they were headed so signing in lands them there.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}

export function RoleRoute({ roles }) {
  const { hasRole } = useAuth();

  if (!hasRole(...roles)) {
    return (
      <div className="page">
        <div className="error-state">
          <h3>Not available for your role</h3>
          <p>
            This section is limited to {roles.join(' and ')}. Ask a project manager if you
            need access.
          </p>
        </div>
      </div>
    );
  }
  return <Outlet />;
}
