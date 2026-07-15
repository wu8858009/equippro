/* EPM.equipment — equipment CRUD + replacement history */
(function () {
  const S = EPM.storage;

  function list() { return S.read(S.KEYS.equipment, []); }
  function saveList(items) { S.write(S.KEYS.equipment, items); }
  function get(id) { return list().find(e => e.id === id) || null; }

  function nextCode(items) {
    const max = items.reduce((m, e) => {
      const match = /EQ-(\d+)/.exec(e.code || '');
      return match ? Math.max(m, parseInt(match[1], 10)) : m;
    }, 0);
    return 'EQ-' + String(max + 1).padStart(4, '0');
  }

  function create(data) {
    const items = list();
    const user = EPM.auth.getCurrentUser();
    const now = Date.now();
    const item = {
      id: S.uid('eq'),
      code: (data.code || '').trim() || nextCode(items),
      name: data.name,
      category: data.category,
      department: data.department,
      location: data.location,
      purchaseDate: data.purchaseDate,
      warrantyMonths: Number(data.warrantyMonths) || 0,
      lifespanYears: Number(data.lifespanYears) || 0,
      status: data.status || 'active',
      supplier: data.supplier || '',
      purchasePrice: Number(data.purchasePrice) || 0,
      notes: data.notes || '',
      createdAt: now, updatedAt: now,
      createdBy: user ? user.id : null
    };
    items.push(item);
    saveList(items);
    EPM.auth.logActivity('新增設備', item.name, item.code);
    return item;
  }

  function update(id, patch) {
    const items = list();
    const idx = items.findIndex(e => e.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch, updatedAt: Date.now() };
    saveList(items);
    EPM.auth.logActivity('編輯設備', items[idx].name, items[idx].code);
    return items[idx];
  }

  function remove(id) {
    const items = list();
    const target = items.find(e => e.id === id);
    saveList(items.filter(e => e.id !== id));
    removeReplacementsByEquipment(id);
    if (window.EPM.pricing) window.EPM.pricing.removeQuotesByEquipment(id);
    if (target) EPM.auth.logActivity('刪除設備', target.name, target.code);
  }

  function listReplacements(equipmentId) {
    const all = S.read(S.KEYS.replacements, []);
    return equipmentId ? all.filter(r => r.equipmentId === equipmentId) : all;
  }

  function addReplacement(data) {
    const all = S.read(S.KEYS.replacements, []);
    const user = EPM.auth.getCurrentUser();
    const rec = {
      id: S.uid('rp'),
      equipmentId: data.equipmentId,
      replaceDate: data.replaceDate,
      reason: data.reason || '',
      cost: Number(data.cost) || 0,
      vendor: data.vendor || '',
      operator: (user && user.name) || data.operator || '',
      disposal: data.disposal || '',
      notes: data.notes || '',
      createdAt: Date.now()
    };
    all.push(rec);
    S.write(S.KEYS.replacements, all);
    const eq = get(data.equipmentId);
    if (eq && data.markRetired !== false) update(eq.id, { status: 'retired' });
    EPM.auth.logActivity('新增更換紀錄', eq ? eq.name : data.equipmentId, rec.replaceDate);
    return rec;
  }

  function removeReplacement(id) {
    let all = S.read(S.KEYS.replacements, []);
    const target = all.find(r => r.id === id);
    all = all.filter(r => r.id !== id);
    S.write(S.KEYS.replacements, all);
    if (target) {
      const eq = get(target.equipmentId);
      EPM.auth.logActivity('刪除更換紀錄', eq ? eq.name : target.equipmentId, target.replaceDate);
    }
  }

  function removeReplacementsByEquipment(equipmentId) {
    let all = S.read(S.KEYS.replacements, []);
    all = all.filter(r => r.equipmentId !== equipmentId);
    S.write(S.KEYS.replacements, all);
  }

  function categories() {
    return Array.from(new Set(list().map(e => e.category).filter(Boolean)));
  }
  function departments() {
    return Array.from(new Set(list().map(e => e.department).filter(Boolean)));
  }

  window.EPM.equipment = {
    list, get, create, update, remove,
    listReplacements, addReplacement, removeReplacement,
    categories, departments
  };
})();
