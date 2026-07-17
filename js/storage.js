/* EPM.storage — localStorage data layer + demo seed data */
(function () {
  const PREFIX = 'epm_';
  const KEYS = {
    users: PREFIX + 'users',
    session: PREFIX + 'session',
    equipment: PREFIX + 'equipment',
    replacements: PREFIX + 'replacements',
    quotes: PREFIX + 'quotes',
    activity: PREFIX + 'activity',
    theme: PREFIX + 'theme',
    dashboardLayout: PREFIX + 'dashboard_layout',
    equipmentColumns: PREFIX + 'equipment_columns',
    seeded: PREFIX + 'seeded_v1'
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('讀取資料失敗', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Most likely QuotaExceededError — base64 photos are the usual culprit.
      console.error('儲存資料失敗', key, e);
      if (window.EPM && window.EPM.app && window.EPM.app.toast) {
        window.EPM.app.toast('儲存失敗：瀏覽器儲存空間已滿，請刪除部分照片或紀錄後再試', 'error');
      }
      return false;
    }
    persistToDesktop();
    return true;
  }

  function remove(key) {
    localStorage.removeItem(key);
    persistToDesktop();
  }

  // ---------- desktop (pywebview) persistence bridge ----------
  // In the browser, localStorage is the whole story. In the desktop app,
  // pywebview additionally mirrors every epm_* key into a JSON file next to
  // the .exe (via desktop_app.py's Api.save_data/load_data), so the data
  // survives as a visible, backup-able file instead of living only inside
  // WebView2's hidden profile folder.
  function isDesktop() {
    return !!(window.pywebview && window.pywebview.api);
  }

  function flushToDesktop() {
    if (!isDesktop()) return;
    const snapshot = {};
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf(PREFIX) === 0) snapshot[k] = localStorage.getItem(k);
    });
    window.pywebview.api.save_data(JSON.stringify(snapshot)).catch((e) => console.error('寫入本機資料檔失敗', e));
  }

  // seed() and other bulk operations fire several writes back-to-back; each
  // one calling save_data() immediately would dispatch overlapping async
  // calls to Python. Debouncing coalesces a burst of writes into one save
  // of the final state (the temp-file+replace on the Python side makes each
  // individual save safe regardless, but this avoids the redundant churn).
  let persistTimer = null;
  function persistToDesktop() {
    if (!isDesktop()) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      flushToDesktop();
    }, 150);
  }

  // Make sure the very last change lands even if the window closes before
  // the debounce timer fires.
  window.addEventListener('beforeunload', () => {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    flushToDesktop();
  });

  function loadFromDesktop() {
    return window.pywebview.api.load_data().then((json) => {
      try {
        const data = JSON.parse(json || '{}');
        Object.keys(data).forEach((k) => localStorage.setItem(k, data[k]));
      } catch (e) {
        console.error('讀取本機資料檔失敗', e);
      }
    }).catch((e) => console.error('讀取本機資料檔失敗', e));
  }

  // Resolves once it's safe to read localStorage: immediately in a plain
  // browser, or after the desktop data file has been loaded into
  // localStorage when running inside the pywebview desktop app.
  function initPersistence() {
    return new Promise((resolve) => {
      let done = false;
      function finish() {
        if (done) return;
        done = true;
        if (isDesktop()) loadFromDesktop().then(resolve);
        else resolve();
      }
      if (isDesktop()) { finish(); return; }
      // pywebview injects window.pywebview and fires this event once its JS
      // bridge is ready, normally within milliseconds — the timeout is only
      // a safety net for a plain browser, where the event never fires.
      window.addEventListener('pywebviewready', finish, { once: true });
      setTimeout(finish, 200);
    });
  }

  function uid(prefix) {
    return (prefix ? prefix + '_' : '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Lightweight non-cryptographic hash — sufficient for a local, single-machine
  // demo login gate, not for protecting real secrets (nothing here leaves the browser).
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return 'h' + Math.abs(hash).toString(36) + str.length;
  }

  function iso(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  function seed() {
    if (read(KEYS.seeded, false)) return;
    const now = Date.now();
    const day = 86400000;

    // No demo accounts are seeded — the first launch walks the user through
    // creating their own administrator account (see EPM.app renderSetup).
    write(KEYS.users, []);

    const eq1 = uid('eq'), eq2 = uid('eq'), eq3 = uid('eq'), eq4 = uid('eq');
    write(KEYS.equipment, [
      { id: eq1, code: 'EQ-0001', name: '雷射印表機 HP LaserJet Pro', category: '辦公設備', department: '行政部', location: '2F 影印室', purchaseDate: iso(now - 500 * day), warrantyMonths: 24, lifespanYears: 5, status: 'active', supplier: '震旦行', purchasePrice: 15800, notes: '', createdAt: now, updatedAt: now, createdBy: null },
      { id: eq2, code: 'EQ-0002', name: '伺服器主機 Dell PowerEdge R740', category: 'IT設備', department: '資訊部', location: '機房 A', purchaseDate: iso(now - 2180 * day), warrantyMonths: 36, lifespanYears: 6, status: 'pending', supplier: 'Dell 台灣', purchasePrice: 186000, notes: '效能下降，建議汰換', createdAt: now, updatedAt: now, createdBy: null },
      { id: eq3, code: 'EQ-0003', name: '冷氣主機 大金 VRV IV', category: '空調設備', department: '總務部', location: '3F 機房外', purchaseDate: iso(now - 3650 * day), warrantyMonths: 60, lifespanYears: 10, status: 'retired', supplier: '大金空調', purchasePrice: 320000, notes: '已於上月完成更換', createdAt: now, updatedAt: now, createdBy: null },
      { id: eq4, code: 'EQ-0004', name: '不斷電系統 UPS 10KVA', category: 'IT設備', department: '資訊部', location: '機房 A', purchaseDate: iso(now - 1400 * day), warrantyMonths: 24, lifespanYears: 4, status: 'active', supplier: '飛瑞股份', purchasePrice: 96000, notes: '', createdAt: now, updatedAt: now, createdBy: null }
    ]);

    write(KEYS.replacements, [
      { id: uid('rp'), equipmentId: eq3, replaceDate: iso(now - 20 * day), reason: '老舊耗能，維修成本過高', cost: 298000, vendor: '大金空調', operator: '', disposal: '原廠回收', notes: '', createdAt: now - 20 * day },
      { id: uid('rp'), equipmentId: eq3, replaceDate: iso(now - 400 * day), reason: '定期保養更換零件', cost: 12000, vendor: '大金空調', operator: '', disposal: '零件回收', notes: '', createdAt: now - 400 * day }
    ]);

    write(KEYS.quotes, [
      { id: uid('qt'), equipmentId: eq2, itemName: '伺服器主機汰換', vendor: 'Dell 台灣', price: 210000, quoteDate: iso(now - 10 * day), validUntil: iso(now + 20 * day), contact: '02-1234-5678', selected: false, notes: '', createdAt: now - 10 * day },
      { id: uid('qt'), equipmentId: eq2, itemName: '伺服器主機汰換', vendor: 'HPE 台灣', price: 198000, quoteDate: iso(now - 8 * day), validUntil: iso(now + 22 * day), contact: '02-8765-4321', selected: true, notes: '含三年保固到府維修', createdAt: now - 8 * day },
      { id: uid('qt'), equipmentId: eq2, itemName: '伺服器主機汰換', vendor: '華碩雲端', price: 205000, quoteDate: iso(now - 6 * day), validUntil: iso(now + 24 * day), contact: '02-2222-3333', selected: false, notes: '', createdAt: now - 6 * day }
    ]);

    write(KEYS.activity, [
      { id: uid('log'), timestamp: now, userId: null, userName: '系統', action: '系統初始化', target: '-', detail: '建立示範設備與報價資料' }
    ]);

    write(KEYS.seeded, true);
  }

  window.EPM = window.EPM || {};
  window.EPM.storage = { KEYS, read, write, remove, uid, simpleHash, seed, iso, isDesktop, initPersistence };
})();
