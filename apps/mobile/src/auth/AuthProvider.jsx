import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler } from '../api/client';
import { getToken, setToken, clearToken } from './tokenStore';

const AuthContext = createContext(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider');
  return value;
}

// Three states, not a boolean. Reading the token from SecureStore is async, so
// there is a real window on launch where we do not yet know whether the tech is
// signed in — showing the login screen during it would flash for every user
// every time.
const BOOTSTRAPPING = 'bootstrapping';
const AUTHENTICATED = 'authenticated';
const ANONYMOUS = 'anonymous';

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(BOOTSTRAPPING);
  const [user, setUser] = useState(null);

  const signOut = useCallback(async () => {
    await clearToken();
    queryClient.clear();
    setUser(null);
    setStatus(ANONYMOUS);
  }, [queryClient]);

  // Any 401 anywhere ends the session once, centrally.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      signOut();
    });
    return () => setUnauthorizedHandler(() => {});
  }, [signOut]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getToken();
      if (cancelled) return;
      if (!token) {
        setStatus(ANONYMOUS);
        return;
      }
      try {
        const { user: me } = await api.me();
        if (cancelled) return;
        setUser(me);
        setStatus(AUTHENTICATED);
      } catch {
        if (!cancelled) {
          await clearToken();
          setStatus(ANONYMOUS);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { token, user: me } = await api.login(email, password);
    await setToken(token);
    setUser(me);
    setStatus(AUTHENTICATED);
    return me;
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      signIn,
      signOut,
      isBootstrapping: status === BOOTSTRAPPING,
      isAuthenticated: status === AUTHENTICATED,
    }),
    [status, user, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
