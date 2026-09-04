// Token storage.
//
// localStorage, and therefore readable by any script that gets injected into
// this page. The honest tradeoff: the alternative — an httpOnly cookie —
// requires the API to set cookies, a CSRF strategy, credentials: 'include', and
// a same-site story across the Vite proxy, and does nothing at all for the
// mobile app (which uses expo-secure-store instead).
//
// The mitigations that are in place: a short token TTL (JWT_TTL, 12h by
// default), and no third-party scripts on this dashboard. Keep it that way.
const KEY = 'ftth.token';

// Reads and writes are wrapped because a private window, cleared site data, or
// a browser set to block storage makes the accessor itself throw.
export function getToken() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* session lasts until reload; nothing else to do */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
