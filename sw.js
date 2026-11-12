// 設備管家 service worker: network first, cached copy when offline.
const CACHE = 'sg-v1.2.1';
const CORE = ['./', 'index.html', 'css/style.css?v=1.2.1', 'js/vendor/qrcode.js?v=1.2.1', 'js/core.js?v=1.2.1', 'js/ui.js?v=1.2.1',
  'js/pages-equipment.js?v=1.2.1', 'js/pages-more.js?v=1.2.1', 'js/media.js?v=1.2.1', 'js/pages-ops.js?v=1.2.1', 'js/app.js?v=1.2.1', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: false }).then((r) => r || caches.match('index.html'))));
});
