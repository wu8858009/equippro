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
    localStorage.setItem(key, JSON.stringify(value));
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
  window.EPM.storage = { KEYS, read, write, uid, simpleHash, seed, iso };
})();
