// One service worker for two jobs, both on every page of the site:
// 1. Makes the site cross-origin isolated by adding COOP/COEP headers to every response it serves. The
//    multi-threaded engine needs SharedArrayBuffer, which browsers only allow on isolated pages, and GitHub
//    Pages cannot send these headers itself.
// 2. Makes the site installable and usable offline (PWA): the app shell is cached under the release version,
//    which js/main.js passes as ?v= when it registers this file. A new release installs a new cache and
//    drops the old ones.
// Requests to other origins (the engine gate) and the engine files are left alone: the gate sends CORS and CORP
// headers itself, and the engine must not be kept offline (it is served only against a token).

'use strict';

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `gomoku-board-${VERSION}`;
const SHELL = [
  './', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'css/style.css', ...['icons', 'i18n', 'contrast', 'coords', 'settings', 'game', 'security', 'storage', 'importers', 'explain', 'board',
    'engine', 'engine-panel', 'explain-panel', 'security-panel', 'voice-lexicon', 'voice', 'voice-panel', 'search', 'commands', 'search-panel', 'install', 'slider', 'main'].map((n) => `js/${n}.js`),
].map((u) => (/\.(css|js)$/.test(u) ? `${u}?v=${VERSION}` : u));

self.addEventListener('install', (e) => {
  // Best effort: a missing file must not stop the new worker from taking over.
  e.waitUntil(caches.open(CACHE).then((cache) => Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gomoku-board-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

function isolated(res) {
  if (res.status === 0) return res; // opaque response: headers cannot be changed
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// Cached copies are stored as the network sent them; the isolation headers are added on the way out.
async function respond(req, url) {
  const cache = await caches.open(CACHE);
  if (req.mode === 'navigate') {
    // Pages are revalidated on every visit so a new release shows up at once; offline falls back to the cache.
    try {
      const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) cache.put('./', res.clone());
      return isolated(res);
    } catch (err) {
      const hit = await cache.match('./');
      if (hit) return isolated(hit);
      throw err;
    }
  }
  const cacheable = !url.pathname.includes('/engine/') && !url.pathname.endsWith('/allowed-keys.json');
  if (cacheable) {
    // Versioned assets (?v=) never change, so a cached copy is final.
    const hit = await cache.match(req);
    if (hit) return isolated(hit);
  }
  const res = await fetch(req);
  if (cacheable && res.ok && req.method === 'GET') cache.put(req, res.clone());
  return isolated(res);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  e.respondWith(respond(req, url));
});
