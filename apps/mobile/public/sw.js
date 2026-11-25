// Service worker for the FTTH Field PWA.
//
// What it is for: making the app SHELL (HTML, JS bundle, fonts, icons) load
// without a network, so a tech who opens the app in a dead spot gets the app
// rather than the browser's "no internet" page. It is NOT an offline data layer
// — jobs, stock and every write still need the API. See PROCESS.md.
//
// Strategy:
//   /api/*                  never touched. A cached API response would show a
//                           tech stale stock as if it were current, and a cached
//                           failure would outlive the outage.
//   navigations (HTML)      network first, cached shell as the fallback. Network
//                           first means a deploy is picked up on the next open.
//   /_expo/static, /assets  cache first. Metro content-hashes these filenames, so
//                           a cached copy can never be the wrong version.
//   anything else           left to the browser.
//
// Bump VERSION only if this file's own caching rules change; app deploys do not
// need it.
const VERSION = 'v1';
const SHELL_CACHE = `ftth-shell-${VERSION}`;
const ASSET_CACHE = `ftth-assets-${VERSION}`;

self.addEventListener('install', (event) => {
  // Cache the shell up front so the very first offline launch works, not just
  // the second. A failure here must not block installation.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add('/'))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Cross-origin means the API on another host (EXPO_PUBLIC_API_URL) or a CDN.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Single-page app: every route is the same index.html, so cache it
          // under '/' rather than per-URL.
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  if (url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});
