/* 設備管家 — dashboard, equipment list/detail and the record forms. */
(function () {
  'use strict';
  const SG = window.SG;
  const { util: U, db: DB, ui: UI, auth: Auth, q: Q } = SG;
  const esc = U.esc;
  const F = (SG.forms = {});
  const STATUSES = ['使用中', '維修中', '閒置', '已汰換'];
  SG.STATUSES = STATUSES;

  const canEdit = () => Auth.can('edit');
  function eqOptions(selected, blank) {
    const list = DB.all('equipment').filter((e) => e.status !== '已汰換' || e.id === selected)
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    const opts = list.map((e) => ({ value: e.id, label: `${e.code || ''} ${e.name}${e.location ? '（' + e.location + '）' : ''}` }));
    return blank ? [{ value: '', label: blank }, ...opts] : opts;
  }
  F.eqOptions = eqOptions;

  // ====================================================== equipment form
  F.equipment = function (existing, preset = {}) {
    const s = DB.settings();
    const isNew = !existing;
    const values = Object.assign({ status: '使用中', code: Q.nextCode(), purchaseDate: U.today(), store: Q.curStore() }, preset, existing || {});
    const fields = [
      { type: 'section', label: '基本資料' },
      { name: 'name', label: '設備名稱', required: true, placeholder: '例如：冷凍櫃、POS 收銀機' },
      { name: 'code', label: '設備編號', hint: '自動產生，可自行修改' },
      ...(s.stores.length ? [{ name: 'store', label: '分店', type: 'select', options: [{ value: '', label: '（未指定）' }, ...new Set([...s.stores, ...(values.store ? [values.store] : [])])] }] : []),
      { name: 'category', label: '分類', list: Q.distinct('category', s.categories), placeholder: '例如：廚房設備' },
      { name: 'area', label: '目前使用工作區', list: Q.distinct('area', s.areas), placeholder: '例如：內場、外場、吧台', hint: '修改後會自動記入「工作區移轉紀錄」' },
      { name: 'location', label: '放置位置', list: Q.distinct('location', s.locations), placeholder: '例如：一樓廚房' },
      { name: 'brand', label: '品牌' },
      { name: 'model', label: '型號' },
      { name: 'serial', label: '序號' },
      { name: 'status', label: '狀態', type: 'select', options: STATUSES },
      { type: 'section', label: '採購與保固' },
      { name: 'purchaseDate', label: '購買日期', type: 'date' },
      { name: 'price', label: '購買金額（含稅）', type: 'number', min: 0 },
      { name: 'vendor', label: '購買廠商', list: Q.vendorNames() },
      { name: 'warrantyUntil', label: '保固到期日', type: 'date' },
      { name: 'lifeYears', label: '預期使用年限（年）', type: 'number', min: 0, step: '0.5', hint: '用來提醒汰換時間' },
      { name: 'owner', label: '負責人' },
      { name: 'note', label: '備註', type: 'textarea', span: 2 }
    ];
    UI.formModal({
      title: isNew ? '新增設備' : '編輯設備：' + existing.name,
      fields, values,
      onSave(v) {
        if (v.code && DB.all('equipment').some((e) => e.code === v.code && (!existing || e.id !== existing.id))) throw new Error('設備編號 ' + v.code + ' 已經被使用');
        const rec = Object.assign({}, existing || {}, preset.replacesId ? { replacesId: preset.replacesId } : {}, v);
        if (v.status === '已汰換' && !rec.retiredAt) rec.retiredAt = U.today();
        if (v.status !== '已汰換') delete rec.retiredAt;
        F.trackArea(rec, existing ? (existing.area || '') : undefined, U.today(), '');
        DB.put('equipment', rec);
        SG.log(isNew ? '新增設備' : '修改設備', rec.name);
        UI.toast(isNew ? '已新增設備' : '已儲存');
        if (isNew) UI.go('#/eq/' + rec.id); else UI.render();
      }
    });
  };

  // Work area (工作區) history: every change of `area` is appended to
  // rec.areaLog = [{ area, date, by, note }] (newest last).
  F.trackArea = function (rec, prevArea, date, note) {
    const now = rec.area || '';
    const log = Array.isArray(rec.areaLog) ? rec.areaLog.slice() : [];
    if (prevArea === undefined) { // new equipment
      if (now) log.push({ area: now, date, by: Auth.current ? Auth.current.name : '', note: note || '啟用' });
    } else if ((prevArea || '') !== now) {
      if (!log.length && prevArea) log.push({ area: prevArea, date: rec.purchaseDate || '', by: '', note: '原工作區' });
      log.push({ area: now || '（未指定）', date, by: Auth.current ? Auth.current.name : '', note: note || '' });
    }
    if (log.length) rec.areaLog = log;
  };
  F.moveArea = function (e) {
    const s = DB.settings();
    UI.formModal({
      title: '移轉工作區：' + e.name, wide: false,
      fields: [
        { type: 'html', html: `<p class="small">目前工作區：<b>${esc(e.area || '（未指定）')}</b></p>` },
        { name: 'area', label: '移到哪個工作區', required: true, list: Q.distinct('area', s.areas).filter((a) => a !== e.area) },
        { name: 'location', label: '新的放置位置（可不改）', list: Q.distinct('location', s.locations), value: e.location || '' },
        { name: 'date', label: '移轉日期', type: 'date', required: true, value: U.today() },
        { name: 'note', label: '原因／備註', placeholder: '例如：外場人手不足借用' }
      ],
      onSave(v) {
        if (v.area === (e.area || '')) throw new Error('工作區沒有改變');
        const rec = Object.assign({}, e, { area: v.area, location: v.location });
        F.trackArea(rec, e.area || '', v.date, v.note);
        DB.put('equipment', rec);
        SG.log('移轉工作區', `${e.name}：${e.area || '（未指定）'} → ${v.area}`);
        UI.toast('已移轉到 ' + v.area);
        UI.render();
      }
    });
  };

  // ====================================================== replacement form
  F.replacement = function (existing, equipmentId) {
    const isNew = !existing;
    const eqId = existing ? existing.equipmentId : equipmentId;
    const values = Object.assign({ date: U.today(), equipmentId: eqId || '' }, existing || {});
    const fields = [
      { name: 'equipmentId', label: '設備', type: 'select', options: eqOptions(eqId, '請選擇設備'), required: true, span: 2 },
      { name: 'date', label: '更換日期', type: 'date', required: true },
      { name: 'item', label: '更換項目', required: true, placeholder: '例如：壓縮機、整台更換', list: [...new Set(DB.all('replacements').map((r) => r.item))] },
      { name: 'reason', label: '更換原因', placeholder: '例如：故障、老舊' },
      { name: 'cost', label: '費用（含稅）', type: 'number', min: 0 },
      { name: 'vendor', label: '施工／購買廠商', list: Q.vendorNames() },
      { name: 'warrantyUntil', label: '新品保固到期', type: 'date' },
      { name: 'oldInfo', label: '舊品說明', placeholder: '舊品型號、狀況' },
      { name: 'newInfo', label: '新品說明', placeholder: '新品品牌、型號' },
      { name: 'note', label: '備註', type: 'textarea', span: 2 }
    ];
    if (isNew) fields.push({ name: 'retire', label: '整機汰換', type: 'checkbox', text: '這次是整台換新：把原設備標記為「已汰換」，接著建立新設備', span: 2 });
    UI.formModal({
      title: isNew ? '新增更換紀錄' : '編輯更換紀錄',
      fields, values,
      onSave(v) {
        const retire = v.retire;
        delete v.retire;
        if (!v.equipmentId) throw new Error('請選擇設備');
        const rec = DB.put('replacements', Object.assign({}, existing || {}, v));
        const eq = DB.get('equipment', v.equipmentId);
        SG.log(isNew ? '新增更換紀錄' : '修改更換紀錄', `${eq ? eq.name : ''}：${v.item}`);
        if (retire && eq) {
          DB.put('equipment', Object.assign({}, eq, { status: '已汰換', retiredAt: v.date }));
          SG.log('設備汰換', eq.name);
          UI.toast('已記錄，請填寫新設備資料');
          setTimeout(() => F.equipment(null, {
            name: eq.name, category: eq.category, location: eq.location, area: eq.area, store: eq.store, owner: eq.owner,
            brand: '', model: v.newInfo || '', purchaseDate: v.date, price: v.cost, vendor: v.vendor,
            warrantyUntil: v.warrantyUntil, lifeYears: eq.lifeYears, replacesId: eq.id,
            note: `取代 ${eq.code || ''} ${eq.name}`.trim()
          }), 200);
        } else UI.toast('已儲存');
        UI.render();
      }
    });
  };

  // ====================================================== quote form
  F.quote = function (existing, preset = {}) {
    const isNew = !existing;
    const values = Object.assign({ date: U.today(), taxMode: 'incl', taxRate: 5 }, preset, existing || {});
    const items = [...new Set(DB.all('quotes').map((q) => q.item))].sort();
    const fields = [
      { name: 'item', label: '報價項目', required: true, list: items, placeholder: '例如：冷氣機 3 噸', hint: '同一個項目名稱的報價會放在一起比價' },
      { name: 'vendor', label: '廠商', required: true, list: Q.vendorNames() },
      { name: 'amount', label: '報價金額', type: 'number', required: true, min: 0 },
      { name: 'taxMode', label: '金額為', type: 'select', options: [{ value: 'incl', label: '含稅' }, { value: 'excl', label: '未稅' }] },
      { name: 'taxRate', label: '稅率（%）', type: 'number', min: 0, step: '0.1' },
      { type: 'html', html: '<div id="tax-preview" class="tax-preview"></div>' },
      { name: 'date', label: '報價日期', type: 'date' },
      { name: 'validUntil', label: '報價有效期限', type: 'date' },
      { name: 'equipmentId', label: '相關設備（可不選）', type: 'select', options: eqOptions(values.equipmentId, '（不指定）') },
      { name: 'contact', label: '聯絡人／電話' },
      { name: 'note', label: '備註／規格說明', type: 'textarea', span: 2 },
      { name: 'adopted', label: '採用', type: 'checkbox', text: '已採用這家報價' }
    ];
    UI.formModal({
      title: isNew ? '新增報價' : '編輯報價',
      fields, values,
      afterRender(body) {
        const upd = () => {
          const a = UI.$('[name=amount]', body).value, m = UI.$('[name=taxMode]', body).value, r = UI.$('[name=taxRate]', body).value;
          const t = U.tax(a, m, r);
          UI.$('#tax-preview', body).innerHTML = a === '' ? '輸入金額後會自動計算未稅、稅額、含稅' :
            `未稅 <b>${U.money(t.excl)}</b>　＋　稅額 <b>${U.money(t.tax)}</b>　＝　含稅 <b>${U.money(t.incl)}</b>`;
        };
        ['amount', 'taxMode', 'taxRate'].forEach((n) => UI.$(`[name=${n}]`, body).addEventListener('input', upd));
        upd();
      },
      onSave(v) {
        if (v.taxRate === '') v.taxRate = 5;
        const t = U.tax(v.amount, v.taxMode, v.taxRate);
        const rec = DB.put('quotes', Object.assign({}, existing || {}, v, { priceIncl: t.incl, priceExcl: t.excl }));
        SG.log(isNew ? '新增報價' : '修改報價', `${rec.item}／${rec.vendor} ${U.money(t.incl)}`);
        UI.toast('已儲存');
        UI.render();
      }
    });
  };

  // ====================================================== maintenance plan form
  F.plan = function (existing, equipmentId) {
    const isNew = !existing;
    const values = Object.assign({ intervalValue: 3, intervalUnit: 'month', remindDays: 7, active: true, equipmentId: equipmentId || '' }, existing || {});
    const fields = [
      { name: 'equipmentId', label: '設備', type: 'select', options: eqOptions(values.equipmentId, '請選擇設備'), required: true, span: 2 },
      { name: 'title', label: '保養項目', required: true, placeholder: '例如：清洗濾網、更換濾心', span: 2 },
      { name: 'intervalValue', label: '每隔', type: 'number', min: 1, required: true },
      { name: 'intervalUnit', label: '單位', type: 'select', options: [{ value: 'day', label: '天' }, { value: 'week', label: '週' }, { value: 'month', label: '個月' }, { value: 'year', label: '年' }] },
      { name: 'lastDone', label: '上次保養日', type: 'date' },
      { name: 'nextDue', label: '下次保養日', type: 'date', hint: '留空會用上次保養日自動推算' },
      { name: 'remindDays', label: '提前幾天提醒', type: 'number', min: 0 },
      { name: 'vendor', label: '保養廠商', list: Q.vendorNames() },
      ...(DB.all('parts').length ? [
        { name: 'partId', label: '每次使用的耗材', type: 'select', options: [{ value: '', label: '（不使用）' }, ...DB.all('parts').map((p) => ({ value: p.id, label: p.name + (p.spec ? ' ' + p.spec : '') }))] },
        { name: 'partQty', label: '耗材數量', type: 'number', min: 0, value: 1 }] : []),
      { name: 'note', label: '備註／步驟', type: 'textarea', span: 2 },
      { name: 'active', label: '啟用', type: 'checkbox', text: '啟用這個保養排程' }
    ];
    UI.formModal({
      title: isNew ? '新增保養排程' : '編輯保養排程', fields, values,
      onSave(v) {
        if (!v.equipmentId) throw new Error('請選擇設備');
        if (!v.nextDue) v.nextDue = U.addInterval(v.lastDone || U.today(), v.lastDone ? v.intervalValue : 0, v.intervalUnit);
        const rec = DB.put('plans', Object.assign({}, existing || {}, v));
        SG.log(isNew ? '新增保養排程' : '修改保養排程', `${Q.eqName(rec.equipmentId)}：${rec.title}`);
        UI.toast('已儲存');
        UI.render();
      }
    });
  };

  // ====================================================== maintenance / repair log form
  F.log = function (existing, preset = {}) {
    const isNew = !existing;
    const plan = preset.planId ? DB.get('plans', preset.planId) : null;
    const values = Object.assign({ date: U.today(), type: '保養', by: Auth.current ? Auth.current.name : '' }, preset, existing || {});
    const fields = [
      { name: 'equipmentId', label: '設備', type: 'select', options: eqOptions(values.equipmentId, '請選擇設備'), required: true, span: 2 },
      { name: 'type', label: '類型', type: 'select', options: ['保養', '維修', '檢查'] },
      { name: 'date', label: '日期', type: 'date', required: true },
      { name: 'title', label: '項目／問題', required: true, placeholder: '例如：清洗濾網、壓縮機異音' },
      { name: 'cost', label: '費用（含稅）', type: 'number', min: 0 },
      { name: 'vendor', label: '廠商／師傅', list: Q.vendorNames() },
      { name: 'by', label: '經手人' },
      { name: 'content', label: '處理內容', type: 'textarea', span: 2 },
      { type: 'section', label: '使用的耗材（會自動扣庫存）' },
      { type: 'html', html: SG.partRows.html(existing ? SG.partRows.of(existing.id) : (preset.parts || (plan && plan.partId ? [{ partId: plan.partId, qty: plan.partQty || 1 }] : []))) }
    ];
    if (isNew) fields.push({ name: 'setRepair', label: '設備狀態', type: 'select', options: [{ value: '', label: '不變更' }, { value: '使用中', label: '改為「使用中」（已修好）' }, { value: '維修中', label: '改為「維修中」（送修／待修）' }] });
    if (isNew) fields.push({ type: 'html', html: '<p class="small muted">發票、保固單照片可以在儲存後，到設備頁面的紀錄上按 📎 加入。</p>' });
    delete values.parts;
    UI.formModal({
      title: plan ? '完成保養：' + plan.title : (isNew ? '新增保養／維修紀錄' : '編輯紀錄'), fields, values,
      onSave(v, api) {
        if (!v.equipmentId) throw new Error('請選擇設備');
        const setRepair = v.setRepair;
        delete v.setRepair;
        const partRows = SG.partRows.read(api.body);
        const rec = DB.put('logs', Object.assign({}, existing || {}, v, plan ? { planId: plan.id } : {}));
        if (partRows.length || (existing && SG.partRows.of(existing.id).length)) SG.partRows.apply(rec, partRows);
        if (plan) {
          const last = plan.lastDone && plan.lastDone > v.date ? plan.lastDone : v.date;
          DB.put('plans', Object.assign({}, plan, { lastDone: last, nextDue: U.addInterval(last, plan.intervalValue, plan.intervalUnit) }));
        }
        if (setRepair) {
          const eq = DB.get('equipment', v.equipmentId);
          if (eq && eq.status !== setRepair) DB.put('equipment', Object.assign({}, eq, { status: setRepair }));
        }
        SG.log(isNew ? `新增${v.type}紀錄` : `修改${v.type}紀錄`, `${Q.eqName(rec.equipmentId)}：${rec.title}`);
        UI.toast(plan ? '已完成，下次保養日已更新' : '已儲存');
        UI.render();
      }
    });
  };

  // Generic delete with confirmation.
  F.remove = async function (coll, rec, label) {
    if (!(await UI.confirm(`確定要刪除「${label}」嗎？刪除後無法復原。`, { ok: '刪除', danger: true }))) return false;
    DB.remove(coll, rec.id);
    SG.log('刪除' + ({ equipment: '設備', replacements: '更換紀錄', quotes: '報價', plans: '保養排程', logs: '保養維修紀錄', vendors: '廠商', users: '帳號' }[coll] || ''), label);
    UI.toast('已刪除');
    return true;
  };

  // ====================================================== dashboard
  UI.route('/dash', function (main) {
    const eqs = Q.eqs();
    const active = eqs.filter((e) => e.status !== '已汰換');
    const plans = DB.all('plans').filter((p) => p.active && DB.get('equipment', p.equipmentId) && Q.inStoreRec(p));
    const repairs = Q.openRepairs().sort((a, b) => (a.urgency === '緊急' ? 0 : 1) - (b.urgency === '緊急' ? 0 : 1) || b.reportedAt - a.reportedAt);
    const lowParts = Q.curStore() ? [] : Q.lowParts();
    const due = plans.map((p) => ({ p, s: Q.planStatus(p) })).filter((x) => x.s.key === 'overdue' || x.s.key === 'soon')
      .sort((a, b) => (a.p.nextDue || '').localeCompare(b.p.nextDue || ''));
    const overdue = due.filter((x) => x.s.key === 'overdue').length;
    const exp = Q.expenses();
    const ym = U.today().slice(0, 7), y = U.today().slice(0, 4);
    const monthSum = exp.filter((x) => (x.date || '').startsWith(ym)).reduce((t, x) => t + x.amount, 0);
    const yearSum = exp.filter((x) => (x.date || '').startsWith(y)).reduce((t, x) => t + x.amount, 0);
    const warranty = active.map((e) => ({ e, w: Q.warrantyStatus(e) })).filter((x) => x.w && x.w.key === 'soon');
    const aging = active.filter((e) => e.lifeYears && Q.ageYears(e) != null && Q.ageYears(e) >= U.num(e.lifeYears));
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}`;
      months.push({ label: (d.getMonth() + 1) + '月', value: exp.filter((x) => (x.date || '').startsWith(key)).reduce((t, x) => t + x.amount, 0) });
    }
    const recent = [
      ...DB.all('replacements').filter((r) => Q.inStoreRec(r)).map((r) => ({ date: r.date, at: r.updatedAt, icon: '🔁', text: `${Q.eqName(r.equipmentId)}：更換${r.item}`, cost: r.cost, href: '#/eq/' + r.equipmentId })),
      ...DB.all('logs').filter((l) => Q.inStoreRec(l)).map((l) => ({ date: l.date, at: l.updatedAt, icon: l.type === '維修' ? '🛠️' : '🧽', text: `${Q.eqName(l.equipmentId)}：${l.type} ${l.title}`, cost: l.cost, href: '#/eq/' + l.equipmentId }))
    ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.at - a.at).slice(0, 8);

    const kpi = (icon, label, val, href, cls = '') => `<a class="kpi ${cls}" href="${href}"><span class="kpi-icon">${icon}</span><span class="kpi-val">${val}</span><span class="kpi-lab">${label}</span></a>`;
    main.innerHTML = `
      ${UI.pageHead('總覽', `<button class="btn" data-scan>📷 掃描 QR</button><button class="btn" id="d-repair">🛠️ 我要報修</button>${canEdit() ? `<button class="btn primary" id="d-add">＋ 新增設備</button>` : ''}`, `${esc(DB.settings().orgName)}${Q.curStore() ? '・' + esc(Q.curStore()) : ''}・${U.today()}`)}
      <div class="kpis">
        ${kpi('🧰', '待處理報修', repairs.length, '#/repairs', repairs.some((r) => r.urgency === '緊急') ? 'danger' : repairs.length ? 'warn' : '')}
        ${kpi('🗄️', '使用中設備', active.filter((e) => e.status === '使用中').length, '#/equipment')}
        ${kpi('🛠️', '維修中', active.filter((e) => e.status === '維修中').length, '#/equipment?status=維修中', active.some((e) => e.status === '維修中') ? 'warn' : '')}
        ${kpi('⏰', '逾期保養', overdue, '#/maint', overdue ? 'danger' : '')}
        ${kpi('📅', '7 天內保養', due.length - overdue, '#/maint')}
        ${kpi('💸', '本月支出', U.money(monthSum), '#/reports')}
        ${kpi('📈', y + ' 年支出', U.money(yearSum), '#/reports')}
      </div>
      <div class="grid-2">
        ${repairs.length ? `<section class="card">
          <div class="card-head"><h2>待處理報修</h2><a href="#/repairs" class="link">全部 ›</a></div>
          <ul class="list">${repairs.slice(0, 6).map((r) => `<li class="list-row"><a href="#/repair/${r.id}" class="grow"><b>${r.urgency === '緊急' ? '🚨 ' : ''}${esc(r.title)}</b><small>${esc(Q.eqName(r.equipmentId))}・${esc(r.reporter || '')}・${U.fmtTime(r.reportedAt)}</small></a>${SG.repairBadge(r.status)}</li>`).join('')}</ul>
        </section>` : ''}
        <section class="card">
          <div class="card-head"><h2>待辦保養</h2><a href="#/maint" class="link">全部 ›</a></div>
          ${due.length ? `<ul class="list">${due.slice(0, 8).map(({ p, s }) => `<li class="list-row">
            <a href="#/eq/${p.equipmentId}" class="grow"><b>${esc(p.title)}</b><small>${esc(Q.eqName(p.equipmentId))}・${p.nextDue}</small></a>
            ${UI.badge(s.label, s.key === 'overdue' ? 'b-red' : 'b-amber')}
            ${canEdit() ? `<button class="btn sm" data-done="${p.id}">完成</button>` : ''}</li>`).join('')}</ul>` : UI.empty('近期沒有需要保養的設備', '✅')}
        </section>
        <section class="card">
          <div class="card-head"><h2>近 12 個月支出</h2><a href="#/reports" class="link">報表 ›</a></div>
          ${UI.barChart(months)}
        </section>
        <section class="card">
          <div class="card-head"><h2>最近更換與維修</h2></div>
          ${recent.length ? `<ul class="list">${recent.map((r) => `<li class="list-row"><a href="${r.href}" class="grow"><b>${r.icon} ${esc(r.text)}</b><small>${r.date || ''}</small></a>${U.num(r.cost) ? `<span class="money">${U.money(r.cost)}</span>` : ''}</li>`).join('')}</ul>` : UI.empty('還沒有更換或維修紀錄')}
        </section>
        <section class="card">
          <div class="card-head"><h2>需要注意</h2></div>
          ${warranty.length || aging.length || lowParts.length ? `<ul class="list">
            ${lowParts.map((p) => `<li class="list-row"><a href="#/parts" class="grow"><b>📦 ${esc(p.name)}</b><small>庫存 ${Q.stockOf(p.id)} ${esc(p.unit || '')}（安全量 ${p.minQty}）</small></a>${UI.badge('需補貨', 'b-red')}</li>`).join('')}
            ${warranty.map(({ e, w }) => `<li class="list-row"><a href="#/eq/${e.id}" class="grow"><b>${esc(e.name)}</b><small>保固到 ${e.warrantyUntil}</small></a>${UI.badge(w.label, 'b-amber')}</li>`).join('')}
            ${aging.map((e) => `<li class="list-row"><a href="#/eq/${e.id}" class="grow"><b>${esc(e.name)}</b><small>已使用 ${Q.ageYears(e).toFixed(1)} 年（預期 ${e.lifeYears} 年）</small></a>${UI.badge('建議汰換', 'b-red')}</li>`).join('')}
          </ul>` : UI.empty('目前沒有保固到期或超過使用年限的設備', '👍')}
        </section>
      </div>`;
    const add = UI.$('#d-add', main);
    if (add) add.onclick = () => F.equipment(null);
    UI.$('#d-repair', main).onclick = () => F.repair(null);
    UI.$$('[data-done]', main).forEach((b) => (b.onclick = () => {
      const p = DB.get('plans', b.dataset.done);
      F.log(null, { equipmentId: p.equipmentId, title: p.title, type: '保養', planId: p.id, vendor: p.vendor || '' });
    }));
  });

  // ====================================================== equipment list
  const listState = { q: '', category: '', location: '', area: '', status: 'active', sort: 'code' };
  UI.route('/equipment', (main) => renderList(main));
  UI.route('/equipment\\?(.*)', (main, qs) => {
    const p = new URLSearchParams(qs);
    if (p.get('status')) listState.status = p.get('status');
    renderList(main);
  });
  function renderList(main) {
    const all = Q.eqs();
    const cats = Q.distinct('category'), locs = Q.distinct('location'), areas = Q.distinct('area');
    let current = [];
    main.innerHTML = `
      ${UI.pageHead('設備清單', `
        ${canEdit() ? `<button class="btn primary" id="e-add">＋ 新增設備</button>` : ''}
        <button class="btn" id="e-print">🖨️ 列印清冊</button>
        <button class="btn" id="e-export">匯出 Excel</button>
        ${canEdit() ? `<button class="btn" id="e-import">匯入 Excel／CSV</button>` : ''}`, Q.curStore() ? '分店：' + esc(Q.curStore()) : '')}
      <div class="toolbar card">
        <input type="search" id="e-q" placeholder="🔍 搜尋名稱、編號、品牌、型號、序號…" value="${esc(listState.q)}">
        <select id="e-cat"><option value="">全部分類</option>${cats.map((c) => `<option ${c === listState.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        ${areas.length ? `<select id="e-area"><option value="">全部工作區</option>${areas.map((c) => `<option ${c === listState.area ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
        <select id="e-loc"><option value="">全部位置</option>${locs.map((c) => `<option ${c === listState.location ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="e-sort">
          ${[['code', '依編號'], ['name', '依名稱'], ['purchase', '依購買日（新→舊）'], ['price', '依金額（高→低）'], ['area', '依工作區'], ['location', '依位置']].map(([v, l]) => `<option value="${v}" ${listState.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="chips" id="e-status">
        ${[['active', '使用中＋維修中＋閒置'], ...STATUSES.map((s) => [s, s]), ['all', '全部']].map(([v, l]) => `<button class="chip ${listState.status === v ? 'on' : ''}" data-v="${v}">${l} <i>${v === 'all' ? all.length : v === 'active' ? all.filter((e) => e.status !== '已汰換').length : all.filter((e) => (e.status || '使用中') === v).length}</i></button>`).join('')}
      </div>
      <div id="e-list"></div>`;
    const draw = () => {
      const q = listState.q.toLowerCase();
      let rows = all.filter((e) => {
        const st = e.status || '使用中';
        if (listState.status === 'active' && st === '已汰換') return false;
        if (STATUSES.includes(listState.status) && st !== listState.status) return false;
        if (listState.category && e.category !== listState.category) return false;
        if (listState.location && e.location !== listState.location) return false;
        if (listState.area && e.area !== listState.area) return false;
        if (q && ![e.name, e.code, e.brand, e.model, e.serial, e.category, e.location, e.vendor, e.note, e.owner, e.store, e.area].some((x) => String(x || '').toLowerCase().includes(q))) return false;
        return true;
      });
      const cmp = {
        code: (a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }),
        name: (a, b) => a.name.localeCompare(b.name, 'zh-Hant'),
        purchase: (a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''),
        price: (a, b) => U.num(b.price) - U.num(a.price),
        location: (a, b) => (a.location || '').localeCompare(b.location || '', 'zh-Hant') || a.name.localeCompare(b.name, 'zh-Hant'),
        area: (a, b) => (a.area || '￿').localeCompare(b.area || '￿', 'zh-Hant') || a.name.localeCompare(b.name, 'zh-Hant')
      }[listState.sort];
      rows.sort(cmp);
      current = rows;
      const total = rows.reduce((t, e) => t + U.num(e.price), 0);
      UI.$('#e-list', main).innerHTML = `<p class="muted small">共 ${rows.length} 台・購買金額合計 ${U.money(total)}</p>` + UI.table(rows, [
        { label: '編號', render: (e) => `<span class="mono">${esc(e.code || '')}</span>`, cls: 'nowrap' },
        { label: '名稱', render: (e) => `<b>${esc(e.name)}</b>${e.brand || e.model ? `<div class="muted small">${esc([e.brand, e.model].filter(Boolean).join(' '))}</div>` : ''}`, cls: 'primary-col' },
        ...(Q.stores().length && !Q.curStore() ? [{ label: '分店', key: 'store' }] : []),
        { label: '分類', key: 'category' },
        { label: '工作區', render: (e) => (e.area ? UI.badge(e.area, 'b-blue') : '') },
        { label: '位置', key: 'location' },
        { label: '照片', render: (e) => { const p = SG.media.list('equipment', e.id)[0]; return p ? `<img class="row-thumb" src="${p.data}" alt="">` : ''; } },
        { label: '購買日', key: 'purchaseDate', cls: 'nowrap' },
        { label: '金額', render: (e) => (U.num(e.price) ? U.money(e.price) : ''), cls: 'num' },
        { label: '狀態', render: (e) => UI.statusBadge(e.status) + (Q.warrantyStatus(e) && Q.warrantyStatus(e).key === 'soon' ? ' ' + UI.badge('保固將到期', 'b-amber') : '') }
      ], { onRow: (e) => e.id, empty: all.length ? '找不到符合條件的設備' : '還沒有設備，按「＋ 新增設備」開始建立' });
      UI.$$('#e-list tr[data-row]', main).forEach((tr) => (tr.onclick = () => UI.go('#/eq/' + tr.dataset.row)));
    };
    UI.$('#e-q', main).addEventListener('input', U.debounce((e) => { listState.q = e.target.value.trim(); draw(); }, 150));
    UI.$('#e-cat', main).onchange = (e) => { listState.category = e.target.value; draw(); };
    UI.$('#e-loc', main).onchange = (e) => { listState.location = e.target.value; draw(); };
    const ar = UI.$('#e-area', main); if (ar) ar.onchange = (e) => { listState.area = e.target.value; draw(); };
    UI.$('#e-sort', main).onchange = (e) => { listState.sort = e.target.value; draw(); };
    UI.$$('#e-status .chip', main).forEach((c) => (c.onclick = () => {
      listState.status = c.dataset.v;
      UI.$$('#e-status .chip', main).forEach((x) => x.classList.toggle('on', x === c));
      draw();
    }));
    const add = UI.$('#e-add', main); if (add) add.onclick = () => F.equipment(null);
    UI.$('#e-export', main).onclick = () => exportEquipment(current);
    UI.$('#e-print', main).onclick = () => printEquipmentList(current);
    const imp = UI.$('#e-import', main); if (imp) imp.onclick = importEquipment;
    draw();
  }

  function printEquipmentList(rows) {
    const withStore = Q.stores().length && !Q.curStore();
    const total = rows.reduce((t, e) => t + U.num(e.price), 0);
    SG.print('設備清冊', `<p class="pd-sub">共 ${rows.length} 台・購買金額合計 ${U.money(total)}</p>` + SG.printTable(
      ['編號', '設備名稱', ...(withStore ? ['分店'] : []), '分類', '工作區', '位置', '品牌／型號', '購買日', '金額', '保固到期', '狀態'],
      rows.map((e) => [e.code, e.name, ...(withStore ? [e.store || ''] : []), e.category, e.area, e.location, [e.brand, e.model].filter(Boolean).join(' '), e.purchaseDate, U.num(e.price) ? U.money(e.price) : '', e.warrantyUntil, e.status || '使用中']),
      { numCols: [withStore ? 8 : 7] }), { landscape: true });
  }

  const EQ_COLS = [['code', '設備編號'], ['name', '設備名稱'], ['store', '分店'], ['category', '分類'], ['area', '使用工作區'], ['location', '放置位置'], ['brand', '品牌'], ['model', '型號'], ['serial', '序號'], ['status', '狀態'], ['purchaseDate', '購買日期'], ['price', '購買金額'], ['vendor', '購買廠商'], ['warrantyUntil', '保固到期日'], ['lifeYears', '預期使用年限'], ['owner', '負責人'], ['note', '備註']];
  SG.EQ_COLS = EQ_COLS;
  function exportEquipment(list) {
    const rows = [EQ_COLS.map((c) => c[1])].concat(list.map((e) => EQ_COLS.map((c) => e[c[0]] == null ? '' : e[c[0]])));
    SG.excel.save(`設備清單_${U.today()}.xlsx`, [{ name: '設備清單', rows }]).catch((e) => UI.toast(e.message, 'error'));
  }
  function importEquipment() {
    const m = UI.modal({
      title: '匯入設備（Excel／CSV）',
      body: `<p>請選擇 Excel（.xlsx）或 CSV 檔，讀取第一個工作表。第一列需為欄位名稱，可用的欄位：</p>
        <p class="muted small">${EQ_COLS.map((c) => c[1]).join('、')}</p>
        <p class="muted small">只有「設備名稱」必填。設備編號相同的會更新原資料，其餘新增。</p>
        <p><button class="btn" id="tpl">下載 Excel 範本</button></p>
        <input type="file" id="csvf" accept=".xlsx,.xls,.csv,text/csv">`,
      actions: [{ label: '關閉' }]
    });
    UI.$('#tpl', m.body).onclick = () => SG.excel.save('設備匯入範本.xlsx', [{ name: '設備清單', rows: [EQ_COLS.map((c) => c[1]), ['', '冷凍櫃', '', '廚房設備', '一樓廚房', '三洋', 'SRF-500', '', '使用中', '2024-03-01', 35000, '某某冷凍行', '2026-03-01', 8, '王小明', '']] }]).catch((e) => UI.toast(e.message, 'error'));
    UI.$('#csvf', m.body).onchange = async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      let rows;
      try { rows = await SG.excel.readRows(file); } catch (e) { return UI.toast('無法讀取檔案：' + e.message, 'error'); }
      if (rows.length < 2) return UI.toast('檔案裡沒有資料', 'error');
      const head = rows[0].map((h) => h.trim());
      const idx = {};
      EQ_COLS.forEach(([k, l]) => { const i = head.findIndex((h) => h === l || h === k); if (i >= 0) idx[k] = i; });
      if (idx.name == null) return UI.toast('找不到「設備名稱」欄位', 'error');
      let added = 0, updated = 0;
      rows.slice(1).forEach((r) => {
        const v = {};
        Object.entries(idx).forEach(([k, i]) => (v[k] = (r[i] || '').trim()));
        if (!v.name) return;
        if (v.price !== undefined) v.price = v.price === '' ? '' : U.num(v.price);
        if (v.lifeYears !== undefined) v.lifeYears = v.lifeYears === '' ? '' : U.num(v.lifeYears);
        ['purchaseDate', 'warrantyUntil'].forEach((k) => { if (v[k]) v[k] = v[k].replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1'); });
        if (v.status && !STATUSES.includes(v.status)) v.status = '使用中';
        const prev = v.code ? DB.all('equipment').find((e) => e.code === v.code) : null;
        if (prev) { DB.put('equipment', Object.assign({}, prev, v), { quiet: true }); updated++; }
        else { if (!v.code) v.code = Q.nextCode(); if (!v.status) v.status = '使用中'; DB.put('equipment', v, { quiet: true }); added++; }
      });
      DB.changed('equipment');
      SG.log('匯入設備', `新增 ${added}、更新 ${updated}`);
      m.close();
      UI.toast(`匯入完成：新增 ${added} 台、更新 ${updated} 台`);
      UI.render();
    };
  }

  // ====================================================== equipment detail
  UI.route('/eq/:id', function (main, id) {
    const e = DB.get('equipment', id);
    if (!e) { main.innerHTML = UI.pageHead('找不到設備') + UI.empty('這台設備不存在或已被刪除', '❓') + '<p><a class="btn" href="#/equipment">回設備清單</a></p>'; return; }
    const reps = DB.all('replacements').filter((r) => r.equipmentId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const logs = DB.all('logs').filter((l) => l.equipmentId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const plans = DB.all('plans').filter((p) => p.equipmentId === id);
    const quotes = DB.all('quotes').filter((q) => q.equipmentId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const repCost = reps.reduce((t, r) => t + U.num(r.cost), 0);
    const logCost = logs.reduce((t, r) => t + U.num(r.cost), 0);
    const w = Q.warrantyStatus(e);
    const age = Q.ageYears(e);
    const prevEq = e.replacesId ? DB.get('equipment', e.replacesId) : null;
    const nextEq = DB.all('equipment').find((x) => x.replacesId === e.id);
    const repairs = DB.all('repairs').filter((r) => r.equipmentId === id).sort((a, b) => b.reportedAt - a.reportedAt);
    const ed = canEdit();
    const clip = (type, rid) => { const n = SG.media.count(type, rid); return `<button class="icon-btn clip ${n ? 'has' : ''}" data-att="${type}|${rid}" title="附件（發票、保固單、照片）">📎${n ? `<i>${n}</i>` : ''}</button>`; };
    const info = [
      ['編號', e.code], ['分店', e.store], ['使用工作區', e.area], ['分類', e.category], ['位置', e.location], ['品牌', e.brand], ['型號', e.model], ['序號', e.serial],
      ['購買日期', e.purchaseDate], ['購買金額', U.num(e.price) ? U.money(e.price) : ''], ['購買廠商', e.vendor],
      ['保固到期', e.warrantyUntil ? e.warrantyUntil + (w ? ' ' + UI.badge(w.label, w.key === 'ok' ? 'b-green' : w.key === 'soon' ? 'b-amber' : 'b-gray') : '') : ''],
      ['已使用', age != null ? age.toFixed(1) + ' 年' + (e.lifeYears ? `（預期 ${e.lifeYears} 年）` : '') : ''],
      ['負責人', e.owner], ['汰換日期', e.retiredAt]
    ].filter((x) => x[1] !== '' && x[1] != null);

    main.innerHTML = `
      <a href="#/equipment" class="back">‹ 設備清單</a>
      ${UI.pageHead(e.name, `
        ${ed ? `<button class="btn" id="x-edit">✏️ 編輯</button><button class="btn" id="x-move">🔀 移轉工作區</button>` : ''}
        <button class="btn" id="x-print">🖨️ 履歷表</button>
        <button class="btn" id="x-qr">🏷️ QR 標籤</button>
        ${ed ? `<button class="btn danger-ghost" id="x-del">刪除</button>` : ''}`, `<span class="mono">${esc(e.code || '')}</span> ${UI.statusBadge(e.status)}`)}
      <div class="quick-actions ${ed ? '' : 'qa-1'}">
        <button class="qa" id="x-repair"><span>🧰</span>報修</button>
        ${ed ? `<button class="qa" id="x-rep"><span>🔁</span>記錄更換</button>
        <button class="qa" id="x-log"><span>🛠️</span>保養／維修</button>
        <button class="qa" id="x-plan"><span>📅</span>保養排程</button>
        <button class="qa" id="x-quote"><span>💰</span>新增報價</button>` : ''}
      </div>
      <section class="card"><div class="card-head"><h2>設備照片 <small class="muted">外觀、銘牌、安裝位置</small></h2></div>${SG.media.html('equipment', id)}</section>
      ${repairs.length ? `<section class="card"><div class="card-head"><h2>報修紀錄 <small class="muted">${repairs.length} 筆</small></h2></div>
        <ul class="list">${repairs.map((r) => `<li class="list-row"><a class="grow" href="#/repair/${r.id}"><b>${r.urgency === '緊急' ? '🚨 ' : ''}${esc(r.title)}</b><small>${esc(r.reporter || '')}・${U.fmtTime(r.reportedAt)}${r.resolution ? '・' + esc(r.resolution) : ''}</small></a>${SG.repairBadge(r.status)}</li>`).join('')}</ul></section>` : ''}
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h2>設備資料</h2></div>
          <dl class="info">${info.map(([k, v]) => `<div><dt>${k}</dt><dd>${k === '保固到期' || k === '購買金額' ? v : esc(v)}</dd></div>`).join('')}</dl>
          ${prevEq ? `<p class="small">🔗 取代了 <a href="#/eq/${prevEq.id}">${esc(prevEq.code || '')} ${esc(prevEq.name)}</a></p>` : ''}
          ${nextEq ? `<p class="small">🔗 已由 <a href="#/eq/${nextEq.id}">${esc(nextEq.code || '')} ${esc(nextEq.name)}</a> 取代</p>` : ''}
          ${e.note ? `<div class="note">${esc(e.note).replace(/\n/g, '<br>')}</div>` : ''}
          ${(e.areaLog || []).length > 1 ? `<div class="card-head" style="margin-top:14px"><h2>工作區移轉紀錄</h2></div>
          <ol class="area-log">${e.areaLog.slice().reverse().map((a, i) => `<li class="${i === 0 ? 'cur' : ''}"><b>${esc(a.area)}</b>${i === 0 ? ' ' + UI.badge('目前', 'b-blue') : ''}<small>${esc([a.date, a.by, a.note].filter(Boolean).join('・'))}</small></li>`).join('')}</ol>` : ''}
        </section>
        <section class="card">
          <div class="card-head"><h2>費用總計</h2></div>
          <div class="cost-sum">
            <div><span>購買</span><b>${U.money(e.price)}</b></div>
            <div><span>更換</span><b>${U.money(repCost)}</b></div>
            <div><span>保養維修</span><b>${U.money(logCost)}</b></div>
            <div class="total"><span>總持有成本</span><b>${U.money(U.num(e.price) + repCost + logCost)}</b></div>
          </div>
          <div class="card-head" style="margin-top:14px"><h2>保養排程</h2></div>
          ${plans.length ? `<ul class="list">${plans.map((p) => { const s = Q.planStatus(p); return `<li class="list-row">
            <div class="grow"><b>${esc(p.title)}</b><small>每 ${p.intervalValue} ${{ day: '天', week: '週', month: '個月', year: '年' }[p.intervalUnit]}・下次 ${p.nextDue || '—'}</small></div>
            ${UI.badge(s.label, { overdue: 'b-red', soon: 'b-amber', ok: 'b-green' }[s.key] || 'b-gray')}
            ${ed ? `<button class="btn sm" data-pdone="${p.id}">完成</button><button class="icon-btn" data-pedit="${p.id}" title="編輯">✏️</button>` : ''}</li>`; }).join('')}</ul>` : UI.empty('沒有保養排程', '📅')}
        </section>
      </div>
      <section class="card">
        <div class="card-head"><h2>更換紀錄 <small class="muted">${reps.length} 筆</small></h2></div>
        ${UI.table(reps, [
          { label: '日期', key: 'date', cls: 'nowrap' },
          { label: '項目', render: (r) => `<b>${esc(r.item)}</b>${r.reason ? `<div class="muted small">原因：${esc(r.reason)}</div>` : ''}`, cls: 'primary-col' },
          { label: '舊品 → 新品', render: (r) => esc([r.oldInfo, r.newInfo].filter(Boolean).join(' → ')) },
          { label: '廠商', key: 'vendor' },
          { label: '費用', render: (r) => (U.num(r.cost) ? U.money(r.cost) : ''), cls: 'num' },
          { label: '', render: (r) => clip('replacement', r.id) + (ed ? `<button class="icon-btn" data-redit="${r.id}" title="編輯">✏️</button><button class="icon-btn" data-rdel="${r.id}" title="刪除">🗑️</button>` : ''), cls: 'actions' }
        ], { empty: '沒有更換紀錄' })}
      </section>
      <section class="card">
        <div class="card-head"><h2>保養／維修紀錄 <small class="muted">${logs.length} 筆</small></h2></div>
        ${UI.table(logs, [
          { label: '日期', key: 'date', cls: 'nowrap' },
          { label: '類型', render: (l) => UI.badge(l.type || '保養', l.type === '維修' ? 'b-amber' : l.type === '檢查' ? 'b-gray' : 'b-blue') },
          { label: '項目', render: (l) => `<b>${esc(l.title)}</b>${l.content ? `<div class="muted small">${esc(l.content)}</div>` : ''}`, cls: 'primary-col' },
          { label: '廠商／經手', render: (l) => esc([l.vendor, l.by].filter(Boolean).join('／')) },
          { label: '費用', render: (l) => (U.num(l.cost) ? U.money(l.cost) : ''), cls: 'num' },
          { label: '', render: (l) => clip('log', l.id) + (ed ? `<button class="icon-btn" data-ledit="${l.id}" title="編輯">✏️</button><button class="icon-btn" data-ldel="${l.id}" title="刪除">🗑️</button>` : ''), cls: 'actions' }
        ], { empty: '沒有保養或維修紀錄' })}
      </section>
      <section class="card">
        <div class="card-head"><h2>相關報價 <small class="muted">${quotes.length} 筆</small></h2></div>
        ${SG.quoteTable(quotes, { showItem: true })}
      </section>`;

    const on = (sel, fn) => { const el = UI.$(sel, main); if (el) el.onclick = fn; };
    on('#x-edit', () => F.equipment(e));
    on('#x-del', async () => {
      const n = reps.length + logs.length + plans.length + repairs.length;
      if (!(await UI.confirm(`確定刪除「${e.name}」？${n ? `\n連同 ${n} 筆更換／保養／報修紀錄與排程、照片也會一起刪除。` : ''}\n刪除後無法復原。若設備只是不用了，建議改用「編輯 → 狀態：已汰換」保留歷史。`, { ok: '刪除', danger: true }))) return;
      reps.forEach((r) => SG.media.removeFor('replacement', r.id));
      logs.forEach((r) => { SG.media.removeFor('log', r.id); DB.all('stock').filter((m) => m.logId === r.id).forEach((m) => DB.remove('stock', m.id)); });
      repairs.forEach((r) => SG.media.removeFor('repair', r.id));
      SG.media.removeFor('equipment', e.id);
      [...reps.map((r) => ['replacements', r]), ...logs.map((r) => ['logs', r]), ...plans.map((r) => ['plans', r]), ...repairs.map((r) => ['repairs', r])].forEach(([c, r]) => DB.remove(c, r.id));
      DB.remove('equipment', e.id);
      SG.log('刪除設備', e.name);
      UI.toast('已刪除');
      UI.go('#/equipment');
    });
    on('#x-qr', () => SG.labels.preview([e]));
    on('#x-repair', () => F.repair(null, e.id));
    on('#x-print', () => printHistory(e, { reps, logs, plans, repairs, repCost, logCost }));
    SG.media.wire(main);
    UI.$$('[data-att]', main).forEach((b) => (b.onclick = () => attachments(...b.dataset.att.split('|'))));
    on('#x-rep', () => F.replacement(null, e.id));
    on('#x-log', () => F.log(null, { equipmentId: e.id }));
    on('#x-plan', () => F.plan(null, e.id));
    on('#x-quote', () => F.quote(null, { equipmentId: e.id, item: e.name }));
    on('#x-move', () => F.moveArea(e));
    UI.$$('[data-pdone]', main).forEach((b) => (b.onclick = () => { const p = DB.get('plans', b.dataset.pdone); F.log(null, { equipmentId: p.equipmentId, title: p.title, planId: p.id, vendor: p.vendor || '' }); }));
    UI.$$('[data-pedit]', main).forEach((b) => (b.onclick = () => F.plan(DB.get('plans', b.dataset.pedit))));
    UI.$$('[data-redit]', main).forEach((b) => (b.onclick = () => F.replacement(DB.get('replacements', b.dataset.redit))));
    UI.$$('[data-rdel]', main).forEach((b) => (b.onclick = async () => { const r = DB.get('replacements', b.dataset.rdel); if (await F.remove('replacements', r, r.item)) { SG.media.removeFor('replacement', r.id); UI.render(); } }));
    UI.$$('[data-ledit]', main).forEach((b) => (b.onclick = () => F.log(DB.get('logs', b.dataset.ledit))));
    UI.$$('[data-ldel]', main).forEach((b) => (b.onclick = async () => {
      const r = DB.get('logs', b.dataset.ldel);
      if (!(await F.remove('logs', r, r.title))) return;
      SG.media.removeFor('log', r.id);
      DB.all('stock').filter((m) => m.logId === r.id).forEach((m) => DB.remove('stock', m.id)); // return used parts to stock
      UI.render();
    }));
    SG.wireQuoteTable(main);
  });

  // Attachments (invoices, warranty cards, photos) of one replacement/log record.
  function attachments(type, id) {
    const rec = DB.get(type === 'log' ? 'logs' : 'replacements', id);
    if (!rec) return;
    const title = type === 'log' ? `${rec.type || '保養'}：${rec.title}` : `更換：${rec.item}`;
    const m = UI.modal({ title: '附件 — ' + title, wide: true, body: '<div class="att-body"></div>', actions: [{ label: '關閉', kind: 'primary' }], onClose: () => UI.render() });
    const paint = () => {
      const box = UI.$('.att-body', m.body);
      box.innerHTML = `<p class="small muted">${esc(rec.date || '')}・發票、保固單、施工照片都可以放這裡</p>${SG.media.html(type, id, { empty: '沒有附件' })}`;
      SG.media.wire(box, paint);
    };
    paint();
  }

  // Printable history sheet of one piece of equipment.
  function printHistory(e, { reps, logs, plans, repairs, repCost, logCost }) {
    const info = [['編號', e.code], ['分店', e.store], ['使用工作區', e.area], ['分類', e.category], ['位置', e.location], ['品牌', e.brand], ['型號', e.model], ['序號', e.serial],
      ['狀態', e.status || '使用中'], ['購買日期', e.purchaseDate], ['購買金額', U.num(e.price) ? U.money(e.price) : ''], ['購買廠商', e.vendor],
      ['保固到期', e.warrantyUntil], ['預期年限', e.lifeYears ? e.lifeYears + ' 年' : ''], ['負責人', e.owner]].filter((x) => x[1]);
    const photo = SG.media.list('equipment', e.id)[0];
    const qr = SG.labels.svg(e);
    SG.print('設備履歷表：' + e.name, `
      <div class="pd-info">${photo ? `<img class="pd-photo" src="${photo.data}" alt="">` : ''}
        <table class="pd-kv">${info.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>
        <div class="pd-qr">${qr}<small>掃描查看最新紀錄</small></div></div>
      ${e.note ? `<p class="pd-note">備註：${esc(e.note)}</p>` : ''}
      <h2>費用總計</h2>
      ${SG.printTable(['購買', '更換', '保養維修', '總持有成本'], [[U.money(e.price), U.money(repCost), U.money(logCost), U.money(U.num(e.price) + repCost + logCost)]], { numCols: [0, 1, 2, 3] })}
      <h2>更換紀錄（${reps.length}）</h2>
      ${SG.printTable(['日期', '項目', '原因', '舊品 → 新品', '廠商', '費用'], reps.map((r) => [r.date, r.item, r.reason, [r.oldInfo, r.newInfo].filter(Boolean).join(' → '), r.vendor, U.num(r.cost) ? U.money(r.cost) : '']), { numCols: [5] })}
      <h2>保養／維修紀錄（${logs.length}）</h2>
      ${SG.printTable(['日期', '類型', '項目', '處理內容', '廠商／經手', '費用'], logs.map((l) => [l.date, l.type, l.title, l.content, [l.vendor, l.by].filter(Boolean).join('／'), U.num(l.cost) ? U.money(l.cost) : '']), { numCols: [5] })}
      ${repairs.length ? `<h2>報修紀錄（${repairs.length}）</h2>${SG.printTable(['報修時間', '問題', '報修人', '狀態', '處理結果'], repairs.map((r) => [U.fmtTime(r.reportedAt), r.title, r.reporter, r.status, r.resolution]))}` : ''}
      ${plans.length ? `<h2>保養排程</h2>${SG.printTable(['項目', '週期', '上次', '下次'], plans.map((p) => [p.title, `每 ${p.intervalValue} ${{ day: '天', week: '週', month: '個月', year: '年' }[p.intervalUnit] || ''}`, p.lastDone, p.nextDue]))}` : ''}`);
  }
})();
