/* 設備管家 — core: utilities, local database, accounts, activity log, cloud sync. */
(function () {
  'use strict';
  const SG = (window.SG = window.SG || {});

  // ---------------------------------------------------------------- utils
  const U = (SG.util = {});
  U.esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  U.pad = (n, w = 2) => String(n).padStart(w, '0');
  U.today = () => U.ymd(new Date());
  U.ymd = (d) => `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  U.parseDate = (s) => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  U.addInterval = (s, value, unit) => {
    const d = U.parseDate(s) || new Date();
    const v = Number(value) || 0;
    if (unit === 'day') d.setDate(d.getDate() + v);
    else if (unit === 'week') d.setDate(d.getDate() + v * 7);
    else if (unit === 'year') d.setFullYear(d.getFullYear() + v);
    else {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + v);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
    }
    return U.ymd(d);
  };
  U.daysBetween = (a, b) => {
    const da = U.parseDate(a), db = U.parseDate(b);
    if (!da || !db) return null;
    return Math.round((db - da) / 86400000);
  };
  U.num = (v) => {
    const n = Number(String(v == null ? '' : v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  U.money = (v) => 'NT$ ' + Math.round(U.num(v)).toLocaleString('zh-TW');
  U.fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${U.ymd(d)} ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
  };
  U.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  // Tax: `amount` is entered either 含稅 (incl) or 未稅 (excl) at `rate` percent.
  U.tax = (amount, mode, rate) => {
    const a = U.num(amount);
    const r = rate === '' || rate == null ? 5 : U.num(rate);
    let incl, excl;
    if (mode === 'excl') { excl = a; incl = Math.round(a * (1 + r / 100)); }
    else { incl = a; excl = Math.round(a / (1 + r / 100)); }
    return { incl, excl, tax: incl - excl, rate: r };
  };
  U.csv = (rows) => '﻿' + rows.map((r) => r.map((c) => {
    const s = String(c == null ? '' : c);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  U.download = (name, text, type = 'text/csv;charset=utf-8') => {
    const blob = new Blob([text], { type });
    if (SG.desktop && SG.desktop.saveFile) return SG.desktop.saveFile(name, text);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  // Photo → JPEG data URL, longest side ≤ maxSide, shrunk until ≤ maxChars.
  U.compressImage = (file, maxSide = 1400, maxChars = 260000) => new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('請選擇圖片檔'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let side = maxSide, q = 0.8, out = '';
      for (let i = 0; i < 8; i++) {
        const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', q);
        if (out.length <= maxChars) break;
        if (q > 0.55) q -= 0.1; else side = Math.round(side * 0.8);
      }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張圖片')); };
    img.src = url;
  });
  U.parseCsv = (text) => {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  };

  // SHA-256 in plain JS so hashes match on every device (crypto.subtle is
  // missing on plain-http LAN addresses).
  U.sha256 = function (str) {
    const bytes = new TextEncoder().encode(str);
    const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const bits = len * 8;
    m[total - 4] = bits >>> 24; m[total - 3] = bits >>> 16; m[total - 2] = bits >>> 8; m[total - 1] = bits;
    m[total - 8] = Math.floor(bits / 0x100000000);
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
  };

  // Small key/value store for per-device settings: localStorage on the web,
  // a prefs file in the desktop app (its page origin changes every launch).
  SG.store = {
    get(k) {
      if (SG.desktop) return SG.desktop.prefs[k] == null ? null : SG.desktop.prefs[k];
      try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; }
    },
    set(k, v) {
      if (SG.desktop) return SG.desktop.setPref(k, v);
      try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ }
    }
  };

  // ------------------------------------------------------------- database
  // `cards` = business-card photos, kept apart from vendors so editing a
  // vendor's phone number does not re-upload its pictures.
  // photos = equipment photos and record attachments (invoices, warranty
  // cards); repairs = repair requests; parts + stock = consumables and their
  // stock movements (stock level is the sum of movements, so it merges safely).
  const COLLECTIONS = ['users', 'equipment', 'replacements', 'quotes', 'plans', 'logs', 'vendors', 'cards', 'photos', 'repairs', 'parts', 'stock', 'activity', 'settings'];
  const DB_KEY = 'sg_db';

  // The web version keeps the database in IndexedDB (photos would overflow
  // localStorage's ~5 MB); localStorage is only the fallback/old location.
  const IDB = SG.idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('no indexedDB'));
        const req = indexedDB.open('shebei-guanjia', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => reject(req.error);
      });
    },
    async get(k) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const r = db.transaction('kv').objectStore('kv').get(k);
        r.onsuccess = () => resolve(r.result == null ? null : r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async set(k, v) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
  };
  const ACTIVITY_KEEP = 2000;
  const listeners = new Set();

  function emptyDb() {
    const d = { _dirty: {} };
    COLLECTIONS.forEach((c) => (d[c] = {}));
    return d;
  }

  const DB = (SG.db = {
    COLLECTIONS,
    data: emptyDb(),
    lastStamp: 0,
    async load(raw) {
      let d = null;
      try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { d = null; }
      if (!d || typeof d !== 'object') d = null;
      if (!d && !SG.desktop) {
        try { const s = await IDB.get(DB_KEY); d = s ? JSON.parse(s) : null; this.useIdb = true; }
        catch (e) { this.useIdb = false; }
      }
      if (!d) {
        try { d = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (e) { d = null; }
      }
      const base = emptyDb();
      if (d) COLLECTIONS.forEach((c) => (base[c] = d[c] && typeof d[c] === 'object' ? d[c] : {}));
      if (d && d._dirty) base._dirty = d._dirty;
      // The cloud revision this copy of the data has caught up to. It lives
      // inside the data (not in a separate setting) so a copy can never claim
      // to be newer than it is; data from before this existed re-reads the cloud once.
      base._rev = d && typeof d._rev === 'number' ? d._rev : 0;
      this.data = base;
      this.loaded = true;
      this.listenOtherTabs();
    },
    serialize() { return JSON.stringify(this.data); },
    _persistSoon: U.debounce(function () { DB.saveNow(); }, 250),
    // Desktop writes right away (its bridge coalesces requests) so closing the
    // window never loses the last change.
    persist() { if (SG.desktop) DB.saveNow(); else DB._persistSoon(); },
    // Merge records another tab/window of this app saved (newer wins).
    absorb(stored) {
      if (!stored || typeof stored !== 'object') return false;
      let changed = false;
      COLLECTIONS.forEach((c) => {
        const src = stored[c] || {};
        Object.keys(src).forEach((id) => {
          const r = src[id], cur = this.data[c][id];
          if (r && (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0))) {
            this.data[c][id] = r;
            if (stored._dirty && stored._dirty[c + '/' + id]) this.data._dirty[c + '/' + id] = 1;
            if (r.updatedAt > this.lastStamp) this.lastStamp = r.updatedAt;
            changed = true;
          }
        });
      });
      // Only after taking every newer record of that copy is its revision ours too.
      if (typeof stored._rev === 'number' && stored._rev > this.data._rev) this.data._rev = stored._rev;
      return changed;
    },
    _saving: Promise.resolve(),
    saveNow() {
      if (SG.desktop && SG.desktop.save) return SG.desktop.save(DB.serialize());
      const full = () => SG.ui && SG.ui.toast('儲存空間已滿，請到「設定」匯出備份後清理舊紀錄', 'error');
      const toLocal = () => { try { localStorage.setItem(DB_KEY, DB.serialize()); } catch (e) { full(); } };
      if (!this.useIdb) return toLocal();
      // Read-merge-write, one at a time, so two open tabs never overwrite each other's work.
      const replacing = DB._replacing;
      DB._replacing = false;
      DB._saving = DB._saving.then(async () => {
        if (!replacing) {
          try {
            const raw = await IDB.get(DB_KEY);
            if (raw && DB.absorb(JSON.parse(raw))) setTimeout(() => DB.changed('*'), 0);
          } catch (e) { /* unreadable copy: just overwrite */ }
        }
        await IDB.set(DB_KEY, DB.serialize());
        if (!DB._movedOut) { DB._movedOut = true; try { localStorage.removeItem(DB_KEY); } catch (e) { /* ignore */ } }
        try { if (DB._bc) DB._bc.postMessage('saved'); } catch (e) { /* ignore */ }
      }).catch(() => { DB.useIdb = false; toLocal(); });
      return DB._saving;
    },
    listenOtherTabs() {
      if (SG.desktop || this._bc || !('BroadcastChannel' in window)) return;
      try {
        this._bc = new BroadcastChannel('shebei-guanjia-db');
        this._bc.onmessage = async () => {
          try { const raw = await IDB.get(DB_KEY); if (raw && DB.absorb(JSON.parse(raw))) DB.changed('*'); } catch (e) { /* ignore */ }
        };
      } catch (e) { this._bc = null; }
    },
    stamp() {
      let t = Date.now();
      if (t <= this.lastStamp) t = this.lastStamp + 1;
      this.lastStamp = t;
      return t;
    },
    get(c, id) {
      const r = this.data[c][id];
      return r && !r.deleted ? r : null;
    },
    all(c) { return Object.values(this.data[c]).filter((r) => !r.deleted); },
    put(c, rec, opts = {}) {
      if (!rec.id) rec.id = U.uid();
      const prev = this.data[c][rec.id];
      if (!rec.createdAt) rec.createdAt = (prev && prev.createdAt) || Date.now();
      rec.updatedAt = this.stamp();
      this.data[c][rec.id] = rec;
      this.data._dirty[c + '/' + rec.id] = 1;
      if (c === 'activity') this.trimActivity();
      this.persist();
      if (!opts.quiet) this.changed(c);
      return rec;
    },
    remove(c, id) {
      const prev = this.data[c][id];
      if (!prev) return;
      this.data[c][id] = { id, deleted: true, createdAt: prev.createdAt, updatedAt: this.stamp() };
      this.data._dirty[c + '/' + id] = 1;
      this.persist();
      this.changed(c);
    },
    trimActivity() {
      const all = Object.values(this.data.activity).sort((a, b) => b.at - a.at);
      if (all.length <= ACTIVITY_KEEP + 200) return;
      all.slice(ACTIVITY_KEEP).forEach((a) => { delete this.data.activity[a.id]; delete this.data._dirty['activity/' + a.id]; });
    },
    // Incoming record from the cloud: last writer (by updatedAt) wins.
    merge(c, rec) {
      if (!COLLECTIONS.includes(c) || !rec || !rec.id) return false;
      const cur = this.data[c][rec.id];
      if (cur && (cur.updatedAt || 0) >= (rec.updatedAt || 0)) return false;
      this.data[c][rec.id] = rec;
      if (rec.updatedAt > this.lastStamp) this.lastStamp = rec.updatedAt;
      return true;
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    changed(c) { listeners.forEach((fn) => { try { fn(c); } catch (e) { console.error(e); } }); },
    replaceAll(obj) {
      const base = emptyDb();
      COLLECTIONS.forEach((c) => {
        const src = obj[c] || {};
        Object.values(src).forEach((r) => {
          if (r && r.id) { base[c][r.id] = r; base._dirty[c + '/' + r.id] = 1; }
        });
      });
      base._rev = this.data._rev || 0;
      this.data = base;
      this._replacing = true; // this write replaces the stored copy instead of merging with it
      this.saveNow();
      this.changed('*');
    },
    settings() {
      const s = this.get('settings', 'org') || {};
      return {
        orgName: s.orgName || '設備管家',
        qrBaseUrl: s.qrBaseUrl || SG.config.publicUrl,
        categories: Array.isArray(s.categories) ? s.categories : [],
        locations: Array.isArray(s.locations) ? s.locations : [],
        stores: Array.isArray(s.stores) ? s.stores : [],
        areas: Array.isArray(s.areas) ? s.areas : []
      };
    },
    saveSettings(patch) {
      const cur = this.get('settings', 'org') || { id: 'org' };
      this.put('settings', Object.assign({}, cur, patch, { id: 'org' }));
    }
  });

  // ----------------------------------------------------------- accounts
  const SESSION_KEY = 'sg_session';
  const ROLES = { admin: '管理員', editor: '編輯者', viewer: '檢視者' };
  const Auth = (SG.auth = {
    ROLES,
    current: null,
    hash(pw, salt) {
      let h = U.sha256(salt + ':' + pw);
      for (let i = 0; i < 2000; i++) h = U.sha256(h + salt);
      return h;
    },
    users() { return DB.all('users'); },
    hasUsers() { return this.users().length > 0; },
    findByName(name) {
      const n = String(name || '').trim().toLowerCase();
      return this.users().find((u) => u.username.toLowerCase() === n) || null;
    },
    createUser({ username, name, password, role }) {
      username = String(username || '').trim();
      if (!/^[A-Za-z0-9_.\-]{2,32}$/.test(username)) throw new Error('帳號只能用英文、數字、底線、點或減號，長度 2–32');
      if (this.findByName(username)) throw new Error('這個帳號已經有人使用');
      if (!password || password.length < 4) throw new Error('密碼至少 4 個字');
      const salt = U.uid() + U.uid();
      return DB.put('users', { username, name: String(name || username).trim(), role: ROLES[role] ? role : 'viewer', salt, hash: this.hash(password, salt), disabled: false });
    },
    setPassword(user, password) {
      if (!password || password.length < 4) throw new Error('密碼至少 4 個字');
      const salt = U.uid() + U.uid();
      DB.put('users', Object.assign({}, user, { salt, hash: this.hash(password, salt) }));
    },
    login(username, password, remember) {
      const u = this.findByName(username);
      if (!u || u.disabled || this.hash(password, u.salt) !== u.hash) throw new Error('帳號或密碼錯誤');
      this.current = u;
      this.saveSession(u, remember);
      SG.log('登入系統', u.name);
      return u;
    },
    saveSession(u, remember) {
      const s = { id: u.id, h: u.hash.slice(0, 16) };
      if (remember) { SG.store.set(SESSION_KEY, s); sessionStorage.removeItem(SESSION_KEY); }
      else { SG.store.set(SESSION_KEY, null); sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
    },
    remembered() { return !!SG.store.get(SESSION_KEY); },
    restore() {
      let s = null;
      try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') || SG.store.get(SESSION_KEY); } catch (e) { s = null; }
      if (!s) return null;
      const u = DB.get('users', s.id);
      // A password change elsewhere (or a disabled account) ends this session.
      if (!u || u.disabled || u.hash.slice(0, 16) !== s.h) { this.logout(); return null; }
      this.current = u;
      return u;
    },
    refresh() {
      if (!this.current) return;
      const u = DB.get('users', this.current.id);
      if (!u || u.disabled) { this.logout(); location.reload(); return; }
      this.current = u;
    },
    logout() {
      this.current = null;
      sessionStorage.removeItem(SESSION_KEY);
      SG.store.set(SESSION_KEY, null);
    },
    can(action) {
      const r = this.current ? this.current.role : null;
      if (!r) return false;
      if (action === 'admin') return r === 'admin';
      if (action === 'report') return true; // anyone signed in may file a repair request
      if (action === 'edit') return r === 'admin' || r === 'editor';
      return true;
    }
  });

  SG.log = function (action, target) {
    const u = Auth.current;
    DB.put('activity', { at: Date.now(), userId: u ? u.id : '', userName: u ? u.name : '系統', action, target: target || '' }, { quiet: true });
  };

  // --------------------------------------------------------- cloud sync
  const SYNC_KEY = 'sg_sync';
  const Sync = (SG.sync = {
    state: 'off', // off | idle | syncing | error
    message: '',
    lastAt: 0,
    timer: null,
    cfg() {
      return Object.assign({ url: SG.config.cloudUrl, key: '', rev: 0, enabled: false }, SG.store.get(SYNC_KEY) || {});
    },
    saveCfg(c) { SG.store.set(SYNC_KEY, c); },
    enabled() { const c = this.cfg(); return !!(c.enabled && c.url && c.key); },
    async call(body, url) {
      const target = url || this.cfg().url;
      if (!target) throw new Error('尚未設定雲端網址');
      let res;
      try {
        res = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
      } catch (e) { throw new Error('無法連線到雲端，請檢查網路'); }
      const text = await res.text();
      let j;
      try { j = JSON.parse(text); } catch (e) { throw new Error('雲端回應格式錯誤（網址是否正確？）'); }
      if (!j.ok) { const err = new Error(j.message || j.error || '雲端錯誤'); err.code = j.error; throw err; }
      return j;
    },
    async status(url) { return this.call({ action: 'status' }, url); },
    // Connects this device: claims an empty backend with `key`, or verifies it.
    async connect(url, key) {
      key = String(key || '').trim();
      if (key.length < 6) throw new Error('同步密碼至少 6 個字');
      const st = await this.status(url);
      if (!st.claimed) await this.call({ action: 'claim', key }, url);
      else await this.call({ action: 'sync', key, since: 0, changes: [] }, url);
      const c = this.cfg();
      const sameTarget = c.url === url && c.key === key;
      this.saveCfg({ url, key, rev: sameTarget ? c.rev : 0, enabled: true });
      // Everything local goes up (and everything remote comes down) on the first sync with a new backend.
      if (!sameTarget) { DB.data._rev = 0; COLLECTIONS.forEach((col) => Object.keys(DB.data[col]).forEach((id) => (DB.data._dirty[col + '/' + id] = 1))); }
      DB.saveNow();
      return this.syncNow();
    },
    disconnect() {
      const c = this.cfg();
      this.saveCfg(Object.assign(c, { enabled: false }));
      this.setState('off', '');
    },
    setState(s, msg) {
      this.state = s;
      this.message = msg || '';
      document.dispatchEvent(new CustomEvent('sg-sync', { detail: { state: s, message: msg } }));
    },
    running: null,
    async syncNow() {
      if (!this.enabled()) { this.setState('off'); return null; }
      if (this.running) return this.running;
      this.running = this._sync().finally(() => { this.running = null; });
      return this.running;
    },
    async _sync() {
      const c = this.cfg();
      this.setState('syncing', '同步中…');
      try {
        let pushedAll = false, guard = 0, pulled = 0;
        while (!pushedAll && guard++ < 50) {
          // Batches of up to 300 records or ~1.5 MB (photos are big).
          const sent = {};
          const changes = [];
          let bytes = 0;
          for (const k of Object.keys(DB.data._dirty)) {
            if (changes.length >= 300 || bytes > 1500000) break;
            const i = k.indexOf('/');
            const col = k.slice(0, i), id = k.slice(i + 1);
            const rec = DB.data[col] && DB.data[col][id];
            if (!rec) { delete DB.data._dirty[k]; continue; }
            const j = JSON.stringify(rec);
            sent[k] = rec.updatedAt;
            bytes += j.length;
            changes.push({ c: col, id, u: rec.updatedAt || 0, d: rec.deleted ? 1 : 0, j });
          }
          // `since` comes from the data itself (DB.data._rev), never from a separate setting.
          const res = await this.call({ action: 'sync', key: c.key, since: DB.data._rev || 0, changes });
          let touched = new Set();
          (res.rows || []).forEach((row) => {
            let rec;
            try { rec = JSON.parse(row.j); } catch (e) { return; }
            if (DB.merge(row.c, rec)) { touched.add(row.c); pulled++; }
          });
          // Only clear a dirty flag if the record was not edited again meanwhile.
          Object.keys(sent).forEach((k) => {
            const i = k.indexOf('/');
            const rec = DB.data[k.slice(0, i)][k.slice(i + 1)];
            if (rec && rec.updatedAt === sent[k]) delete DB.data._dirty[k];
          });
          DB.data._rev = res.rev;
          DB.saveNow();
          if (touched.size) { Auth.refresh(); touched.forEach((t) => DB.changed(t)); }
          pushedAll = !res.more && (Object.keys(DB.data._dirty).length === 0 || changes.length === 0);
        }
        this.lastAt = Date.now();
        this.setState('idle', '已同步 ' + U.fmtTime(this.lastAt).slice(11));
        if (SG.notify) SG.notify.check().catch(() => {});
        return { pulled };
      } catch (e) {
        if (e.code === 'BADKEY') {
          this.saveCfg(Object.assign(this.cfg(), { enabled: false }));
          this.setState('error', '同步密碼錯誤，已停止同步，請到「設定」重新連線');
        } else this.setState('error', e.message);
        throw e;
      }
    },
    start() {
      clearInterval(this.timer);
      if (!this.enabled()) { this.setState('off'); return; }
      const run = () => this.syncNow().catch(() => {});
      run();
      this.timer = setInterval(run, 60000);
      if (!this._wired) {
        this._wired = true;
        const soon = U.debounce(run, 2500);
        DB.onChange(() => { if (this.enabled() && Object.keys(DB.data._dirty).length) soon(); });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.enabled()) run(); });
        window.addEventListener('online', () => this.enabled() && run());
      }
    }
  });

  // ----------------------------------------------------------- domain helpers
  const Q = (SG.q = {
    eqName(id) { const e = DB.get('equipment', id); return e ? e.name : '（已刪除的設備）'; },
    nextCode() {
      let max = 0;
      Object.values(DB.data.equipment).forEach((e) => {
        const m = /^EQ-(\d+)$/.exec(e.code || '');
        if (m) max = Math.max(max, +m[1]);
      });
      return 'EQ-' + U.pad(max + 1, 4);
    },
    planStatus(p) {
      if (!p.active) return { key: 'paused', label: '已暫停' };
      const d = U.daysBetween(U.today(), p.nextDue);
      if (d == null) return { key: 'none', label: '未排定' };
      if (d < 0) return { key: 'overdue', label: `逾期 ${-d} 天` };
      if (d <= (p.remindDays == null ? 7 : +p.remindDays)) return { key: 'soon', label: d === 0 ? '今天到期' : `${d} 天後` };
      return { key: 'ok', label: `${d} 天後` };
    },
    warrantyStatus(e) {
      if (!e.warrantyUntil) return null;
      const d = U.daysBetween(U.today(), e.warrantyUntil);
      if (d < 0) return { key: 'expired', label: '保固已過期' };
      if (d <= 30) return { key: 'soon', label: `保固剩 ${d} 天` };
      return { key: 'ok', label: '保固中' };
    },
    ageYears(e) {
      const d = U.parseDate(e.purchaseDate);
      if (!d) return null;
      return (Date.now() - d) / (365.25 * 86400000);
    },
    distinct(field, extra = []) {
      const set = new Set(extra.filter(Boolean));
      DB.all('equipment').forEach((e) => e[field] && set.add(e[field]));
      return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    },
    vendorNames() {
      const set = new Set(DB.all('vendors').map((v) => v.name));
      ['quotes', 'replacements', 'logs'].forEach((c) => DB.all(c).forEach((r) => r.vendor && set.add(r.vendor)));
      DB.all('equipment').forEach((e) => e.vendor && set.add(e.vendor));
      return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    },
    // Every expense in one list: purchases, replacements, maintenance/repairs.
    // Limited to the selected store (if any); consumable purchases have no
    // store, so they only count when all stores are shown.
    expenses() {
      const out = [];
      DB.all('equipment').forEach((e) => { if (U.num(e.price) > 0 && e.purchaseDate) out.push({ date: e.purchaseDate, kind: '採購', amount: U.num(e.price), vendor: e.vendor || '', eq: e, title: e.name }); });
      DB.all('replacements').forEach((r) => { if (U.num(r.cost) > 0) { const e = DB.get('equipment', r.equipmentId); out.push({ date: r.date, kind: '更換', amount: U.num(r.cost), vendor: r.vendor || '', eq: e, title: r.item }); } });
      DB.all('logs').forEach((l) => { if (U.num(l.cost) > 0) { const e = DB.get('equipment', l.equipmentId); out.push({ date: l.date, kind: l.type || '保養', amount: U.num(l.cost), vendor: l.vendor || '', eq: e, title: l.title }); } });
      const cur = this.curStore();
      if (cur) return out.filter((x) => x.eq && x.eq.store === cur);
      DB.all('stock').forEach((m) => { if (m.kind === '進貨' && U.num(m.cost) > 0) { const p = DB.get('parts', m.partId); out.push({ date: m.date, kind: '耗材', amount: U.num(m.cost), vendor: m.vendor || '', eq: null, title: p ? p.name : '耗材' }); } });
      return out;
    },

    // ---- stores (分店): the selection is per device
    stores() { return DB.settings().stores; },
    curStore() {
      const s = SG.store.get('sg_cur_store');
      return s && this.stores().includes(s) ? s : '';
    },
    setStore(s) { SG.store.set('sg_cur_store', s || null); },
    inStore(eq) { const cur = this.curStore(); return !cur || !!(eq && eq.store === cur); },
    inStoreRec(r) { return this.inStore(DB.get('equipment', r.equipmentId)); },
    eqs() { return DB.all('equipment').filter((e) => this.inStore(e)); },

    // ---- consumables
    stockOf(partId) { return DB.all('stock').filter((m) => m.partId === partId).reduce((t, m) => t + U.num(m.qty), 0); },
    lowParts() { return DB.all('parts').filter((p) => p.minQty !== '' && p.minQty != null && this.stockOf(p.id) <= U.num(p.minQty)); },
    openRepairs() { return DB.all('repairs').filter((r) => (r.status === '待處理' || r.status === '處理中') && this.inStoreRec(r)); }
  });
})();
