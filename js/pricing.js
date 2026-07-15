/* EPM.pricing — vendor quotes + price comparison */
(function () {
  const S = EPM.storage;

  function list(equipmentId) {
    const all = S.read(S.KEYS.quotes, []);
    return equipmentId ? all.filter(q => q.equipmentId === equipmentId) : all;
  }
  function saveAll(all) { S.write(S.KEYS.quotes, all); }

  function addQuote(data) {
    const all = list();
    const q = {
      id: S.uid('qt'),
      equipmentId: data.equipmentId,
      itemName: data.itemName,
      vendor: data.vendor,
      price: Number(data.price) || 0,
      quoteDate: data.quoteDate,
      validUntil: data.validUntil || '',
      contact: data.contact || '',
      selected: false,
      notes: data.notes || '',
      createdAt: Date.now()
    };
    all.push(q);
    saveAll(all);
    EPM.auth.logActivity('新增報價', data.itemName, `${data.vendor} $${q.price.toLocaleString()}`);
    return q;
  }

  function updateQuote(id, patch) {
    const all = list();
    const idx = all.findIndex(q => q.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...patch };
    saveAll(all);
    return all[idx];
  }

  function selectVendor(id) {
    const all = list();
    const target = all.find(q => q.id === id);
    if (!target) return;
    all.forEach(q => {
      if (q.equipmentId === target.equipmentId && q.itemName === target.itemName) q.selected = false;
    });
    target.selected = true;
    saveAll(all);
    EPM.auth.logActivity('選定廠商', target.itemName, target.vendor);
  }

  function removeQuote(id) {
    let all = list();
    const target = all.find(q => q.id === id);
    all = all.filter(q => q.id !== id);
    saveAll(all);
    if (target) EPM.auth.logActivity('刪除報價', target.itemName, target.vendor);
  }

  function removeQuotesByEquipment(equipmentId) {
    saveAll(list().filter(q => q.equipmentId !== equipmentId));
  }

  function groupedByItem() {
    const all = list();
    const map = new Map();
    all.forEach(q => {
      const key = q.equipmentId + '||' + q.itemName;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(q);
    });
    return Array.from(map.entries()).map(([key, quotes]) => ({
      key,
      equipmentId: quotes[0].equipmentId,
      itemName: quotes[0].itemName,
      quotes: quotes.slice().sort((a, b) => a.price - b.price)
    })).sort((a, b) => b.quotes[0].createdAt - a.quotes[0].createdAt);
  }

  window.EPM.pricing = {
    list, addQuote, updateQuote, selectVendor, removeQuote,
    removeQuotesByEquipment, groupedByItem
  };
})();
