import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { TextInput } from '../components/fields';

export function LoginPage() {
  const { signIn, isAuthenticated, isBootstrapping } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (isBootstrapping) return <div className="full-loader">Restoring your session…</div>;
  if (isAuthenticated) return <Navigate to={location.state?.from?.pathname ?? '/'} replace />;

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate(location.state?.from?.pathname ?? '/', { replace: true });
    } catch (err) {
      // The API returns one message for a wrong email and a wrong password
      // alike, deliberately — showing it verbatim keeps that property.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="trace" />
        <div className="body">
          <h1>FTTH Inventory</h1>
          <p className="lead">Warehouse and field operations</p>

          {error ? (
            <div className="banner" role="alert">
              {error}
            </div>
          ) : null}

          <form onSubmit={onSubmit}>
            <TextInput
              id="email"
              label="Email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              value={email}
              onChange={setEmail}
              placeholder="you@ftth.local"
              required
            />
            <TextInput
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
            />
            <button type="submit" className="btn-primary btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="login-hint">
            Seeded development accounts: <span className="mono">grace.njeri@ftth.local</span>{' '}
            (warehouse), <span className="mono">peter.mwangi@ftth.local</span> (manager),{' '}
            <span className="mono">john.kamau@ftth.local</span> (field tech). Password{' '}
            <span className="mono">ftth-dev-password</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
