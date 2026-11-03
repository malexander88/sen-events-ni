// v1.9.1 offline support for the web version (GitHub Pages). The Android app loads from its own bundled files instead.
const SHELL = 'oa-shell-v2.0.1', DATA = 'oa-data-v1';
const ASSETS = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'favicon.png', 'apple-touch-icon.png', 'events.json', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== DATA && k.startsWith('oa-')).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  // data files: network first, fall back to the last good copy
  if (/\/events\.json$/.test(u.pathname)) {
    const key = u.origin + u.pathname;
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(key, copy)); } return res; })
      .catch(() => caches.open(DATA).then(c => c.match(key)).then(r => r || caches.match(req, { ignoreSearch: true }))
        .then(r => r ? r.blob().then(body => new Response(body, { headers: { 'Content-Type': 'application/json', 'X-OA-Offline': '1' } })) : Response.error())));
    return;
  }
  if (u.origin !== location.origin) return; // map tiles etc. go straight to the network
  // app files: cached copy at once, refreshed in the background
  e.respondWith(caches.open(SHELL).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit || (req.mode === 'navigate' ? c.match('index.html') : Response.error()));
    return hit || net;
  })));
});
