/* EPM.reports — aggregates, Chart.js rendering, CSV export */
(function () {
  // Validated categorical palette (fixed order — see dataviz skill reference palette)
  const PALETTE = {
    blue: '#2a78d6', green: '#008300', magenta: '#e87ba4', yellow: '#eda100',
    aqua: '#1baf7a', orange: '#eb6834', violet: '#4a3aa7', red: '#e34948'
  };
  const CATEGORICAL_ORDER = [PALETTE.blue, PALETTE.green, PALETTE.magenta, PALETTE.yellow, PALETTE.aqua, PALETTE.orange, PALETTE.violet, PALETTE.red];
  const STATUS_COLOR = { active: '#0ca30c', pending: '#fab219', retired: '#898781', damaged: '#d03b3b' };
  const STATUS_LABEL = { active: '使用中', pending: '待汰換', retired: '已汰換', damaged: '故障維修' };
  const DAY = 86400000;
  const ALERT_TIER_LABEL = { overdue: '已逾期', t30: '30 天內', t60: '31-60 天', t90: '61-90 天' };
  const ALERT_TIER_COLOR = { overdue: '#d03b3b', t30: '#eb6834', t60: '#eda100', t90: '#c9b400' };

  /* ---------- date range helpers ---------- */
  // A range is {start, end} in epoch ms (inclusive), or null/undefined for "all time".
  function presetRange(preset) {
    const now = new Date();
    let start, end;
    if (preset === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (preset === 'quarter') {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999);
    } else if (preset === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else {
      return null;
    }
    return { start: start.getTime(), end: end.getTime() };
  }

  function previousRange(range) {
    if (!range) return null;
    const length = range.end - range.start + 1;
    return { start: range.start - length, end: range.start - 1 };
  }

  function filterReplacementsByRange(range) {
    const all = EPM.equipment.listReplacements();
    if (!range) return all;
    return all.filter(r => {
      const t = new Date(r.replaceDate || 0).getTime();
      return t >= range.start && t <= range.end;
    });
  }

  function costComparison(range) {
    const current = filterReplacementsByRange(range).reduce((sum, r) => sum + (r.cost || 0), 0);
    if (!range) return { current, previous: null, deltaPct: null };
    const previous = filterReplacementsByRange(previousRange(range)).reduce((sum, r) => sum + (r.cost || 0), 0);
    const deltaPct = previous > 0 ? ((current - previous) / previous * 100) : (current > 0 ? 100 : 0);
    return { current, previous, deltaPct };
  }

  function vendorSpendSummary(range) {
    const replacements = filterReplacementsByRange(range);
    const map = new Map();
    replacements.forEach(r => {
      const vendor = r.vendor || '未指定';
      if (!map.has(vendor)) map.set(vendor, { vendor, totalCost: 0, count: 0 });
      const entry = map.get(vendor);
      entry.totalCost += (r.cost || 0);
      entry.count += 1;
    });
    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  }

  function costAnalysisByGroup(groupBy, range) {
    const eq = EPM.equipment.list();
    const replacements = filterReplacementsByRange(range);
    const map = new Map();
    const keyOf = (e) => (groupBy === 'category' ? e.category : e.department) || '未分類';
    eq.forEach(e => {
      const key = keyOf(e);
      if (!map.has(key)) map.set(key, { key, count: 0, purchaseValue: 0, replaceCost: 0, lifespanSum: 0, lifespanCount: 0 });
      const g = map.get(key);
      g.count++;
      g.purchaseValue += (e.purchasePrice || 0);
      if (e.lifespanYears) { g.lifespanSum += e.lifespanYears; g.lifespanCount++; }
    });
    replacements.forEach(r => {
      const eq2 = EPM.equipment.get(r.equipmentId);
      if (!eq2) return;
      const key = keyOf(eq2);
      if (!map.has(key)) map.set(key, { key, count: 0, purchaseValue: 0, replaceCost: 0, lifespanSum: 0, lifespanCount: 0 });
      map.get(key).replaceCost += (r.cost || 0);
    });
    return Array.from(map.values())
      .map(g => ({ ...g, avgLifespan: g.lifespanCount ? g.lifespanSum / g.lifespanCount : 0 }))
      .sort((a, b) => b.purchaseValue - a.purchaseValue);
  }

  function warrantyAnalysis() {
    const now = Date.now();
    const eq = EPM.equipment.list().filter(e => e.status !== 'retired' && e.purchaseDate && e.warrantyMonths);
    const items = eq.map(e => {
      const end = new Date(e.purchaseDate);
      end.setMonth(end.getMonth() + Number(e.warrantyMonths));
      const daysLeft = Math.round((end.getTime() - now) / DAY);
      return { ...e, warrantyEnd: end.getTime(), daysLeft };
    }).sort((a, b) => a.daysLeft - b.daysLeft);
    const expired = items.filter(e => e.daysLeft < 0).length;
    const within90 = items.filter(e => e.daysLeft >= 0 && e.daysLeft <= 90).length;
    const covered = items.filter(e => e.daysLeft > 90).length;
    return { items, expired, within90, covered };
  }

  function isDark() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function ink() { return isDark() ? '#c3c2b7' : '#52514e'; }
  function grid() { return isDark() ? '#2c2c2a' : '#e1e0d9'; }
  function surface() { return isDark() ? '#1a1a19' : '#fcfcfb'; }

  function summary() {
    const eq = EPM.equipment.list();
    const replacements = EPM.equipment.listReplacements();
    const quotes = EPM.pricing.list();
    const totalValue = eq.reduce((s, e) => s + (e.purchasePrice || 0), 0);
    const totalReplaceCost = replacements.reduce((s, r) => s + (r.cost || 0), 0);

    const byStatus = {};
    eq.forEach(e => { byStatus[e.status] = (byStatus[e.status] || 0) + 1; });

    const byCategory = {};
    eq.forEach(e => { const c = e.category || '未分類'; byCategory[c] = (byCategory[c] || 0) + 1; });

    const byDepartment = {};
    eq.forEach(e => { const d = e.department || '未指定'; byDepartment[d] = (byDepartment[d] || 0) + 1; });

    const now = Date.now();
    const upcoming = eq
      .filter(e => e.status !== 'retired' && e.lifespanYears)
      .map(e => {
        const due = new Date(e.purchaseDate).getTime() + e.lifespanYears * 365 * DAY;
        const daysLeft = Math.round((due - now) / DAY);
        const tier = daysLeft < 0 ? 'overdue' : daysLeft <= 30 ? 't30' : daysLeft <= 60 ? 't60' : 't90';
        return { ...e, dueDate: due, daysLeft, tier };
      })
      .filter(e => e.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const alertTiers = { overdue: 0, t30: 0, t60: 0, t90: 0 };
    upcoming.forEach(e => { alertTiers[e.tier]++; });

    return { totalCount: eq.length, totalValue, totalReplaceCost, byStatus, byCategory, byDepartment, upcoming, alertTiers, quoteCount: quotes.length };
  }

  function depreciationSummary(asOf) {
    const now = asOf || Date.now();
    const eq = EPM.equipment.list().filter(e => e.status !== 'retired');
    const byCategory = {};
    let totalOriginal = 0, totalNet = 0;
    eq.forEach(e => {
      const price = e.purchasePrice || 0;
      totalOriginal += price;
      let net = price;
      if (e.lifespanYears > 0 && e.purchaseDate) {
        const elapsedYears = (now - new Date(e.purchaseDate).getTime()) / (365 * DAY);
        const ratio = Math.max(0, Math.min(1, 1 - elapsedYears / e.lifespanYears));
        net = price * ratio;
      }
      totalNet += net;
      const cat = e.category || '未分類';
      if (!byCategory[cat]) byCategory[cat] = { original: 0, net: 0 };
      byCategory[cat].original += price;
      byCategory[cat].net += net;
    });
    return { totalOriginal, totalNet, totalDepreciated: totalOriginal - totalNet, byCategory };
  }

  function replacementTimeline(monthsAhead) {
    monthsAhead = monthsAhead || 12;
    const now = Date.now();
    const eq = EPM.equipment.list().filter(e => e.status !== 'retired' && e.lifespanYears && e.purchaseDate);
    const dueDates = eq.map(e => new Date(e.purchaseDate).getTime() + e.lifespanYears * 365 * DAY);

    const base = new Date();
    const monthKeys = [];
    const labels = ['已逾期'];
    const buckets = new Map();
    for (let i = 0; i < monthsAhead; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      monthKeys.push(key);
      buckets.set(key, 0);
      labels.push(`${d.getFullYear()}/${d.getMonth() + 1}`);
    }

    let overdue = 0;
    dueDates.forEach(due => {
      if (due < now) { overdue++; return; }
      const d = new Date(due);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    });

    return { labels, data: [overdue, ...monthKeys.map(k => buckets.get(k))] };
  }

  function quoteDecisionSummary() {
    const groups = EPM.pricing.groupedByItem();
    const decided = groups.filter(g => g.quotes.some(q => q.selected)).length;
    return { totalItems: groups.length, decided, pending: groups.length - decided };
  }

  function userSummary() {
    const users = EPM.auth.getUsers();
    return {
      total: users.length,
      admin: users.filter(u => u.role === 'admin').length,
      staff: users.filter(u => u.role === 'staff').length,
      active: users.filter(u => u.active).length,
      disabled: users.filter(u => !u.active).length
    };
  }

  function monthlyReplacementCost(range) {
    const replacements = filterReplacementsByRange(range);
    // A short range (e.g. the "this month" preset) collapses to one bar if
    // grouped by month, so bucket by day instead once the span is under ~32 days.
    const byDay = !!range && (range.end - range.start) <= 32 * DAY;
    const map = new Map();
    replacements.forEach(r => {
      const key = byDay ? (r.replaceDate || '') : (r.replaceDate || '').slice(0, 7);
      if (!key) return;
      map.set(key, (map.get(key) || 0) + (r.cost || 0));
    });
    const labels = Array.from(map.keys()).sort();
    return { labels, data: labels.map(l => map.get(l)), byDay };
  }

  const charts = {};
  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  function renderStatusChart(canvasId) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const s = summary();
    const order = ['active', 'pending', 'retired', 'damaged'];
    const present = order.filter(k => s.byStatus[k]);
    if (!present.length) return;
    charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: present.map(k => STATUS_LABEL[k]),
        datasets: [{
          data: present.map(k => s.byStatus[k]),
          backgroundColor: present.map(k => STATUS_COLOR[k]),
          borderColor: surface(), borderWidth: 2
        }]
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { color: ink(), padding: 14, usePointStyle: true, font: { size: 12 } } } },
        cutout: '62%',
        maintainAspectRatio: false
      }
    });
  }

  function renderCategoryChart(canvasId) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const s = summary();
    const labels = Object.keys(s.byCategory);
    if (!labels.length) return;
    charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: '設備數量', data: labels.map(l => s.byCategory[l]), backgroundColor: PALETTE.blue, borderRadius: 4, maxBarThickness: 40 }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.formattedValue} 台` } } },
        scales: {
          x: { ticks: { color: ink() }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0, color: ink() }, grid: { color: grid() } }
        },
        maintainAspectRatio: false
      }
    });
  }

  function renderDepartmentChart(canvasId) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const s = summary();
    const labels = Object.keys(s.byDepartment);
    if (!labels.length) return;
    charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: '設備數量', data: labels.map(l => s.byDepartment[l]), backgroundColor: PALETTE.green, borderRadius: 4, maxBarThickness: 40 }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.formattedValue} 台` } } },
        scales: {
          x: { ticks: { color: ink() }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0, color: ink() }, grid: { color: grid() } }
        },
        maintainAspectRatio: false
      }
    });
  }

  function renderQuoteDecisionChart(canvasId) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const q = quoteDecisionSummary();
    if (!q.totalItems) return;
    const present = [];
    if (q.decided) present.push({ label: '已選定廠商', value: q.decided, color: STATUS_COLOR.active });
    if (q.pending) present.push({ label: '待決策', value: q.pending, color: STATUS_COLOR.pending });
    charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: present.map(p => p.label),
        datasets: [{ data: present.map(p => p.value), backgroundColor: present.map(p => p.color), borderColor: surface(), borderWidth: 2 }]
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { color: ink(), padding: 14, usePointStyle: true, font: { size: 12 } } } },
        cutout: '62%',
        maintainAspectRatio: false
      }
    });
  }

  function renderUserRoleChart(canvasId) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const u = userSummary();
    if (!u.total) return;
    const present = [];
    if (u.admin) present.push({ label: '管理員', value: u.admin, color: PALETTE.blue });
    if (u.staff) present.push({ label: '一般人員', value: u.staff, color: PALETTE.aqua });
    charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: present.map(p => p.label),
        datasets: [{ data: present.map(p => p.value), backgroundColor: present.map(p => p.color), borderColor: surface(), borderWidth: 2 }]
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { color: ink(), padding: 14, usePointStyle: true, font: { size: 12 } } } },
        cutout: '62%',
        maintainAspectRatio: false
      }
    });
  }

  function renderCostTrendChart(canvasId, range) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const { labels, data, byDay } = monthlyReplacementCost(range);
    if (!labels.length) return;
    const dispLabels = byDay ? labels.map(l => l.slice(5)) : labels;
    charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dispLabels, datasets: [{
          label: '更換成本', data, borderColor: PALETTE.blue,
          backgroundColor: 'rgba(42,120,214,0.14)', fill: true, tension: 0.25,
          pointRadius: 4, pointBackgroundColor: PALETTE.blue, borderWidth: 2
        }]
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `NT$ ${c.formattedValue}` } } },
        scales: {
          x: { ticks: { color: ink() }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: ink(), callback: (v) => 'NT$' + Number(v).toLocaleString() }, grid: { color: grid() } }
        },
        maintainAspectRatio: false
      }
    });
  }

  function renderDepreciationChart(canvasId) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const dep = depreciationSummary();
    const labels = Object.keys(dep.byCategory);
    if (!labels.length) return;
    charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '採購金額', data: labels.map(l => dep.byCategory[l].original), backgroundColor: PALETTE.blue, borderRadius: 4, maxBarThickness: 28 },
          { label: '目前淨值', data: labels.map(l => Math.round(dep.byCategory[l].net)), backgroundColor: PALETTE.aqua, borderRadius: 4, maxBarThickness: 28 }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { color: ink(), padding: 14, usePointStyle: true, font: { size: 12 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: NT$ ${c.formattedValue}` } }
        },
        scales: {
          x: { ticks: { color: ink() }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: ink(), callback: (v) => 'NT$' + Number(v).toLocaleString() }, grid: { color: grid() } }
        },
        maintainAspectRatio: false
      }
    });
  }

  function renderReplacementTimelineChart(canvasId) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const t = replacementTimeline(12);
    if (!t.data.some(v => v > 0)) return;
    const colors = t.data.map((v, i) => i === 0 ? PALETTE.red : i <= 3 ? PALETTE.orange : PALETTE.blue);
    charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels: t.labels, datasets: [{ label: '預計汰換數量', data: t.data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 26 }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.formattedValue} 台` } } },
        scales: {
          x: { ticks: { color: ink() }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0, color: ink() }, grid: { color: grid() } }
        },
        maintainAspectRatio: false
      }
    });
  }

  function renderVendorSpendChart(canvasId, range) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const data = vendorSpendSummary(range).slice(0, 8);
    if (!data.length) return;
    charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.vendor),
        datasets: [{ label: '採購/更換金額', data: data.map(d => d.totalCost), backgroundColor: PALETTE.blue, borderRadius: 4, maxBarThickness: 26 }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `NT$ ${c.formattedValue}（${data[c.dataIndex].count} 筆）` } } },
        scales: {
          x: { beginAtZero: true, ticks: { color: ink(), callback: (v) => 'NT$' + Number(v).toLocaleString() }, grid: { color: grid() } },
          y: { ticks: { color: ink() }, grid: { display: false } }
        },
        maintainAspectRatio: false
      }
    });
  }

  function renderWarrantyChart(canvasId) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const w = warrantyAnalysis();
    const present = [];
    if (w.expired) present.push({ label: '已過保固', value: w.expired, color: PALETTE.red });
    if (w.within90) present.push({ label: '90 天內到期', value: w.within90, color: PALETTE.yellow });
    if (w.covered) present.push({ label: '保固內', value: w.covered, color: PALETTE.green });
    if (!present.length) return;
    charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: present.map(p => p.label),
        datasets: [{ data: present.map(p => p.value), backgroundColor: present.map(p => p.color), borderColor: surface(), borderWidth: 2 }]
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { color: ink(), padding: 14, usePointStyle: true, font: { size: 12 } } } },
        cutout: '62%',
        maintainAspectRatio: false
      }
    });
  }

  function renderVendorCompareChart(canvasId, group) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || !group || !group.quotes.length) return;
    const labels = group.quotes.map(q => q.vendor);
    const data = group.quotes.map(q => q.price);
    const colors = group.quotes.map((q, i) => CATEGORICAL_ORDER[i % CATEGORICAL_ORDER.length]);
    charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: '報價', data, backgroundColor: colors, borderRadius: 4, maxBarThickness: 40 }] },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `NT$ ${c.formattedValue}` } } },
        scales: {
          x: { beginAtZero: true, ticks: { color: ink(), callback: (v) => 'NT$' + Number(v).toLocaleString() }, grid: { color: grid() } },
          y: { ticks: { color: ink() }, grid: { display: false } }
        },
        maintainAspectRatio: false
      }
    });
  }

  function toCSV(rows, headers) {
    const esc = (v) => {
      const s = (v === null || v === undefined) ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(h => esc(h.label)).join(',')];
    rows.forEach(r => {
      lines.push(headers.map(h => esc(typeof h.value === 'function' ? h.value(r) : r[h.value])).join(','));
    });
    return '﻿' + lines.join('\r\n');
  }

  function downloadCSV(filename, csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function exportEquipmentCSV(items) {
    const csv = toCSV(items || EPM.equipment.list(), [
      { label: '設備編號', value: 'code' }, { label: '名稱', value: 'name' }, { label: '類別', value: 'category' },
      { label: '部門', value: 'department' }, { label: '位置', value: 'location' }, { label: '採購日期', value: 'purchaseDate' },
      { label: '保固(月)', value: 'warrantyMonths' }, { label: '使用年限(年)', value: 'lifespanYears' },
      { label: '狀態', value: (r) => STATUS_LABEL[r.status] || r.status }, { label: '供應商', value: 'supplier' },
      { label: '採購金額', value: 'purchasePrice' }, { label: '備註', value: 'notes' }
    ]);
    downloadCSV('設備清單_' + todayStr() + '.csv', csv);
  }

  function exportReplacementsCSV() {
    const rows = EPM.equipment.listReplacements().map(r => {
      const eq = EPM.equipment.get(r.equipmentId);
      return { ...r, equipmentName: eq ? eq.name : r.equipmentId };
    });
    const csv = toCSV(rows, [
      { label: '設備名稱', value: 'equipmentName' }, { label: '更換日期', value: 'replaceDate' }, { label: '原因', value: 'reason' },
      { label: '成本', value: 'cost' }, { label: '廠商', value: 'vendor' }, { label: '經辦人', value: 'operator' },
      { label: '舊設備處置', value: 'disposal' }, { label: '備註', value: 'notes' }
    ]);
    downloadCSV('更換紀錄_' + todayStr() + '.csv', csv);
  }

  function exportQuotesCSV() {
    const rows = EPM.pricing.list().map(q => {
      const eq = EPM.equipment.get(q.equipmentId);
      return { ...q, equipmentName: eq ? eq.name : q.equipmentId };
    });
    const csv = toCSV(rows, [
      { label: '項目', value: 'itemName' }, { label: '設備', value: 'equipmentName' }, { label: '廠商', value: 'vendor' },
      { label: '報價', value: 'price' }, { label: '報價日期', value: 'quoteDate' }, { label: '有效期限', value: 'validUntil' },
      { label: '聯絡方式', value: 'contact' }, { label: '已選定', value: (r) => r.selected ? '是' : '否' }, { label: '備註', value: 'notes' }
    ]);
    downloadCSV('報價紀錄_' + todayStr() + '.csv', csv);
  }

  function exportUsersCSV(items) {
    const csv = toCSV(items || EPM.auth.getUsers(), [
      { label: '帳號', value: 'username' }, { label: '姓名', value: 'name' },
      { label: '角色', value: (u) => u.role === 'admin' ? '管理員' : '一般人員' },
      { label: '狀態', value: (u) => u.active ? '啟用中' : '已停用' },
      { label: '最後登入', value: (u) => u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-TW') : '從未登入' },
      { label: '建立時間', value: (u) => new Date(u.createdAt).toLocaleDateString('zh-TW') }
    ]);
    downloadCSV('使用者清單_' + todayStr() + '.csv', csv);
  }

  window.EPM.reports = {
    PALETTE, CATEGORICAL_ORDER, STATUS_COLOR, STATUS_LABEL, ALERT_TIER_LABEL, ALERT_TIER_COLOR,
    summary, monthlyReplacementCost, quoteDecisionSummary, userSummary,
    presetRange, previousRange, costComparison, depreciationSummary, replacementTimeline,
    vendorSpendSummary, costAnalysisByGroup, warrantyAnalysis,
    renderStatusChart, renderCategoryChart, renderCostTrendChart, renderVendorCompareChart,
    renderDepartmentChart, renderQuoteDecisionChart, renderUserRoleChart,
    renderDepreciationChart, renderReplacementTimelineChart, renderVendorSpendChart, renderWarrantyChart,
    exportEquipmentCSV, exportReplacementsCSV, exportQuotesCSV, exportUsersCSV
  };
})();
