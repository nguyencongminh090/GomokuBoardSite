// Makes the site cross-origin isolated by adding COOP/COEP headers to every response it serves.
// The multi-threaded engine needs SharedArrayBuffer, which browsers only allow on isolated pages, and
// GitHub Pages cannot send these headers itself. js/engine-panel.js registers this worker only when
// the host turns on multi-threading, then reloads the page once so the page itself comes through it.
// The site loads nothing from other origins, so require-corp blocks nothing it uses.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  // Pages are revalidated on every visit, so a new release (new ?v= asset URLs) shows up at once.
  const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req);
  e.respondWith(fresh.then((res) => {
    if (res.status === 0) return res; // opaque response: headers cannot be changed
    const headers = new Headers(res.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }));
});
