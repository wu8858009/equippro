// 設備管家 PRO service worker:
//  - network first, cached copy when offline
//  - background check (Periodic Background Sync, Android installed app) for new repairs + daily to-do
//  - tapping a notification opens the right page
const V = '1.5.1';
const CACHE = 'sg-v' + V;
const CORE = ['./', 'index.html', 'css/style.css', 'css/pro.css', 'js/vendor/qrcode.js', 'js/core.js', 'js/ui.js', 'js/media.js',
  'js/pages-equipment.js', 'js/pages-more.js', 'js/pages-ops.js', 'js/scanner.js', 'js/notify.js', 'js/app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'].map((f) => (/\.(js|css)$/.test(f) ? f + '?v=' + V : f));

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

// ---------------------------------------------------------------- IndexedDB (same store as the page)
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('shebei-guanjia', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((resolve, reject) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
}
async function kvSet(k, v) {
  const db = await idb();
  return new Promise((resolve, reject) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const notify = (title, body, url, tag) => self.registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag, data: { url } });

// ---------------------------------------------------------------- background check
async function bgCheck() {
  const s = (await kvGet('sg_bgstate')) || {};
  if (!s.enabled || !s.url || !s.key) return;
  // If the app is open it does this itself.
  const open = await self.clients.matchAll({ type: 'window' });
  if (open.some((c) => c.visibilityState === 'visible')) return;

  let snapshot = {};
  try { snapshot = JSON.parse((await kvGet('sg_db')) || '{}'); } catch (e) { snapshot = {}; }
  const eqName = (id) => { const e = snapshot.equipment && snapshot.equipment[id]; return e && !e.deleted ? e.name : '設備'; };

  // New records since the last revision this device has seen (nothing is written back to the data).
  let res;
  try {
    const r = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'sync', key: s.key, since: s.rev || 0, changes: [] }) });
    res = await r.json();
  } catch (e) { return; }
  if (!res || !res.ok) return;
  const fresh = [], done = [];
  (res.rows || []).forEach((row) => {
    if (row.c !== 'repairs' || row.d) return;
    let rec; try { rec = JSON.parse(row.j); } catch (e) { return; }
    if (rec.reporterId !== s.me && (rec.status === '待處理' || rec.status === '處理中') && rec.reportedAt > (s.lastRepair || 0)) fresh.push(rec);
    if (rec.reporterId === s.me && rec.status === '已完成' && (rec.doneAt || 0) > (s.lastDone || 0)) done.push(rec);
  });
  if (fresh.length) {
    const urgent = fresh.filter((r) => r.urgency === '緊急').length;
    await notify(`${urgent ? '🚨' : '🧰'} 新的報修 ${fresh.length} 件${urgent ? `（緊急 ${urgent}）` : ''}`,
      fresh.slice(0, 3).map((r) => `${eqName(r.equipmentId)}：${r.title}（${r.reporter || ''}）`).join('\n'),
      fresh.length === 1 ? '#/repair/' + fresh[0].id : '#/repairs', 'sg-repair');
    s.lastRepair = Math.max(s.lastRepair || 0, ...fresh.map((r) => r.reportedAt || 0));
  }
  if (done.length) {
    await notify('✅ 你報修的設備已處理完成', done.slice(0, 3).map((r) => `${eqName(r.equipmentId)}：${r.title}`).join('\n'), '#/repair/' + done[0].id, 'sg-done');
    s.lastDone = Math.max(s.lastDone || 0, ...done.map((r) => r.doneAt || 0));
  }
  s.rev = res.rev;

  // Daily to-do from the last copy of the data on this device.
  const today = ymd(new Date());
  if (s.digestDate !== today && new Date().getHours() >= 7 && snapshot.plans) {
    const plans = Object.values(snapshot.plans).filter((p) => p && !p.deleted && p.active && p.nextDue && p.nextDue <= today);
    const overdue = plans.filter((p) => p.nextDue < today).length;
    const openRepairs = Object.values(snapshot.repairs || {}).filter((r) => r && !r.deleted && (r.status === '待處理' || r.status === '處理中')).length;
    const parts = [];
    if (plans.length) parts.push(`保養 ${plans.length} 項${overdue ? `（逾期 ${overdue}）` : ''}`);
    if (openRepairs) parts.push(`未完成報修 ${openRepairs} 件`);
    if (parts.length) await notify('📋 今日待辦', parts.join('、'), plans.length ? '#/maint' : '#/repairs', 'sg-digest');
    s.digestDate = today;
  }
  await kvSet('sg_bgstate', s);
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'sg-bg') e.waitUntil(bgCheck().catch(() => {}));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '#/dash';
  const target = new URL('./index.html' + hash, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) { c.navigate(target).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
