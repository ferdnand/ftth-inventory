import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler } from '../lib/api';
import { getToken, setToken, clearToken } from './tokenStore';
import { AuthContext } from './AuthContext';

// Three states, not a boolean: `bootstrapping` is what stops a hard reload from
// flashing the login page before the stored token has been checked.
const BOOTSTRAPPING = 'bootstrapping';
const AUTHENTICATED = 'authenticated';
const ANONYMOUS = 'anonymous';

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(getToken() ? BOOTSTRAPPING : ANONYMOUS);
  const [user, setUser] = useState(null);

  const signOut = useCallback(() => {
    clearToken();
    queryClient.clear();
    setUser(null);
    setStatus(ANONYMOUS);
  }, [queryClient]);

  // Any 401 from anywhere ends the session once, centrally, instead of every
  // caller having to notice.
  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
    return () => setUnauthorizedHandler(() => {});
  }, [signOut]);

  useEffect(() => {
    if (status !== BOOTSTRAPPING) return;
    let cancelled = false;

    api
      .me()
      .then(({ user: me }) => {
        if (cancelled) return;
        setUser(me);
        setStatus(AUTHENTICATED);
      })
      .catch(() => {
        if (!cancelled) signOut();
      });

    return () => {
      cancelled = true;
    };
  }, [status, signOut]);

  const signIn = useCallback(
    async (email, password) => {
      const { token, user: me } = await api.login(email, password);
      setToken(token);
      setUser(me);
      setStatus(AUTHENTICATED);
      return me;
    },
    []
  );

  const value = useMemo(
    () => ({
      status,
      user,
      signIn,
      signOut,
      isBootstrapping: status === BOOTSTRAPPING,
      isAuthenticated: status === AUTHENTICATED,
      // Role gating in the client is UX, not security — the API enforces roles
      // server-side. Hiding a nav link the API would reject anyway just avoids
      // showing someone a dead end.
      //
      // An admin satisfies every check without being listed in one, mirroring
      // requireRole() in the API. Listing 'admin' at each call site instead
      // would mean an admin silently losing a screen the moment someone adds
      // one and forgets.
      hasRole: (...roles) =>
        Boolean(user && (user.role === 'admin' || roles.includes(user.role))),
    }),
    [status, user, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
