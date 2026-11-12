/* EPM.sync — optional cloud sync through a Google Apps Script web app.
 *
 * Every synced collection (see EPM.storage.SYNCED) is a list of records with
 * an `id`. Local edits are detected by diffing each write (onLocalWrite) and
 * queued in an outbox; syncNow() uploads the outbox and downloads every
 * record the server changed since our cursor. Conflicts are last-writer-wins
 * by edit time, per record. Backend: cloud/Code.gs.
 */
(function () {
  const S = EPM.storage;
  const BATCH_MAX_RECORDS = 40;
  const BATCH_MAX_CHARS = 2500000;
  const AUTO_INTERVAL_MS = 30000;

  const state = { status: 'off', message: '', lastSync: 0 };
  let running = null;
  let rerun = false;
  let timer = null;
  let started = false;

  function config() { return S.read(S.KEYS.syncConfig, null) || { url: '', key: '', enabled: false }; }
  function saveConfig(c) { S.write(S.KEYS.syncConfig, c); }
  function meta() {
    const m = S.read(S.KEYS.syncMeta, null) || {};
    if (typeof m.cursor !== 'number') m.cursor = 0;
    if (!m.outbox || typeof m.outbox !== 'object') m.outbox = {};
    return m;
  }
  function saveMeta(m) { S.write(S.KEYS.syncMeta, m); }
  function isEnabled() { const c = config(); return !!(c.enabled && c.url && c.key); }
  function pendingCount() { return Object.keys(meta().outbox).length; }

  function setState(status, message) {
    state.status = status;
    state.message = message || '';
    if (window.EPM.app && window.EPM.app.updateSyncChip) window.EPM.app.updateSyncChip();
  }

  /* ---------- change tracking ---------- */
  function onLocalWrite(collection, oldRaw, newVal) {
    if (!isEnabled()) return;
    let oldArr = [];
    try { oldArr = oldRaw ? JSON.parse(oldRaw) : []; } catch (e) { oldArr = []; }
    if (!Array.isArray(oldArr)) oldArr = [];
    const newArr = Array.isArray(newVal) ? newVal : [];
    const oldMap = new Map();
    oldArr.forEach(r => { if (r && r.id) oldMap.set(r.id, JSON.stringify(r)); });
    const m = meta();
    const now = Date.now();
    let changed = false;
    const seen = new Set();
    newArr.forEach(r => {
      if (!r || !r.id) return;
      seen.add(r.id);
      if (oldMap.get(r.id) !== JSON.stringify(r)) {
        m.outbox[collection + '|' + r.id] = { c: collection, id: r.id, ts: now, deleted: false };
        changed = true;
      }
    });
    // The activity log is capped locally (oldest entries roll off), which
    // must not delete them for everyone, so it is append-only in the cloud.
    if (collection !== 'activity') {
      oldMap.forEach((_, id) => {
        if (!seen.has(id)) { m.outbox[collection + '|' + id] = { c: collection, id, ts: now, deleted: true }; changed = true; }
      });
    }
    if (changed) {
      saveMeta(m);
      if (state.status === 'idle') setState('idle');
      schedule(1500);
    }
  }

  function queueEverything(m) {
    const now = Date.now();
    Object.keys(S.SYNCED).forEach(c => {
      (S.read(S.SYNCED[c], []) || []).forEach(r => {
        if (r && r.id) m.outbox[c + '|' + r.id] = { c, id: r.id, ts: now, deleted: false };
      });
    });
  }

  /* ---------- transport ---------- */
  async function call(payload, cfg) {
    cfg = cfg || config();
    let res;
    try {
      res = await fetch(cfg.url, {
        method: 'POST',
        // text/plain keeps this a "simple" request: Apps Script can't answer
        // a CORS preflight.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, key: cfg.key }),
        redirect: 'follow'
      });
    } catch (e) {
      const err = new Error('無法連線到雲端（請確認網路連線與後端網址）');
      err.code = 'NETWORK';
      throw err;
    }
    if (!res.ok) throw new Error('雲端回應錯誤 HTTP ' + res.status);
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch (e) {
      throw new Error('雲端回應格式錯誤，請確認網址是 Apps Script「網頁應用程式」的 /exec 網址，且存取權為「所有人」');
    }
    if (!j.ok) {
      const err = new Error(j.message || j.error || '雲端同步失敗');
      err.code = j.error;
      throw err;
    }
    return j;
  }

  /* ---------- apply downloaded records ---------- */
  function applyRows(rows, m) {
    const arrays = {};
    const touched = {};
    let count = 0;
    (rows || []).forEach(row => {
      if (!S.SYNCED[row.c]) return;
      const k = row.c + '|' + row.id;
      const pending = m.outbox[k];
      if (pending && pending.ts > row.ts) return; // our newer local edit wins; it is uploaded next
      if (pending) delete m.outbox[k];
      const arr = arrays[row.c] || (arrays[row.c] = S.read(S.SYNCED[row.c], []) || []);
      const idx = arr.findIndex(r => r && r.id === row.id);
      if (row.deleted) {
        if (idx >= 0) { arr.splice(idx, 1); touched[row.c] = true; count++; }
      } else if (row.data) {
        if (idx >= 0) {
          if (JSON.stringify(arr[idx]) !== JSON.stringify(row.data)) { arr[idx] = row.data; touched[row.c] = true; count++; }
        } else { arr.push(row.data); touched[row.c] = true; count++; }
      }
    });
    Object.keys(touched).forEach(c => {
      let arr = arrays[c];
      if (c === 'activity') arr = arr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 300);
      S.write(S.SYNCED[c], arr, { fromSync: true });
    });
    return count;
  }

  /* ---------- sync loop ---------- */
  async function runSync() {
    let applied = 0;
    for (let guard = 0; guard < 500; guard++) {
      const m = meta();
      const entries = Object.values(m.outbox).sort((a, b) => a.ts - b.ts);
      const batch = [];
      let chars = 0;
      const cache = {};
      for (const e of entries) {
        if (!S.SYNCED[e.c]) continue;
        const arr = cache[e.c] || (cache[e.c] = S.read(S.SYNCED[e.c], []) || []);
        const rec = e.deleted ? null : arr.find(r => r && r.id === e.id);
        const size = rec ? JSON.stringify(rec).length : 80;
        if (batch.length && (batch.length >= BATCH_MAX_RECORDS || chars + size > BATCH_MAX_CHARS)) break;
        const ch = { c: e.c, id: e.id, ts: e.ts, deleted: !rec };
        if (rec) ch.data = rec;
        batch.push(ch);
        chars += size;
      }
      const res = await call({ action: 'sync', since: m.cursor, changes: batch });
      const m2 = meta();
      const before = JSON.stringify(m2);
      batch.forEach(ch => {
        const k = ch.c + '|' + ch.id;
        if (m2.outbox[k] && m2.outbox[k].ts === ch.ts) delete m2.outbox[k];
      });
      applied += applyRows(res.rows, m2);
      if (typeof res.cursor === 'number') m2.cursor = res.cursor;
      delete m2.lastSync;
      // An idle poll changes nothing; skip the write (on the desktop every
      // write also rewrites the whole data file).
      if (JSON.stringify(m2) !== before) saveMeta(m2);
      if (!res.more && !Object.keys(m2.outbox).length) break;
      if (!res.more && !batch.length) break;
    }
    return applied;
  }

  function syncNow() {
    if (!isEnabled()) { setState('off'); return Promise.resolve({ skipped: true }); }
    if (running) { rerun = true; return running; }
    setState('syncing');
    running = (async () => {
      let applied = 0;
      try {
        do {
          rerun = false;
          applied += await runSync();
        } while (rerun);
        state.lastSync = Date.now();
        setState('idle');
      } catch (e) {
        console.error('雲端同步失敗', e);
        setState(e.code === 'NETWORK' || e.code === 'BUSY' ? 'offline' : 'error', e.message);
      } finally {
        running = null;
      }
      if (applied && window.EPM.app && window.EPM.app.onRemoteChange) window.EPM.app.onRemoteChange();
      return { applied };
    })();
    return running;
  }

  function schedule(delay) {
    if (!isEnabled()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; syncNow(); }, delay || 0);
  }

  function start() {
    if (!started) {
      started = true;
      setInterval(() => { if (isEnabled() && document.visibilityState !== 'hidden') syncNow(); }, AUTO_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(300); });
      window.addEventListener('online', () => schedule(300));
    }
    if (isEnabled()) return syncNow();
    setState('off');
    return Promise.resolve({ skipped: true });
  }

  /* ---------- connect / disconnect ---------- */
  function normalizeUrl(url) { return String(url || '').trim(); }

  async function test(url, key) {
    return call({ action: 'ping' }, { url: normalizeUrl(url), key: String(key || '') });
  }

  // Records in the cloud, not counting the activity log.
  function cloudRecordCount(info) {
    const counts = (info && info.counts) || {};
    return Object.keys(counts).filter(c => c !== 'activity').reduce((t, c) => t + (counts[c] || 0), 0);
  }

  // mode 'merge': keep this device's data and upload all of it.
  // mode 'replace': discard this device's synced data and take the cloud's.
  async function connect(url, key, mode) {
    url = normalizeUrl(url);
    key = String(key || '');
    if (!url || !key) throw new Error('請輸入後端網址與同步密碼');
    const info = await test(url, key);
    const m = { cursor: 0, outbox: {} };
    if (mode === 'replace') {
      Object.keys(S.SYNCED).forEach(c => S.write(S.SYNCED[c], [], { fromSync: true }));
    } else {
      queueEverything(m);
    }
    saveMeta(m);
    saveConfig({ url, key, enabled: true });
    EPM.auth.logActivity('啟用雲端同步', '-', mode === 'replace' ? '以雲端資料取代本機' : '合併本機資料上傳');
    await syncNow();
    if (state.status === 'error' || state.status === 'offline') throw new Error(state.message);
    return info;
  }

  function disable() {
    const c = config();
    saveConfig({ ...c, enabled: false });
    if (timer) { clearTimeout(timer); timer = null; }
    setState('off');
  }

  // A link that sets this device up for sync when opened (e.g. scanned as a
  // QR code from a phone). The key travels in the URL fragment, which the
  // browser never sends to the web server.
  function encodeConnect(url, key) {
    const json = JSON.stringify({ u: url, k: key });
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeConnect(token) {
    try {
      let b = String(token || '').replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const o = JSON.parse(decodeURIComponent(escape(atob(b))));
      return o && o.u && o.k ? { url: o.u, key: o.k } : null;
    } catch (e) { return null; }
  }
  function connectLink() {
    const c = config();
    if (!c.url || !c.key) return '';
    return EPM.labels.baseUrl() + '#/connect/' + encodeConnect(c.url, c.key);
  }

  window.EPM.sync = {
    state, config, isEnabled, pendingCount, onLocalWrite, syncNow, schedule, start,
    test, connect, disable, connectLink, decodeConnect, cloudRecordCount
  };
})();
