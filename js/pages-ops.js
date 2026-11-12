/* 設備管家 — repair requests, QR quick actions, consumables (parts), global search. */
(function () {
  'use strict';
  const SG = window.SG;
  const { util: U, db: DB, ui: UI, auth: Auth, q: Q, forms: F, media: M } = SG;
  const esc = U.esc;
  const canEdit = () => Auth.can('edit');

  // ====================================================== repairs (報修)
  const R_STATUS = { '待處理': 'b-red', '處理中': 'b-amber', '已完成': 'b-green', '已取消': 'b-gray' };
  SG.repairBadge = (s) => UI.badge(s, R_STATUS[s] || 'b-gray');

  F.repair = function (existing, equipmentId) {
    const isNew = !existing;
    const values = Object.assign({ urgency: '一般', equipmentId: equipmentId || '', reporter: Auth.current.name, stop: false }, existing || {});
    const fields = [
      { name: 'equipmentId', label: '設備', type: 'select', options: F.eqOptions(values.equipmentId, '請選擇設備'), required: true, span: 2 },
      { name: 'title', label: '問題', required: true, placeholder: '例如：冷凍櫃不冷、漏水、異音', span: 2 },
      { name: 'desc', label: '詳細描述', type: 'textarea', span: 2, placeholder: '什麼時候開始、有什麼狀況…' },
      { name: 'urgency', label: '緊急程度', type: 'select', options: ['一般', '緊急'] },
      { name: 'reporter', label: '報修人' },
      ...(isNew ? [{ name: 'stop', label: '設備狀態', type: 'checkbox', text: '設備暫停使用（標記為「維修中」）', span: 2 },
        { type: 'html', html: '<p class="small muted">送出後可以在報修單上加入故障照片。</p>' }] : [])
    ];
    UI.formModal({
      title: isNew ? '我要報修' : '編輯報修單', fields, values, saveLabel: isNew ? '送出報修' : '儲存',
      onSave(v) {
        if (!v.equipmentId) throw new Error('請選擇設備');
        const stop = v.stop; delete v.stop;
        const rec = DB.put('repairs', Object.assign({ status: '待處理', reportedAt: Date.now(), reporterId: Auth.current.id }, existing || {}, v));
        if (stop) {
          const eq = DB.get('equipment', v.equipmentId);
          if (eq && eq.status !== '維修中') DB.put('equipment', Object.assign({}, eq, { status: '維修中' }));
        }
        SG.log(isNew ? '新增報修' : '修改報修', `${Q.eqName(rec.equipmentId)}：${rec.title}`);
        UI.toast(isNew ? '已送出報修' : '已儲存');
        if (isNew) UI.go('#/repair/' + rec.id); else UI.render();
      }
    });
  };

  function startRepair(r) {
    UI.formModal({
      title: '開始處理：' + r.title, wide: false,
      fields: [
        { name: 'vendor', label: '處理廠商／師傅', list: Q.vendorNames() },
        { name: 'assignee', label: '負責同事', value: Auth.current.name },
        { name: 'expectDate', label: '預計完成日', type: 'date' },
        { name: 'progress', label: '處理說明', type: 'textarea' }
      ],
      values: r,
      onSave(v) {
        DB.put('repairs', Object.assign({}, r, v, { status: '處理中', startedAt: r.startedAt || Date.now() }));
        SG.log('報修處理中', `${Q.eqName(r.equipmentId)}：${r.title}`);
        UI.toast('已更新為處理中');
        UI.render();
      }
    });
  }
  function finishRepair(r) {
    UI.formModal({
      title: '完成報修：' + r.title,
      fields: [
        { name: 'doneDate', label: '完成日期', type: 'date', required: true, value: U.today() },
        { name: 'cost', label: '費用（含稅）', type: 'number', min: 0 },
        { name: 'vendor', label: '處理廠商／師傅', list: Q.vendorNames() },
        { name: 'resolution', label: '處理結果', type: 'textarea', span: 2, required: true, placeholder: '例如：更換溫控器，已恢復正常' },
        { name: 'setOk', label: '設備狀態', type: 'checkbox', text: '設備恢復「使用中」', value: true },
        { name: 'toLog', label: '紀錄', type: 'checkbox', text: '同時寫入這台設備的「維修紀錄」（費用會計入報表）', value: true }
      ],
      values: { vendor: r.vendor },
      onSave(v) {
        let logId = r.logId || '';
        if (v.toLog) {
          const log = DB.put('logs', Object.assign(logId ? DB.get('logs', logId) || {} : {}, {
            equipmentId: r.equipmentId, type: '維修', date: v.doneDate, title: r.title,
            content: v.resolution, cost: v.cost, vendor: v.vendor, by: r.assignee || Auth.current.name, repairId: r.id
          }));
          logId = log.id;
        }
        DB.put('repairs', Object.assign({}, r, { status: '已完成', doneDate: v.doneDate, cost: v.cost, vendor: v.vendor, resolution: v.resolution, logId, doneAt: Date.now() }));
        if (v.setOk) {
          const eq = DB.get('equipment', r.equipmentId);
          if (eq && eq.status === '維修中') DB.put('equipment', Object.assign({}, eq, { status: '使用中' }));
        }
        SG.log('報修完成', `${Q.eqName(r.equipmentId)}：${r.title}`);
        UI.toast('報修已完成');
        UI.render();
      }
    });
  }

  let rFilter = 'open';
  UI.route('/repairs', function (main) {
    const all = DB.all('repairs').filter((r) => Q.inStoreRec(r));
    const groups = { open: (r) => r.status === '待處理' || r.status === '處理中', done: (r) => r.status === '已完成', cancel: (r) => r.status === '已取消', all: () => true };
    const rows = all.filter(groups[rFilter]).sort((a, b) => (a.urgency === '緊急' ? 0 : 1) - (b.urgency === '緊急' ? 0 : 1) || b.reportedAt - a.reportedAt);
    if (rFilter !== 'open') rows.sort((a, b) => b.reportedAt - a.reportedAt);
    main.innerHTML = `${UI.pageHead('報修', `<button class="btn" data-scan>📷 掃描設備報修</button><button class="btn primary" id="r-new">＋ 我要報修</button>`, '同事掃設備上的 QR 標籤也可以直接報修')}
      <div class="chips">${[['open', '待處理＋處理中'], ['done', '已完成'], ['cancel', '已取消'], ['all', '全部']].map(([k, l]) => `<button class="chip ${rFilter === k ? 'on' : ''}" data-f="${k}">${l} <i>${all.filter(groups[k]).length}</i></button>`).join('')}</div>
      <section class="card">${rows.length ? `<ul class="list">${rows.map((r) => `<li class="list-row">
        <a class="grow" href="#/repair/${r.id}"><b>${r.urgency === '緊急' ? '🚨 ' : ''}${esc(r.title)}</b>
        <small>${esc(Q.eqName(r.equipmentId))}・${esc(r.reporter || '')} 報修於 ${U.fmtTime(r.reportedAt)}${r.vendor ? '・' + esc(r.vendor) : ''}${M.count('repair', r.id) ? '・📷 ' + M.count('repair', r.id) : ''}</small></a>
        ${SG.repairBadge(r.status)}</li>`).join('')}</ul>` : UI.empty(rFilter === 'open' ? '目前沒有待處理的報修 👍' : '沒有報修單', '🧰')}</section>`;
    UI.$('#r-new', main).onclick = () => F.repair(null);
    UI.$$('.chip', main).forEach((c) => (c.onclick = () => { rFilter = c.dataset.f; UI.render(); }));
  });

  UI.route('/repair/:id', function (main, id) {
    const r = DB.get('repairs', id);
    if (!r) { main.innerHTML = UI.pageHead('找不到報修單') + UI.empty('這張報修單不存在或已刪除', '❓'); return; }
    const eq = DB.get('equipment', r.equipmentId);
    const mine = r.reporterId === Auth.current.id;
    const ed = canEdit();
    const steps = [['待處理', r.reportedAt], ['處理中', r.startedAt], ['已完成', r.doneAt]];
    main.innerHTML = `<a href="#/repairs" class="back">‹ 報修</a>
      ${UI.pageHead((r.urgency === '緊急' ? '🚨 ' : '') + r.title, `
        ${ed && r.status === '待處理' ? `<button class="btn primary" id="rp-start">開始處理</button>` : ''}
        ${ed && (r.status === '待處理' || r.status === '處理中') ? `<button class="btn primary" id="rp-done">✔ 完成</button>` : ''}
        ${ed && r.status === '處理中' ? `<button class="btn" id="rp-start">更新進度</button>` : ''}
        ${(ed || mine) && r.status !== '已完成' ? `<button class="btn" id="rp-edit">✏️ 編輯</button>` : ''}
        ${ed && (r.status === '待處理' || r.status === '處理中') ? `<button class="btn danger-ghost" id="rp-cancel">取消報修</button>` : ''}
        ${ed && (r.status === '已完成' || r.status === '已取消') ? `<button class="btn" id="rp-reopen">重新開啟</button>` : ''}
        ${Auth.can('admin') ? `<button class="btn danger-ghost" id="rp-del">刪除</button>` : ''}`, SG.repairBadge(r.status))}
      <div class="steps">${steps.map(([s, t]) => `<div class="step ${t || r.status === s ? 'on' : ''}"><b>${s}</b><small>${t ? U.fmtTime(t) : ''}</small></div>`).join('')}</div>
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>報修內容</h2></div>
          <dl class="info">
            <div><dt>設備</dt><dd>${eq ? `<a href="#/eq/${eq.id}">${esc(eq.code || '')} ${esc(eq.name)}</a>` : '（已刪除）'}</dd></div>
            ${eq && eq.location ? `<div><dt>位置</dt><dd>${esc(eq.location)}</dd></div>` : ''}
            <div><dt>報修人</dt><dd>${esc(r.reporter || '')}</dd></div>
            <div><dt>緊急程度</dt><dd>${esc(r.urgency || '一般')}</dd></div>
            ${r.vendor ? `<div><dt>處理廠商</dt><dd>${esc(r.vendor)}</dd></div>` : ''}
            ${r.assignee ? `<div><dt>負責同事</dt><dd>${esc(r.assignee)}</dd></div>` : ''}
            ${r.expectDate ? `<div><dt>預計完成</dt><dd>${esc(r.expectDate)}</dd></div>` : ''}
            ${r.doneDate ? `<div><dt>完成日期</dt><dd>${esc(r.doneDate)}</dd></div>` : ''}
            ${U.num(r.cost) ? `<div><dt>費用</dt><dd>${U.money(r.cost)}</dd></div>` : ''}
          </dl>
          ${r.desc ? `<div class="note">${esc(r.desc).replace(/\n/g, '<br>')}</div>` : ''}
          ${r.progress ? `<div class="note"><b>處理說明：</b>${esc(r.progress).replace(/\n/g, '<br>')}</div>` : ''}
          ${r.resolution ? `<div class="note ok"><b>處理結果：</b>${esc(r.resolution).replace(/\n/g, '<br>')}</div>` : ''}
        </section>
        <section class="card"><div class="card-head"><h2>照片</h2></div>${M.html('repair', r.id, { editable: ed || mine })}</section>
      </div>`;
    const on = (sel, fn) => UI.$$(sel, main).forEach((b) => (b.onclick = fn));
    on('#rp-start', () => startRepair(r));
    on('#rp-done', () => finishRepair(r));
    on('#rp-edit', () => F.repair(r));
    on('#rp-cancel', async () => {
      if (!(await UI.confirm('確定取消這張報修單？'))) return;
      DB.put('repairs', Object.assign({}, r, { status: '已取消' }));
      SG.log('取消報修', r.title); UI.render();
    });
    on('#rp-reopen', () => { DB.put('repairs', Object.assign({}, r, { status: '待處理', doneAt: null })); SG.log('重新開啟報修', r.title); UI.render(); });
    on('#rp-del', async () => {
      if (!(await UI.confirm(`確定刪除報修單「${r.title}」？無法復原。`, { ok: '刪除', danger: true }))) return;
      M.removeFor('repair', r.id); DB.remove('repairs', r.id); SG.log('刪除報修', r.title); UI.go('#/repairs');
    });
    M.wire(main);
  });

  // ====================================================== QR quick page
  UI.route('/qr/:id', function (main, id) {
    const e = DB.get('equipment', id);
    if (!e) { main.innerHTML = UI.pageHead('找不到設備') + UI.empty('這台設備不存在或已被刪除', '❓'); return; }
    const plans = DB.all('plans').filter((p) => p.equipmentId === id && p.active).map((p) => ({ p, s: Q.planStatus(p) })).sort((a, b) => (a.p.nextDue || '9').localeCompare(b.p.nextDue || '9'));
    const open = DB.all('repairs').filter((r) => r.equipmentId === id && (r.status === '待處理' || r.status === '處理中'));
    const photo = M.list('equipment', id)[0];
    main.innerHTML = `<div class="qr-page">
      <div class="qr-head">${photo ? `<img src="${photo.data}" alt="">` : '<div class="qr-noimg">🗄️</div>'}
        <div><h1>${esc(e.name)}</h1><p class="sub"><span class="mono">${esc(e.code || '')}</span> ${UI.statusBadge(e.status)}</p>
        <p class="small muted">${e.area ? `<b>工作區：${esc(e.area)}</b>・` : ''}${esc([e.store, e.location, e.brand, e.model].filter(Boolean).join('・'))}</p></div></div>
      <div class="qr-actions">
        <button class="qr-btn red" id="qa-repair"><span>🛠️</span>報修</button>
        ${canEdit() ? `<button class="qr-btn teal" id="qa-maint"><span>🧽</span>記錄保養</button>` : ''}
        <a class="qr-btn blue" href="#/eq/${id}"><span>📜</span>看履歷</a>
      </div>
      ${open.length ? `<section class="card"><div class="card-head"><h2>進行中的報修</h2></div><ul class="list">${open.map((r) => `<li class="list-row"><a class="grow" href="#/repair/${r.id}"><b>${esc(r.title)}</b><small>${esc(r.reporter || '')}・${U.fmtTime(r.reportedAt)}</small></a>${SG.repairBadge(r.status)}</li>`).join('')}</ul></section>` : ''}
      ${plans.length ? `<section class="card"><div class="card-head"><h2>保養排程</h2></div><ul class="list">${plans.map(({ p, s }) => `<li class="list-row"><div class="grow"><b>${esc(p.title)}</b><small>下次 ${p.nextDue || '—'}</small></div>${UI.badge(s.label, { overdue: 'b-red', soon: 'b-amber', ok: 'b-green' }[s.key] || 'b-gray')}</li>`).join('')}</ul></section>` : ''}
    </div>`;
    UI.$('#qa-repair', main).onclick = () => F.repair(null, id);
    const mt = UI.$('#qa-maint', main);
    if (mt) mt.onclick = () => {
      const due = plans.find((x) => x.s.key === 'overdue' || x.s.key === 'soon');
      if (due) F.log(null, { equipmentId: id, title: due.p.title, planId: due.p.id, vendor: due.p.vendor || '', parts: due.p.partId ? [{ partId: due.p.partId, qty: due.p.partQty || 1 }] : [] });
      else F.log(null, { equipmentId: id });
    };
  });

  // ====================================================== parts (耗材庫存)
  function partForm(existing) {
    const isNew = !existing;
    const fields = [
      { name: 'name', label: '耗材名稱', required: true, placeholder: '例如：冷氣濾網、RO 濾心' },
      { name: 'spec', label: '規格／型號' },
      { name: 'unit', label: '單位', value: '個', list: ['個', '片', '支', '盒', '組', '包', '瓶', '桶'] },
      { name: 'minQty', label: '安全庫存量', type: 'number', min: 0, hint: '庫存低於或等於這個數量時提醒補貨' },
      { name: 'location', label: '存放位置' },
      { name: 'vendor', label: '常用廠商', list: Q.vendorNames() },
      { name: 'price', label: '參考單價', type: 'number', min: 0 },
      ...(isNew ? [{ name: 'initQty', label: '目前庫存（期初）', type: 'number', min: 0 }] : []),
      { name: 'note', label: '備註', type: 'textarea', span: 2 }
    ];
    UI.formModal({
      title: isNew ? '新增耗材' : '編輯耗材', fields, values: existing || {},
      onSave(v) {
        const init = v.initQty; delete v.initQty;
        const p = DB.put('parts', Object.assign({}, existing || {}, v));
        if (isNew && U.num(init)) DB.put('stock', { partId: p.id, date: U.today(), qty: U.num(init), kind: '期初', by: Auth.current.name });
        SG.log(isNew ? '新增耗材' : '修改耗材', p.name);
        UI.toast('已儲存'); UI.render();
      }
    });
  }
  function moveForm(p, kind) {
    const isIn = kind === '進貨';
    const fields = [
      { name: 'date', label: '日期', type: 'date', required: true, value: U.today() },
      { name: 'qty', label: kind === '調整' ? '盤點後實際數量' : `數量（${p.unit || '個'}）`, type: 'number', required: true, min: 0 },
      ...(isIn ? [{ name: 'cost', label: '總金額（含稅）', type: 'number', min: 0, hint: p.price ? `參考單價 ${U.money(p.price)}` : '' }, { name: 'vendor', label: '廠商', list: Q.vendorNames(), value: p.vendor || '' }] : []),
      ...(kind === '領用' ? [{ name: 'equipmentId', label: '用在哪台設備（可不選）', type: 'select', options: F.eqOptions('', '（不指定）') }] : []),
      { name: 'note', label: '備註' }
    ];
    UI.formModal({
      title: `${kind}：${p.name}（目前 ${Q.stockOf(p.id)} ${p.unit || ''}）`, fields, wide: false,
      onSave(v) {
        let qty = U.num(v.qty);
        if (kind === '領用') qty = -qty;
        if (kind === '調整') qty = qty - Q.stockOf(p.id);
        if (!qty && kind !== '調整') throw new Error('請輸入數量');
        DB.put('stock', Object.assign({}, v, { partId: p.id, qty, kind, by: Auth.current.name }));
        SG.log('耗材' + kind, `${p.name} ${qty > 0 ? '+' : ''}${qty}`);
        UI.toast('已記錄'); UI.render();
      }
    });
  }
  function moveHistory(p) {
    const moves = DB.all('stock').filter((m) => m.partId === p.id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    const m = UI.modal({
      title: p.name + ' 的庫存紀錄', wide: true,
      body: UI.table(moves, [
        { label: '日期', key: 'date', cls: 'nowrap' },
        { label: '類別', render: (x) => UI.badge(x.kind, x.qty > 0 ? 'b-green' : x.qty < 0 ? 'b-amber' : 'b-gray') },
        { label: '數量', render: (x) => `<b>${x.qty > 0 ? '+' : ''}${x.qty}</b>`, cls: 'num' },
        { label: '說明', render: (x) => esc([x.equipmentId ? Q.eqName(x.equipmentId) : '', x.vendor, x.note, x.logId ? '（保養紀錄）' : ''].filter(Boolean).join('・')) },
        { label: '金額', render: (x) => (U.num(x.cost) ? U.money(x.cost) : ''), cls: 'num' },
        { label: '經手', key: 'by' },
        { label: '', render: (x) => canEdit() && !x.logId ? `<button class="icon-btn" data-smd="${x.id}" title="刪除">🗑️</button>` : '', cls: 'actions' }
      ], { empty: '沒有紀錄' }),
      actions: [{ label: '關閉', kind: 'primary' }]
    });
    UI.$$('[data-smd]', m.body).forEach((b) => (b.onclick = async () => {
      if (!(await UI.confirm('刪除這筆庫存紀錄？庫存數量會跟著改變。', { ok: '刪除', danger: true }))) return;
      DB.remove('stock', b.dataset.smd); m.close(); UI.render(); moveHistory(p);
    }));
  }
  let partSearch = '';
  UI.route('/parts', function (main) {
    const parts = DB.all('parts').sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    const low = new Set(Q.lowParts().map((p) => p.id));
    main.innerHTML = `${UI.pageHead('耗材庫存', canEdit() ? `<button class="btn primary" id="p-add">＋ 新增耗材</button>` : '', '濾網、濾心、燈管等；保養時填寫使用的耗材會自動扣庫存')}
      ${low.size ? `<div class="alert">⚠️ 有 ${low.size} 項耗材庫存不足，需要補貨</div>` : ''}
      <div class="toolbar card"><input type="search" id="p-q" placeholder="🔍 搜尋耗材…" value="${esc(partSearch)}"></div>
      <section class="card" id="p-list"></section>`;
    const draw = () => {
      const s = partSearch.toLowerCase();
      const rows = parts.filter((p) => !s || [p.name, p.spec, p.location, p.vendor].some((x) => String(x || '').toLowerCase().includes(s)));
      UI.$('#p-list', main).innerHTML = UI.table(rows, [
        { label: '耗材', render: (p) => `<b>${esc(p.name)}</b>${p.spec ? `<div class="muted small">${esc(p.spec)}</div>` : ''}`, cls: 'primary-col' },
        { label: '庫存', render: (p) => `<b class="${low.has(p.id) ? 'neg' : ''}">${Q.stockOf(p.id)}</b> ${esc(p.unit || '')}${low.has(p.id) ? ' ' + UI.badge('需補貨', 'b-red') : ''}`, cls: 'nowrap' },
        { label: '安全量', render: (p) => (p.minQty === '' || p.minQty == null ? '—' : p.minQty) },
        { label: '存放位置', key: 'location' },
        { label: '廠商', key: 'vendor' },
        { label: '', render: (p) => `<button class="btn sm" data-ph="${p.id}">紀錄</button>${canEdit() ? `<button class="btn sm" data-pin="${p.id}">＋進貨</button><button class="btn sm" data-pout="${p.id}">－領用</button><button class="icon-btn" data-padj="${p.id}" title="盤點調整">⚖️</button><button class="icon-btn" data-pe="${p.id}" title="編輯">✏️</button><button class="icon-btn" data-pd="${p.id}" title="刪除">🗑️</button>` : ''}`, cls: 'actions' }
      ], { empty: parts.length ? '找不到符合的耗材' : '還沒有耗材，按「＋ 新增耗材」開始' });
      const get = (id) => DB.get('parts', id);
      UI.$$('[data-ph]', main).forEach((b) => (b.onclick = () => moveHistory(get(b.dataset.ph))));
      UI.$$('[data-pin]', main).forEach((b) => (b.onclick = () => moveForm(get(b.dataset.pin), '進貨')));
      UI.$$('[data-pout]', main).forEach((b) => (b.onclick = () => moveForm(get(b.dataset.pout), '領用')));
      UI.$$('[data-padj]', main).forEach((b) => (b.onclick = () => moveForm(get(b.dataset.padj), '調整')));
      UI.$$('[data-pe]', main).forEach((b) => (b.onclick = () => partForm(get(b.dataset.pe))));
      UI.$$('[data-pd]', main).forEach((b) => (b.onclick = async () => {
        const p = get(b.dataset.pd);
        if (!(await F.remove('parts', p, p.name))) return;
        DB.all('stock').filter((m) => m.partId === p.id).forEach((m) => DB.remove('stock', m.id));
        UI.render();
      }));
    };
    UI.$('#p-q', main).addEventListener('input', U.debounce((e) => { partSearch = e.target.value.trim(); draw(); }, 150));
    const add = UI.$('#p-add', main); if (add) add.onclick = () => partForm(null);
    draw();
  });

  // Part rows inside the maintenance log form.
  SG.partRows = {
    html(rows) {
      const parts = DB.all('parts').sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
      if (!parts.length) return '<p class="small muted">（尚未建立耗材；到「耗材庫存」新增後，這裡可以選擇使用的耗材並自動扣庫存）</p>';
      const opts = (sel) => `<option value="">（不使用）</option>` + parts.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}${p.spec ? ' ' + esc(p.spec) : ''}（庫存 ${Q.stockOf(p.id)}）</option>`).join('');
      const list = rows && rows.length ? rows.slice(0, 3) : [];
      while (list.length < 3) list.push({ partId: '', qty: 1 });
      return `<div class="part-rows">${list.map((r) => `<div class="part-row"><select class="pr-part">${opts(r.partId)}</select><input class="pr-qty" type="number" min="0" step="1" inputmode="decimal" value="${esc(r.qty || 1)}"></div>`).join('')}</div>`;
    },
    read(root) {
      return UI.$$('.part-row', root).map((row) => ({ partId: UI.$('.pr-part', row).value, qty: U.num(UI.$('.pr-qty', row).value) })).filter((r) => r.partId && r.qty > 0);
    },
    // Replaces the stock movements tied to a log with `rows`.
    apply(log, rows) {
      DB.all('stock').filter((m) => m.logId === log.id).forEach((m) => DB.remove('stock', m.id));
      rows.forEach((r) => DB.put('stock', { partId: r.partId, qty: -r.qty, kind: '領用', date: log.date, equipmentId: log.equipmentId, logId: log.id, note: log.title, by: Auth.current.name }));
    },
    of(logId) { return DB.all('stock').filter((m) => m.logId === logId).map((m) => ({ partId: m.partId, qty: -U.num(m.qty) })); }
  };

  // ====================================================== global search
  UI.route('/search/:q', function (main, q) { renderSearch(main, q); });
  UI.route('/search', function (main) { renderSearch(main, ''); });
  function renderSearch(main, q) {
    const s = q.trim().toLowerCase();
    const has = (...xs) => xs.some((x) => String(x == null ? '' : x).toLowerCase().includes(s));
    const groups = !s ? [] : [
      ['🗄️ 設備', Q.eqs().filter((e) => has(e.name, e.code, e.brand, e.model, e.serial, e.location, e.category, e.note, e.store, e.area)).map((e) => [`#/eq/${e.id}`, `${e.code || ''} ${e.name}`, [e.store, e.area, e.location, e.brand, e.model, e.status].filter(Boolean).join('・')])],
      ['🧰 報修', DB.all('repairs').filter((r) => Q.inStoreRec(r) && has(r.title, r.desc, r.resolution, r.reporter, r.vendor)).map((r) => [`#/repair/${r.id}`, r.title, `${Q.eqName(r.equipmentId)}・${r.status}`])],
      ['🛠️ 保養維修紀錄', DB.all('logs').filter((l) => Q.inStoreRec(l) && has(l.title, l.content, l.vendor, l.by)).map((l) => [`#/eq/${l.equipmentId}`, `${l.type} ${l.title}`, `${Q.eqName(l.equipmentId)}・${l.date}`])],
      ['🔁 更換紀錄', DB.all('replacements').filter((r) => Q.inStoreRec(r) && has(r.item, r.reason, r.oldInfo, r.newInfo, r.vendor, r.note)).map((r) => [`#/eq/${r.equipmentId}`, `更換 ${r.item}`, `${Q.eqName(r.equipmentId)}・${r.date}`])],
      ['💰 報價', DB.all('quotes').filter((x) => has(x.item, x.vendor, x.note, x.contact)).map((x) => ['#/quotes', `${x.item}／${x.vendor}`, `${x.date || ''} ${U.money(x.priceIncl || x.amount)}`])],
      ['📇 廠商', DB.all('vendors').filter((v) => has(v.name, v.contact, v.phone, v.mobile, v.category, v.note, v.taxId)).map((v) => ['#/vendors', v.name, [v.contact, v.phone || v.mobile].filter(Boolean).join('・')])],
      ['📦 耗材', DB.all('parts').filter((p) => has(p.name, p.spec, p.location, p.vendor)).map((p) => ['#/parts', p.name, `庫存 ${Q.stockOf(p.id)} ${p.unit || ''}`])]
    ].filter((g) => g[1].length);
    const total = groups.reduce((t, g) => t + g[1].length, 0);
    main.innerHTML = `${UI.pageHead('搜尋', '<button class="btn" data-scan>📷 掃描 QR Code</button>')}
      <div class="toolbar card"><input type="search" id="gs-q" placeholder="🔍 搜尋設備、報修、紀錄、報價、廠商、耗材…" value="${esc(q)}"></div>
      ${s ? `<p class="muted small">找到 ${total} 筆</p>` : ''}
      ${groups.map(([t, items]) => `<section class="card"><div class="card-head"><h2>${t} <small class="muted">${items.length}</small></h2></div>
        <ul class="list">${items.slice(0, 50).map(([href, title, sub]) => `<li class="list-row"><a class="grow" href="${href}"><b>${esc(title)}</b><small>${esc(sub)}</small></a></li>`).join('')}</ul></section>`).join('')}
      ${s && !total ? UI.empty('找不到「' + q + '」', '🔍') : ''}`;
    const inp = UI.$('#gs-q', main);
    inp.addEventListener('input', U.debounce(() => { history.replaceState(null, '', inp.value.trim() ? '#/search/' + encodeURIComponent(inp.value.trim()) : '#/search'); renderSearch(main, inp.value); const i2 = UI.$('#gs-q', main); i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); }, 250));
    if (!q) setTimeout(() => inp.focus(), 50);
  }
})();
