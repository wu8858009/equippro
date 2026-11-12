/* EPM.pricing — vendor quotes + price comparison */
(function () {
  const S = EPM.storage;

  const DEFAULT_TAX_RATE = 5; // 營業稅 5%

  // Tax breakdown from an entered amount. taxMode says whether the amount is
  // 含稅 ('inclusive') or 未稅 ('exclusive'); results are whole dollars.
  function computeTax(amount, taxMode, taxRate) {
    const a = Math.max(0, Math.round(Number(amount) || 0));
    const rate = Math.max(0, Number(taxRate === undefined || taxRate === '' ? DEFAULT_TAX_RATE : taxRate) || 0);
    if (taxMode === 'exclusive') {
      const tax = Math.round(a * rate / 100);
      return { priceExcl: a, tax, priceIncl: a + tax, taxRate: rate, taxMode: 'exclusive' };
    }
    const excl = Math.round(a / (1 + rate / 100));
    return { priceExcl: excl, tax: a - excl, priceIncl: a, taxRate: rate, taxMode: 'inclusive' };
  }

  // Breakdown of a stored quote. `price` is always the 含稅 amount (what
  // comparisons and totals use); quotes saved before tax support count as
  // 含稅 at the default rate.
  function taxParts(q) {
    if (q && typeof q.priceExcl === 'number') {
      return { priceIncl: q.price, priceExcl: q.priceExcl, tax: q.price - q.priceExcl, taxRate: q.taxRate ?? DEFAULT_TAX_RATE, taxMode: q.taxMode || 'inclusive' };
    }
    return computeTax(q ? q.price : 0, 'inclusive', DEFAULT_TAX_RATE);
  }

  function list(equipmentId) {
    const all = S.read(S.KEYS.quotes, []);
    return equipmentId ? all.filter(q => q.equipmentId === equipmentId) : all;
  }
  function saveAll(all) { S.write(S.KEYS.quotes, all); }

  function addQuote(data) {
    const all = list();
    const t = computeTax(data.amount !== undefined ? data.amount : data.price, data.taxMode, data.taxRate);
    const q = {
      id: S.uid('qt'),
      equipmentId: data.equipmentId,
      itemName: data.itemName,
      vendor: data.vendor,
      price: t.priceIncl,
      priceExcl: t.priceExcl,
      taxRate: t.taxRate,
      taxMode: t.taxMode,
      quoteDate: data.quoteDate,
      validUntil: data.validUntil || '',
      contact: data.contact || '',
      selected: false,
      notes: data.notes || '',
      photos: Array.isArray(data.photos) ? data.photos : [],
      createdAt: Date.now()
    };
    all.push(q);
    saveAll(all);
    EPM.auth.logActivity('新增報價', data.itemName, `${data.vendor} 含稅 $${q.price.toLocaleString()}（未稅 $${q.priceExcl.toLocaleString()}）`);
    return q;
  }

  function updateQuote(id, patch) {
    const all = list();
    const idx = all.findIndex(q => q.id === id);
    if (idx === -1) return null;
    patch = { ...patch };
    if (patch.amount !== undefined) {
      const t = computeTax(patch.amount, patch.taxMode, patch.taxRate);
      delete patch.amount;
      Object.assign(patch, { price: t.priceIncl, priceExcl: t.priceExcl, taxRate: t.taxRate, taxMode: t.taxMode });
    }
    all[idx] = { ...all[idx], ...patch };
    saveAll(all);
    if (patch.price !== undefined) EPM.auth.logActivity('編輯報價', all[idx].itemName, `${all[idx].vendor} 含稅 $${all[idx].price.toLocaleString()}`);
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
    DEFAULT_TAX_RATE, computeTax, taxParts,
    list, addQuote, updateQuote, selectVendor, removeQuote,
    removeQuotesByEquipment, groupedByItem
  };
})();
