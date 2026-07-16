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
    const day = 86400000;
    const upcoming = eq
      .filter(e => e.status !== 'retired' && e.lifespanYears)
      .map(e => {
        const due = new Date(e.purchaseDate).getTime() + e.lifespanYears * 365 * day;
        return { ...e, dueDate: due, daysLeft: Math.round((due - now) / day) };
      })
      .filter(e => e.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    return { totalCount: eq.length, totalValue, totalReplaceCost, byStatus, byCategory, byDepartment, upcoming, quoteCount: quotes.length };
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

  function monthlyReplacementCost() {
    const replacements = EPM.equipment.listReplacements();
    const map = new Map();
    replacements.forEach(r => {
      const month = (r.replaceDate || '').slice(0, 7);
      if (!month) return;
      map.set(month, (map.get(month) || 0) + (r.cost || 0));
    });
    const months = Array.from(map.keys()).sort();
    return { labels: months, data: months.map(m => map.get(m)) };
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

  function renderCostTrendChart(canvasId) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const { labels, data } = monthlyReplacementCost();
    if (!labels.length) return;
    charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels, datasets: [{
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

  function exportEquipmentCSV() {
    const csv = toCSV(EPM.equipment.list(), [
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

  window.EPM.reports = {
    PALETTE, CATEGORICAL_ORDER, STATUS_COLOR, STATUS_LABEL,
    summary, monthlyReplacementCost, quoteDecisionSummary, userSummary,
    renderStatusChart, renderCategoryChart, renderCostTrendChart, renderVendorCompareChart,
    renderDepartmentChart, renderQuoteDecisionChart, renderUserRoleChart,
    exportEquipmentCSV, exportReplacementsCSV, exportQuotesCSV
  };
})();
