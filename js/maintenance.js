/* EPM.maintenance — recurring maintenance schedules + maintenance/repair log */
(function () {
  const S = EPM.storage;
  const DAY = 86400000;

  const UNIT_LABEL = { day: '天', week: '週', month: '個月', year: '年' };
  const LOG_TYPE_LABEL = { maintenance: '保養', repair: '維修' };

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Adds an interval to a YYYY-MM-DD date. Month/year steps clamp to the end
  // of the target month (Jan 31 + 1 month = Feb 28/29), like a calendar would.
  function addInterval(dateStr, value, unit) {
    const n = Math.max(1, Number(value) || 1);
    const [y, m, d] = String(dateStr || todayStr()).split('-').map(Number);
    let dt;
    if (unit === 'day' || unit === 'week') {
      dt = new Date(y, m - 1, d + n * (unit === 'week' ? 7 : 1));
    } else {
      const months = unit === 'year' ? n * 12 : n;
      const lastDay = new Date(y, m - 1 + months + 1, 0).getDate();
      dt = new Date(y, m - 1 + months, Math.min(d, lastDay));
    }
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((new Date(y, m - 1, d).getTime() - t.getTime()) / DAY);
  }

  function intervalLabel(p) { return '每 ' + (p.intervalValue || 1) + ' ' + (UNIT_LABEL[p.intervalUnit] || ''); }

  /* ---------- plans ---------- */
  function listPlans(equipmentId) {
    const all = S.read(S.KEYS.maintenancePlans, []);
    return equipmentId ? all.filter(p => p.equipmentId === equipmentId) : all;
  }
  function savePlans(all) { S.write(S.KEYS.maintenancePlans, all); }
  function getPlan(id) { return listPlans().find(p => p.id === id) || null; }

  function eqName(id) { const eq = EPM.equipment.get(id); return eq ? eq.name : id; }

  function createPlan(data) {
    const all = listPlans();
    const now = Date.now();
    const plan = {
      id: S.uid('mp'),
      equipmentId: data.equipmentId,
      title: (data.title || '').trim() || '定期保養',
      intervalValue: Math.max(1, Number(data.intervalValue) || 1),
      intervalUnit: UNIT_LABEL[data.intervalUnit] ? data.intervalUnit : 'month',
      nextDueDate: data.nextDueDate || todayStr(),
      lastDoneDate: data.lastDoneDate || '',
      remindDays: Math.max(0, Number(data.remindDays) || 7),
      vendor: data.vendor || '',
      estimatedCost: Number(data.estimatedCost) || 0,
      notes: data.notes || '',
      active: true,
      createdAt: now, updatedAt: now
    };
    all.push(plan);
    savePlans(all);
    EPM.auth.logActivity('新增保養排程', eqName(plan.equipmentId), plan.title + '（' + intervalLabel(plan) + '）');
    return plan;
  }

  function updatePlan(id, patch) {
    const all = listPlans();
    const idx = all.findIndex(p => p.id === id);
    if (idx === -1) return null;
    patch = { ...patch };
    if (patch.intervalValue !== undefined) patch.intervalValue = Math.max(1, Number(patch.intervalValue) || 1);
    if (patch.remindDays !== undefined) patch.remindDays = Math.max(0, Number(patch.remindDays) || 0);
    if (patch.estimatedCost !== undefined) patch.estimatedCost = Number(patch.estimatedCost) || 0;
    all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() };
    savePlans(all);
    EPM.auth.logActivity('編輯保養排程', eqName(all[idx].equipmentId), all[idx].title);
    return all[idx];
  }

  function removePlan(id) {
    const all = listPlans();
    const target = all.find(p => p.id === id);
    savePlans(all.filter(p => p.id !== id));
    if (target) EPM.auth.logActivity('刪除保養排程', eqName(target.equipmentId), target.title);
  }

  // Records a finished maintenance against a plan and rolls the plan's next
  // due date forward by one interval from the day the work was actually done.
  function completePlan(planId, data) {
    const plan = getPlan(planId);
    if (!plan) return null;
    const date = data.date || todayStr();
    const log = addLog({
      equipmentId: plan.equipmentId, planId: plan.id, type: 'maintenance', status: 'done',
      date, completedDate: date, title: plan.title,
      description: data.description, cost: data.cost, vendor: data.vendor || plan.vendor, photos: data.photos
    }, true);
    updatePlan(plan.id, { lastDoneDate: date, nextDueDate: addInterval(date, plan.intervalValue, plan.intervalUnit) });
    EPM.auth.logActivity('完成保養', eqName(plan.equipmentId), plan.title + ' ' + date);
    return log;
  }

  // Plans with a due status attached, soonest first. Inactive (paused) plans
  // and plans of retired equipment are skipped.
  function planStatus(p) {
    const daysLeft = daysUntil(p.nextDueDate);
    const tier = daysLeft === null ? 'none' : daysLeft < 0 ? 'overdue' : daysLeft <= (p.remindDays || 0) ? 'soon' : 'ok';
    return { ...p, daysLeft, tier };
  }
  function schedule() {
    return listPlans()
      .filter(p => p.active !== false)
      .filter(p => { const eq = EPM.equipment.get(p.equipmentId); return eq && eq.status !== 'retired'; })
      .map(planStatus)
      .sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
  }
  function dueSoon() { return schedule().filter(p => p.tier === 'overdue' || p.tier === 'soon'); }

  /* ---------- logs ---------- */
  function listLogs(equipmentId) {
    const all = S.read(S.KEYS.maintenanceLogs, []);
    return equipmentId ? all.filter(l => l.equipmentId === equipmentId) : all;
  }
  function saveLogs(all) { S.write(S.KEYS.maintenanceLogs, all); }

  function addLog(data, silent) {
    const all = listLogs();
    const user = EPM.auth.getCurrentUser();
    const now = Date.now();
    const type = data.type === 'repair' ? 'repair' : 'maintenance';
    const status = data.status === 'open' ? 'open' : 'done';
    const log = {
      id: S.uid('ml'),
      equipmentId: data.equipmentId,
      planId: data.planId || '',
      type, status,
      date: data.date || todayStr(),
      completedDate: status === 'done' ? (data.completedDate || data.date || todayStr()) : '',
      title: (data.title || '').trim() || (type === 'repair' ? '設備維修' : '保養'),
      description: data.description || '',
      cost: Number(data.cost) || 0,
      vendor: data.vendor || '',
      operator: (user && user.name) || data.operator || '',
      photos: Array.isArray(data.photos) ? data.photos : [],
      createdAt: now, updatedAt: now
    };
    all.push(log);
    saveLogs(all);
    if (!silent) {
      EPM.auth.logActivity(status === 'open' ? '新增報修' : '新增' + LOG_TYPE_LABEL[type] + '紀錄', eqName(log.equipmentId), log.title);
    }
    return log;
  }

  function updateLog(id, patch) {
    const all = listLogs();
    const idx = all.findIndex(l => l.id === id);
    if (idx === -1) return null;
    patch = { ...patch };
    if (patch.cost !== undefined) patch.cost = Number(patch.cost) || 0;
    all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() };
    saveLogs(all);
    return all[idx];
  }

  // Closes an open repair ticket.
  function closeRepair(id, data) {
    const patch = { status: 'done', completedDate: data.completedDate || todayStr(), cost: data.cost };
    ['vendor', 'description'].forEach(k => { if (data[k] !== undefined) patch[k] = data[k]; });
    if (Array.isArray(data.photos)) patch.photos = data.photos;
    const log = updateLog(id, patch);
    if (log) EPM.auth.logActivity('維修結案', eqName(log.equipmentId), log.title);
    return log;
  }

  function removeLog(id) {
    const all = listLogs();
    const target = all.find(l => l.id === id);
    saveLogs(all.filter(l => l.id !== id));
    if (target) EPM.auth.logActivity('刪除' + LOG_TYPE_LABEL[target.type] + '紀錄', eqName(target.equipmentId), target.title);
  }

  function openRepairs() { return listLogs().filter(l => l.type === 'repair' && l.status === 'open'); }

  function removeByEquipment(equipmentId) {
    savePlans(listPlans().filter(p => p.equipmentId !== equipmentId));
    saveLogs(listLogs().filter(l => l.equipmentId !== equipmentId));
  }

  function costInYear(year) {
    const y = String(year || new Date().getFullYear());
    return listLogs()
      .filter(l => l.status === 'done' && String(l.completedDate || l.date).slice(0, 4) === y)
      .reduce((s, l) => s + (l.cost || 0), 0);
  }

  function exportLogsCSV() {
    const rows = listLogs().slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(l => {
      const eq = EPM.equipment.get(l.equipmentId);
      return { ...l, equipmentCode: eq ? eq.code : '', equipmentName: eq ? eq.name : l.equipmentId };
    });
    const csv = EPM.reports.toCSV(rows, [
      { label: '日期', value: 'date' }, { label: '設備編號', value: 'equipmentCode' }, { label: '設備名稱', value: 'equipmentName' },
      { label: '類型', value: (r) => LOG_TYPE_LABEL[r.type] }, { label: '狀態', value: (r) => r.status === 'open' ? '處理中' : '已完成' },
      { label: '完成日期', value: 'completedDate' }, { label: '項目', value: 'title' }, { label: '說明', value: 'description' },
      { label: '費用', value: 'cost' }, { label: '廠商', value: 'vendor' }, { label: '經辦人', value: 'operator' }
    ]);
    EPM.reports.downloadCSV('保養維修紀錄_' + todayStr() + '.csv', csv);
  }

  window.EPM.maintenance = {
    UNIT_LABEL, LOG_TYPE_LABEL, todayStr, addInterval, daysUntil, intervalLabel,
    listPlans, getPlan, createPlan, updatePlan, removePlan, completePlan, schedule, dueSoon, planStatus,
    listLogs, addLog, updateLog, closeRepair, removeLog, openRepairs, removeByEquipment, costInYear, exportLogsCSV
  };
})();
