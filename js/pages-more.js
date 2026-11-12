/* 設備管家 — quotes, maintenance, vendors, reports, labels, users, activity, settings. */
(function () {
  'use strict';
  const SG = window.SG;
  const { util: U, db: DB, ui: UI, auth: Auth, q: Q, forms: F } = SG;
  const esc = U.esc;
  const canEdit = () => Auth.can('edit');
  const UNIT = { day: '天', week: '週', month: '個月', year: '年' };

  // ====================================================== quotes
  const qParts = (q) => {
    const t = U.tax(q.amount != null ? q.amount : q.priceIncl, q.taxMode || 'incl', q.taxRate == null ? 5 : q.taxRate);
    return t;
  };
  SG.quoteTable = function (quotes, { showItem = false, lowestId = null } = {}) {
    const ed = canEdit();
    const today = U.today();
    return UI.table(quotes, [
      ...(showItem ? [{ label: '項目', render: (q) => `<b>${esc(q.item)}</b>`, cls: 'primary-col' }] : []),
      { label: '廠商', render: (q) => `<b>${esc(q.vendor)}</b>${q.contact ? `<div class="muted small">${esc(q.contact)}</div>` : ''}`, cls: showItem ? '' : 'primary-col' },
      { label: '報價日', key: 'date', cls: 'nowrap' },
      { label: '未稅價', render: (q) => U.money(qParts(q).excl) + (q.taxMode === 'excl' ? '<div class="muted small">未稅報價</div>' : ''), cls: 'num' },
      { label: '含稅價', render: (q) => { const t = qParts(q); return `<b class="${q.id === lowestId ? 'lowest' : ''}">${U.money(t.incl)}</b><div class="muted small">稅 ${t.rate}%：${U.money(t.tax)}</div>`; }, cls: 'num' },
      { label: '狀態', render: (q) => [q.id === lowestId ? UI.badge('最低價', 'b-green') : '', q.adopted ? UI.badge('已採用', 'b-blue') : '', q.validUntil && q.validUntil < today ? UI.badge('已過期', 'b-gray') : ''].join(' ') },
      { label: '備註', render: (q) => `<span class="small">${esc(q.note || '')}</span>` },
      { label: '', render: (q) => ed ? `<button class="icon-btn" data-qedit="${q.id}" title="編輯">✏️</button><button class="icon-btn" data-qdel="${q.id}" title="刪除">🗑️</button>` : '', cls: 'actions' }
    ], { empty: '沒有報價' });
  };
  SG.wireQuoteTable = function (root) {
    UI.$$('[data-qedit]', root).forEach((b) => (b.onclick = () => F.quote(DB.get('quotes', b.dataset.qedit))));
    UI.$$('[data-qdel]', root).forEach((b) => (b.onclick = async () => { const q = DB.get('quotes', b.dataset.qdel); if (await F.remove('quotes', q, `${q.item}／${q.vendor}`)) UI.render(); }));
  };

  let quoteSearch = '';
  UI.route('/quotes', function (main) {
    const all = DB.all('quotes');
    main.innerHTML = `${UI.pageHead('報價比價', `${canEdit() ? `<button class="btn primary" id="q-add">＋ 新增報價</button>` : ''}<button class="btn" id="q-export">匯出 Excel</button>`, '同一個「報價項目」的各家報價會放在一起，以含稅價比較')}
      <div class="toolbar card"><input type="search" id="q-q" placeholder="🔍 搜尋項目、廠商…" value="${esc(quoteSearch)}"></div>
      <div id="q-list"></div>`;
    const draw = () => {
      const s = quoteSearch.toLowerCase();
      const groups = {};
      all.filter((q) => !s || [q.item, q.vendor, q.note, q.contact].some((x) => String(x || '').toLowerCase().includes(s)))
        .forEach((q) => (groups[q.item] = groups[q.item] || []).push(q));
      const names = Object.keys(groups).sort((a, b) => {
        const la = Math.max(...groups[a].map((q) => q.updatedAt)), lb = Math.max(...groups[b].map((q) => q.updatedAt));
        return lb - la;
      });
      UI.$('#q-list', main).innerHTML = names.length ? names.map((name) => {
        const qs = groups[name].slice().sort((a, b) => qParts(a).incl - qParts(b).incl);
        const lowest = qs[0], highest = qs[qs.length - 1];
        const diff = qParts(highest).incl - qParts(lowest).incl;
        return `<section class="card">
          <div class="card-head"><h2>${esc(name)} <small class="muted">${qs.length} 家報價</small></h2>
          ${canEdit() ? `<button class="btn sm" data-qadd="${esc(name)}">＋ 報價</button>` : ''}</div>
          ${qs.length > 1 ? `<p class="small muted">最低 <b class="lowest">${U.money(qParts(lowest).incl)}</b>（${esc(lowest.vendor)}），最高與最低相差 ${U.money(diff)}</p>` : ''}
          ${SG.quoteTable(qs, { lowestId: qs.length > 1 ? lowest.id : null })}</section>`;
      }).join('') : UI.empty(all.length ? '找不到符合的報價' : '還沒有報價，按「＋ 新增報價」開始比價', '💰');
      SG.wireQuoteTable(main);
      UI.$$('[data-qadd]', main).forEach((b) => (b.onclick = () => F.quote(null, { item: b.dataset.qadd })));
    };
    UI.$('#q-q', main).addEventListener('input', U.debounce((e) => { quoteSearch = e.target.value.trim(); draw(); }, 150));
    const add = UI.$('#q-add', main); if (add) add.onclick = () => F.quote(null);
    UI.$('#q-export', main).onclick = () => {
      const rows = [['報價項目', '廠商', '聯絡人', '報價日期', '有效期限', '未稅價', '稅額', '含稅價', '稅率(%)', '原始報價為', '已採用', '相關設備', '備註']];
      all.sort((a, b) => a.item.localeCompare(b.item, 'zh-Hant') || qParts(a).incl - qParts(b).incl).forEach((q) => {
        const t = qParts(q);
        rows.push([q.item, q.vendor, q.contact || '', q.date || '', q.validUntil || '', t.excl, t.tax, t.incl, t.rate, q.taxMode === 'excl' ? '未稅' : '含稅', q.adopted ? '是' : '', q.equipmentId ? Q.eqName(q.equipmentId) : '', q.note || '']);
      });
      SG.excel.save(`報價比價_${U.today()}.xlsx`, [{ name: '報價比價', rows }]).catch((e) => UI.toast(e.message, 'error'));
    };
    draw();
  });

  // ====================================================== maintenance
  const mState = { tab: 'plans', filter: 'due', type: '', month: '' };
  UI.route('/maint', function (main) {
    const ed = canEdit();
    main.innerHTML = `${UI.pageHead('保養維修', ed ? `<button class="btn primary" id="m-plan">＋ 保養排程</button><button class="btn" id="m-log">＋ 保養／維修紀錄</button>` : '')}
      <div class="tabs"><button class="tab ${mState.tab === 'plans' ? 'on' : ''}" data-t="plans">保養排程</button><button class="tab ${mState.tab === 'logs' ? 'on' : ''}" data-t="logs">保養維修紀錄</button></div>
      <div id="m-body"></div>`;
    UI.$$('.tab', main).forEach((t) => (t.onclick = () => { mState.tab = t.dataset.t; UI.render(); }));
    const p = UI.$('#m-plan', main); if (p) p.onclick = () => F.plan(null);
    const l = UI.$('#m-log', main); if (l) l.onclick = () => F.log(null);
    const body = UI.$('#m-body', main);
    if (mState.tab === 'plans') {
      const plans = DB.all('plans').filter((p) => DB.get('equipment', p.equipmentId) && Q.inStoreRec(p)).map((p) => ({ p, s: Q.planStatus(p) }));
      const cnt = (k) => plans.filter((x) => k === 'due' ? (x.s.key === 'overdue' || x.s.key === 'soon') : k === 'all' ? true : x.s.key === k).length;
      body.innerHTML = `<div class="chips">${[['due', '待辦（逾期＋即將到期）'], ['overdue', '逾期'], ['ok', '正常'], ['paused', '暫停'], ['all', '全部']].map(([v, lab]) => `<button class="chip ${mState.filter === v ? 'on' : ''}" data-f="${v}">${lab} <i>${cnt(v)}</i></button>`).join('')}</div>
        <div id="m-plans"></div>`;
      const rows = plans.filter((x) => mState.filter === 'due' ? (x.s.key === 'overdue' || x.s.key === 'soon') : mState.filter === 'all' ? true : x.s.key === mState.filter)
        .sort((a, b) => (a.p.nextDue || '9').localeCompare(b.p.nextDue || '9'));
      UI.$('#m-plans', body).innerHTML = UI.table(rows, [
        { label: '下次保養', render: (x) => `<b>${x.p.nextDue || '—'}</b>`, cls: 'nowrap' },
        { label: '狀態', render: (x) => UI.badge(x.s.label, { overdue: 'b-red', soon: 'b-amber', ok: 'b-green' }[x.s.key] || 'b-gray') },
        { label: '保養項目', render: (x) => `<b>${esc(x.p.title)}</b><div class="muted small"><a href="#/eq/${x.p.equipmentId}">${esc(Q.eqName(x.p.equipmentId))}</a></div>`, cls: 'primary-col' },
        { label: '週期', render: (x) => `每 ${x.p.intervalValue} ${UNIT[x.p.intervalUnit] || ''}` },
        { label: '上次', render: (x) => x.p.lastDone || '—', cls: 'nowrap' },
        { label: '廠商', render: (x) => esc(x.p.vendor || '') },
        { label: '', render: (x) => ed ? `<button class="btn sm" data-done="${x.p.id}">完成</button><button class="icon-btn" data-pe="${x.p.id}" title="編輯">✏️</button><button class="icon-btn" data-pd="${x.p.id}" title="刪除">🗑️</button>` : '', cls: 'actions' }
      ], { empty: mState.filter === 'due' ? '目前沒有待辦保養 👍' : '沒有保養排程' });
      UI.$$('.chip', body).forEach((c) => (c.onclick = () => { mState.filter = c.dataset.f; UI.render(); }));
      UI.$$('[data-done]', body).forEach((b) => (b.onclick = () => { const p = DB.get('plans', b.dataset.done); F.log(null, { equipmentId: p.equipmentId, title: p.title, planId: p.id, vendor: p.vendor || '' }); }));
      UI.$$('[data-pe]', body).forEach((b) => (b.onclick = () => F.plan(DB.get('plans', b.dataset.pe))));
      UI.$$('[data-pd]', body).forEach((b) => (b.onclick = async () => { const p = DB.get('plans', b.dataset.pd); if (await F.remove('plans', p, p.title)) UI.render(); }));
    } else {
      const logs = DB.all('logs').filter((l) => Q.inStoreRec(l));
      const months = [...new Set(logs.map((l) => (l.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
      body.innerHTML = `<div class="toolbar card">
        <select id="m-type"><option value="">全部類型</option>${['保養', '維修', '檢查'].map((t) => `<option ${mState.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <select id="m-month"><option value="">全部月份</option>${months.map((m) => `<option ${mState.month === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <button class="btn" id="m-print">🖨️ 列印</button><button class="btn" id="m-exp">匯出 Excel</button></div><div id="m-logs"></div>`;
      const rows = logs.filter((l) => (!mState.type || l.type === mState.type) && (!mState.month || (l.date || '').startsWith(mState.month)))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt);
      const sum = rows.reduce((t, l) => t + U.num(l.cost), 0);
      UI.$('#m-logs', body).innerHTML = `<p class="muted small">共 ${rows.length} 筆・費用合計 ${U.money(sum)}</p>` + UI.table(rows, [
        { label: '日期', key: 'date', cls: 'nowrap' },
        { label: '類型', render: (l) => UI.badge(l.type || '保養', l.type === '維修' ? 'b-amber' : l.type === '檢查' ? 'b-gray' : 'b-blue') },
        { label: '項目', render: (l) => `<b>${esc(l.title)}</b><div class="muted small"><a href="#/eq/${l.equipmentId}">${esc(Q.eqName(l.equipmentId))}</a>${l.content ? '・' + esc(l.content) : ''}</div>`, cls: 'primary-col' },
        { label: '廠商／經手', render: (l) => esc([l.vendor, l.by].filter(Boolean).join('／')) },
        { label: '費用', render: (l) => (U.num(l.cost) ? U.money(l.cost) : ''), cls: 'num' },
        { label: '', render: (l) => ed ? `<button class="icon-btn" data-le="${l.id}" title="編輯">✏️</button><button class="icon-btn" data-ld="${l.id}" title="刪除">🗑️</button>` : '', cls: 'actions' }
      ], { empty: '沒有紀錄' });
      UI.$('#m-type', body).onchange = (e) => { mState.type = e.target.value; UI.render(); };
      UI.$('#m-month', body).onchange = (e) => { mState.month = e.target.value; UI.render(); };
      const logRows = () => rows.map((l) => [l.date, l.type, Q.eqName(l.equipmentId), l.title, l.content || '', l.vendor || '', l.by || '', U.num(l.cost) || '']);
      UI.$('#m-exp', body).onclick = () => SG.excel.save(`保養維修紀錄_${U.today()}.xlsx`, [{ name: '保養維修紀錄', rows: [['日期', '類型', '設備', '項目', '處理內容', '廠商', '經手人', '費用']].concat(logRows()) }]).catch((e) => UI.toast(e.message, 'error'));
      UI.$('#m-print', body).onclick = () => SG.print('保養維修紀錄' + (mState.month ? '（' + mState.month + '）' : ''), `<p class="pd-sub">共 ${rows.length} 筆・費用合計 ${U.money(sum)}</p>` + SG.printTable(['日期', '類型', '設備', '項目', '處理內容', '廠商', '經手人', '費用'], logRows().map((r) => { r[7] = r[7] ? U.money(r[7]) : ''; return r; }), { numCols: [7] }), { landscape: true });
      UI.$$('[data-le]', body).forEach((b) => (b.onclick = () => F.log(DB.get('logs', b.dataset.le))));
      UI.$$('[data-ld]', body).forEach((b) => (b.onclick = async () => { const l = DB.get('logs', b.dataset.ld); if (await F.remove('logs', l, l.title)) UI.render(); }));
    }
  });

  // ====================================================== vendors
  // Business cards: front/back photos stored in the `cards` collection.
  const SIDES = [['front', '正面'], ['back', '反面']];
  const cardId = (vid, side) => vid + '_' + side;
  const cardOf = (vid, side) => { const c = DB.get('cards', cardId(vid, side)); return c ? c.data : null; };
  function saveCard(vid, side, data) {
    if (data) DB.put('cards', { id: cardId(vid, side), vendorId: vid, side, data });
    else if (DB.get('cards', cardId(vid, side))) DB.remove('cards', cardId(vid, side));
  }
  function cardStrip(v) {
    const imgs = SIDES.filter(([s]) => cardOf(v.id, s));
    if (!imgs.length) return canEdit() ? `<button class="card-add" data-cardadd="${v.id}">📇 加入名片</button>` : '';
    return `<div class="card-strip">${imgs.map(([s, l]) => `<button class="card-thumb" data-card="${v.id}" data-side="${s}" title="名片${l}">
      <img src="${cardOf(v.id, s)}" alt="名片${l}" loading="lazy"><span>${l}</span></button>`).join('')}</div>`;
  }
  function viewCards(v, side) {
    const imgs = SIDES.filter(([s]) => cardOf(v.id, s));
    let cur = imgs.findIndex(([s]) => s === side);
    if (cur < 0) cur = 0;
    const m = UI.modal({
      title: v.name + ' 的名片', wide: true,
      body: `<div class="card-view"><img id="cv-img" alt=""></div>
        ${imgs.length > 1 ? `<div class="chips center-chips">${imgs.map(([s, l], i) => `<button class="chip" data-i="${i}">${l}</button>`).join('')}</div>` : ''}`,
      actions: [{ label: '下載圖片', onClick: () => { const [s, l] = imgs[cur]; downloadImage(cardOf(v.id, s), `${v.name}_名片${l}.jpg`); return false; } }, { label: '關閉', kind: 'primary' }]
    });
    const show = () => {
      UI.$('#cv-img', m.body).src = cardOf(v.id, imgs[cur][0]);
      UI.$$('[data-i]', m.body).forEach((c) => c.classList.toggle('on', +c.dataset.i === cur));
    };
    UI.$$('[data-i]', m.body).forEach((c) => (c.onclick = () => { cur = +c.dataset.i; show(); }));
    show();
  }
  function downloadImage(dataUrl, name) {
    if (SG.desktop) return SG.desktop.saveFile(name, dataUrl);
    const a = document.createElement('a');
    a.href = dataUrl; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function pickImage() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => resolve(inp.files[0] || null);
      inp.click();
    });
  }
  async function quickAddCard(v) {
    const file = await pickImage();
    if (!file) return;
    try {
      const data = await U.compressImage(file);
      const side = cardOf(v.id, 'front') ? 'back' : 'front';
      saveCard(v.id, side, data);
      SG.log('加入名片', v.name);
      UI.toast('名片已加入');
      UI.render();
    } catch (e) { UI.toast(e.message, 'error'); }
  }
  function vendorForm(existing) {
    const fields = [
      { name: 'name', label: '廠商名稱', required: true },
      { name: 'category', label: '類別', placeholder: '例如：冷凍空調、水電', list: [...new Set(DB.all('vendors').map((v) => v.category).filter(Boolean))] },
      { name: 'contact', label: '聯絡人' },
      { name: 'phone', label: '電話', type: 'tel' },
      { name: 'mobile', label: '手機', type: 'tel' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'taxId', label: '統一編號' },
      { name: 'address', label: '地址' },
      { name: 'note', label: '備註', type: 'textarea', span: 2 },
      { type: 'section', label: '名片（可拍照或選擇圖片）' },
      { type: 'html', html: `<div class="card-slots">${SIDES.map(([s, l]) => `<div class="card-slot" data-slot="${s}"><div class="slot-img"></div>
        <div class="slot-btns"><button type="button" class="btn sm" data-pick="${s}">📷 ${l}</button><button type="button" class="btn sm danger-ghost" data-clear="${s}">移除</button></div></div>`).join('')}</div>` }
    ];
    // undefined = unchanged, null = remove, string = new photo
    const pending = {};
    const vid = existing && existing.id;
    UI.formModal({
      title: existing && existing.id ? '編輯廠商' : '新增廠商', fields, values: existing || {},
      afterRender(body) {
        const paint = () => SIDES.forEach(([s, l]) => {
          const data = pending[s] !== undefined ? pending[s] : (vid ? cardOf(vid, s) : null);
          const slot = UI.$(`[data-slot=${s}]`, body);
          UI.$('.slot-img', slot).innerHTML = data ? `<img src="${data}" alt="名片${l}">` : `<span>尚未加入${l}</span>`;
          UI.$('[data-clear]', slot).hidden = !data;
          UI.$('[data-pick]', slot).textContent = (data ? '🔄 更換' : '📷 加入') + l;
        });
        UI.$$('[data-pick]', body).forEach((b) => (b.onclick = async () => {
          const file = await pickImage();
          if (!file) return;
          b.disabled = true;
          try { pending[b.dataset.pick] = await U.compressImage(file); paint(); }
          catch (e) { UI.toast(e.message, 'error'); }
          b.disabled = false;
        }));
        UI.$$('[data-clear]', body).forEach((b) => (b.onclick = () => { pending[b.dataset.clear] = null; paint(); }));
        paint();
      },
      onSave(v) {
        if (DB.all('vendors').some((x) => x.name === v.name && (!existing || x.id !== existing.id))) throw new Error('已經有同名的廠商');
        const rec = DB.put('vendors', Object.assign({}, existing || {}, v));
        SIDES.forEach(([s]) => { if (pending[s] !== undefined) saveCard(rec.id, s, pending[s]); });
        SG.log(vid ? '修改廠商' : '新增廠商', v.name);
        UI.toast('已儲存');
        UI.render();
      }
    });
  }
  let vendorSearch = '';
  UI.route('/vendors', function (main) {
    const exp = Q.expenses();
    const known = DB.all('vendors');
    const knownNames = new Set(known.map((v) => v.name));
    const unknown = Q.vendorNames().filter((n) => !knownNames.has(n));
    main.innerHTML = `${UI.pageHead('廠商通訊錄', canEdit() ? `<button class="btn primary" id="v-add">＋ 新增廠商</button>` : '')}
      <div class="toolbar card"><input type="search" id="v-q" placeholder="🔍 搜尋廠商、類別、電話…" value="${esc(vendorSearch)}"></div>
      <div id="v-list" class="vendor-grid"></div>
      ${unknown.length && canEdit() ? `<section class="card"><div class="card-head"><h2>紀錄中出現、但還沒建檔的廠商</h2></div>
        <div class="chips">${unknown.map((n) => `<button class="chip" data-new="${esc(n)}">＋ ${esc(n)}</button>`).join('')}</div></section>` : ''}`;
    const draw = () => {
      const s = vendorSearch.toLowerCase();
      const rows = known.filter((v) => !s || [v.name, v.category, v.contact, v.phone, v.mobile, v.note].some((x) => String(x || '').toLowerCase().includes(s)))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
      UI.$('#v-list', main).innerHTML = rows.length ? rows.map((v) => {
        const spend = exp.filter((x) => x.vendor === v.name).reduce((t, x) => t + x.amount, 0);
        const nq = DB.all('quotes').filter((q) => q.vendor === v.name).length;
        return `<div class="card vendor">
          <div class="card-head"><h2>${esc(v.name)}</h2>${v.category ? UI.badge(v.category, 'b-gray') : ''}</div>
          ${v.contact ? `<div>👤 ${esc(v.contact)}</div>` : ''}
          ${v.phone ? `<div>☎️ <a href="tel:${esc(v.phone)}">${esc(v.phone)}</a></div>` : ''}
          ${v.mobile ? `<div>📱 <a href="tel:${esc(v.mobile)}">${esc(v.mobile)}</a></div>` : ''}
          ${v.email ? `<div>✉️ <a href="mailto:${esc(v.email)}">${esc(v.email)}</a></div>` : ''}
          ${v.address ? `<div>📍 ${esc(v.address)}</div>` : ''}
          ${v.taxId ? `<div class="muted small">統編 ${esc(v.taxId)}</div>` : ''}
          ${v.note ? `<div class="muted small">${esc(v.note)}</div>` : ''}
          ${cardStrip(v)}
          <div class="vendor-foot"><span class="small muted">累計支出 ${U.money(spend)}・報價 ${nq} 筆</span>
          ${canEdit() ? `<span><button class="icon-btn" data-ve="${v.id}" title="編輯">✏️</button><button class="icon-btn" data-vd="${v.id}" title="刪除">🗑️</button></span>` : ''}</div></div>`;
      }).join('') : UI.empty(known.length ? '找不到符合的廠商' : '還沒有廠商資料', '📇');
      UI.$$('[data-ve]', main).forEach((b) => (b.onclick = () => vendorForm(DB.get('vendors', b.dataset.ve))));
      UI.$$('[data-vd]', main).forEach((b) => (b.onclick = async () => {
        const v = DB.get('vendors', b.dataset.vd);
        if (!(await F.remove('vendors', v, v.name))) return;
        SIDES.forEach(([s]) => { if (DB.get('cards', cardId(v.id, s))) DB.remove('cards', cardId(v.id, s)); });
        UI.render();
      }));
      UI.$$('[data-card]', main).forEach((b) => (b.onclick = () => viewCards(DB.get('vendors', b.dataset.card), b.dataset.side)));
      UI.$$('[data-cardadd]', main).forEach((b) => (b.onclick = () => quickAddCard(DB.get('vendors', b.dataset.cardadd))));
    };
    UI.$('#v-q', main).addEventListener('input', U.debounce((e) => { vendorSearch = e.target.value.trim(); draw(); }, 150));
    const add = UI.$('#v-add', main); if (add) add.onclick = () => vendorForm(null);
    UI.$$('[data-new]', main).forEach((b) => (b.onclick = () => vendorForm({ name: b.dataset.new })));
    draw();
  });

  // ====================================================== reports
  let rPeriod = 'year';
  UI.route('/reports', function (main) {
    const all = Q.expenses();
    const now = new Date();
    const years = [...new Set(all.map((x) => (x.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const y = String(now.getFullYear());
    let from = '', to = '9999', label = '';
    if (rPeriod === 'year') { from = y + '-01-01'; to = y + '-12-31'; label = y + ' 年'; }
    else if (rPeriod === '12m') { from = U.ymd(new Date(now.getFullYear(), now.getMonth() - 11, 1)); to = U.today(); label = '近 12 個月'; }
    else if (rPeriod === 'all') { label = '全部期間'; }
    else { from = rPeriod + '-01-01'; to = rPeriod + '-12-31'; label = rPeriod + ' 年'; }
    const rows = all.filter((x) => x.date && x.date >= from && x.date <= to);
    const sum = (arr) => arr.reduce((t, x) => t + x.amount, 0);
    const by = (keyFn) => { const m = {}; rows.forEach((x) => { const k = keyFn(x) || '（未填）'; m[k] = (m[k] || 0) + x.amount; }); return Object.entries(m).map(([label, value]) => ({ label, value })); };
    let months = [];
    if (rPeriod === 'all') {
      const ys = [...new Set(rows.map((x) => x.date.slice(0, 4)))].sort();
      months = ys.map((yy) => ({ label: yy, value: sum(rows.filter((x) => x.date.startsWith(yy))) }));
    } else {
      const start = U.parseDate(from);
      for (let i = 0; i < 12; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const k = `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}`;
        months.push({ label: (d.getMonth() + 1) + '月', value: sum(rows.filter((x) => x.date.startsWith(k))) });
      }
    }
    const eqs = Q.eqs();
    const kinds = ['採購', '更換', '保養', '維修', '檢查', '耗材'];
    const KIND_ICON = { 採購: '🛒', 更換: '🔁', 保養: '🧽', 維修: '🛠️', 檢查: '🔎', 耗材: '📦' };
    const shownKinds = kinds.filter((k) => (k !== '檢查' && k !== '耗材') || rows.some((x) => x.kind === k));
    const eqLabel = (x) => (x.eq ? `${x.eq.code || ''} ${x.eq.name}` : x.kind === '耗材' ? '（耗材進貨）' : '（已刪除的設備）');
    main.innerHTML = `${UI.pageHead('統計報表', `<select id="r-period">
        <option value="year" ${rPeriod === 'year' ? 'selected' : ''}>今年</option>
        <option value="12m" ${rPeriod === '12m' ? 'selected' : ''}>近 12 個月</option>
        ${years.filter((x) => x !== y).map((x) => `<option value="${x}" ${rPeriod === x ? 'selected' : ''}>${x} 年</option>`).join('')}
        <option value="all" ${rPeriod === 'all' ? 'selected' : ''}>全部期間</option></select>
        <button class="btn" id="r-print">🖨️ 列印報表</button><button class="btn" id="r-exp">匯出 Excel</button>`, `${label}・含稅金額${Q.curStore() ? '・分店：' + esc(Q.curStore()) : ''}`)}
      <div class="kpis">
        <div class="kpi"><span class="kpi-icon">💰</span><span class="kpi-val">${U.money(sum(rows))}</span><span class="kpi-lab">總支出</span></div>
        ${shownKinds.map((k) => `<div class="kpi"><span class="kpi-icon">${KIND_ICON[k]}</span><span class="kpi-val">${U.money(sum(rows.filter((x) => x.kind === k)))}</span><span class="kpi-lab">${k}・${rows.filter((x) => x.kind === k).length} 筆</span></div>`).join('')}
      </div>
      <section class="card"><div class="card-head"><h2>${rPeriod === 'all' ? '每年支出' : '每月支出'}</h2></div>${UI.barChart(months)}</section>
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>依設備分類</h2></div>${UI.rankBars(by((x) => x.eq && x.eq.category))}</section>
        <section class="card"><div class="card-head"><h2>依廠商</h2></div>${UI.rankBars(by((x) => x.vendor))}</section>
        <section class="card"><div class="card-head"><h2>花費最多的設備</h2></div>${UI.rankBars(by(eqLabel))}</section>
        <section class="card"><div class="card-head"><h2>依放置位置</h2></div>${UI.rankBars(by((x) => x.eq && x.eq.location))}</section>
        <section class="card"><div class="card-head"><h2>設備狀態</h2></div>${UI.rankBars(SG.STATUSES.map((s) => ({ label: s, value: eqs.filter((e) => (e.status || '使用中') === s).length })), { money: false })}</section>
        <section class="card"><div class="card-head"><h2>各分類設備數</h2></div>${UI.rankBars((() => { const m = {}; eqs.filter((e) => e.status !== '已汰換').forEach((e) => { const k = e.category || '（未分類）'; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).map(([label, value]) => ({ label, value })); })(), { money: false })}</section>
      </div>`;
    UI.$('#r-period', main).onchange = (e) => { rPeriod = e.target.value; UI.render(); };
    const detail = () => rows.slice().sort((a, b) => a.date.localeCompare(b.date)).map((x) => [x.date, x.kind, x.eq ? x.eq.code || '' : '', x.eq ? x.eq.name : eqLabel(x), x.eq ? x.eq.store || '' : '', x.eq ? x.eq.category || '' : '', x.eq ? x.eq.location || '' : '', x.title || '', x.vendor, x.amount]);
    const ranked = (fn) => by(fn).sort((a, b) => b.value - a.value).map((d) => [d.label, d.value]);
    UI.$('#r-exp', main).onclick = () => SG.excel.save(`支出報表_${label}_${U.today()}.xlsx`, [
      { name: '支出明細', rows: [['日期', '類別', '設備編號', '設備', '分店', '分類', '位置', '項目', '廠商', '金額（含稅）']].concat(detail()) },
      { name: rPeriod === 'all' ? '每年' : '每月', rows: [['期間', '金額']].concat(months.map((m) => [m.label, m.value])) },
      { name: '依類別', rows: [['類別', '金額', '筆數']].concat(shownKinds.map((k) => [k, sum(rows.filter((x) => x.kind === k)), rows.filter((x) => x.kind === k).length])) },
      { name: '依分類', rows: [['設備分類', '金額']].concat(ranked((x) => x.eq && x.eq.category)) },
      { name: '依廠商', rows: [['廠商', '金額']].concat(ranked((x) => x.vendor)) },
      { name: '依設備', rows: [['設備', '金額']].concat(ranked(eqLabel)) }
    ]).catch((e) => UI.toast(e.message, 'error'));
    UI.$('#r-print', main).onclick = () => {
      const t = (title, data) => `<h2>${title}</h2>` + SG.printTable(['項目', '金額', '占比'], data.map(([l, v]) => [l, U.money(v), sum(rows) ? (v / sum(rows) * 100).toFixed(1) + '%' : '']), { numCols: [1, 2] });
      SG.print(`支出報表（${label}）`, `
        ${SG.printTable(['總支出', ...shownKinds], [[U.money(sum(rows)), ...shownKinds.map((k) => U.money(sum(rows.filter((x) => x.kind === k))))]], { numCols: shownKinds.map((_, i) => i + 1).concat(0) })}
        <h2>${rPeriod === 'all' ? '每年支出' : '每月支出'}</h2><div class="pd-chart">${UI.barChart(months)}</div>
        ${SG.printTable(months.map((m) => m.label), [months.map((m) => m.value ? Math.round(m.value).toLocaleString() : '—')], { numCols: months.map((_, i) => i) })}
        <div class="pd-cols">${t('依設備分類', ranked((x) => x.eq && x.eq.category).slice(0, 15))}${t('依廠商', ranked((x) => x.vendor).slice(0, 15))}</div>
        ${t('花費最多的設備（前 20）', ranked(eqLabel).slice(0, 20))}`);
    };
  });

  // ====================================================== QR labels
  const labelSel = new Set();
  let labelSize = 'm', labelFilter = '';
  SG.labels = {
    svg(e) {
      const url = DB.settings().qrBaseUrl.replace(/#.*$/, '') + '#/qr/' + e.id; // opens the quick-action page (報修／保養／履歷)
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    },
    html(list, size) {
      const org = DB.settings().orgName;
      return `<div class="labels size-${size}">${list.map((e) => `<div class="label">
        <div class="label-qr">${this.svg(e)}</div>
        <div class="label-text"><div class="label-org">${esc(org)}${e.store ? '・' + esc(e.store) : ''}</div><div class="label-name">${esc(e.name)}</div>
        <div class="label-code">${esc(e.code || '')}</div>${e.location ? `<div class="label-loc">${esc(e.location)}</div>` : ''}</div></div>`).join('')}</div>`;
    },
    print(list, size) {
      let area = UI.$('#print-area');
      if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
      area.innerHTML = this.html(list, size);
      document.body.classList.add('printing');
      const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
    },
    preview(list) {
      const m = UI.modal({
        title: 'QR Code 標籤', wide: true,
        body: `<p class="small muted">手機掃描標籤上的 QR Code，登入後就會直接打開這台設備的資料。</p>
          <div class="label-preview">${this.html(list, labelSize)}</div>`,
        actions: [{ label: '關閉' }, { label: '🖨️ 列印', kind: 'primary', onClick: () => { this.print(list, labelSize); } }]
      });
      return m;
    }
  };
  UI.route('/labels', function (main) {
    const eqs = Q.eqs().filter((e) => e.status !== '已汰換').sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
    main.innerHTML = `${UI.pageHead('QR 標籤列印', `<select id="l-size"><option value="s" ${labelSize === 's' ? 'selected' : ''}>小（4×2.5 公分）</option><option value="m" ${labelSize === 'm' ? 'selected' : ''}>中（6×3.5 公分）</option><option value="l" ${labelSize === 'l' ? 'selected' : ''}>大（8×5 公分）</option></select>
      <button class="btn primary" id="l-print">🖨️ 列印已選（<span id="l-n">0</span>）</button>`, '勾選要列印的設備，貼在設備上，手機掃描即可查看保養與更換紀錄')}
      <div class="toolbar card"><input type="search" id="l-q" placeholder="🔍 篩選名稱、編號、位置…" value="${esc(labelFilter)}">
        <button class="btn" id="l-all">全選目前列表</button><button class="btn" id="l-none">全部取消</button></div>
      <div id="l-list" class="label-pick"></div>`;
    const visible = () => { const s = labelFilter.toLowerCase(); return eqs.filter((e) => !s || [e.name, e.code, e.location, e.category].some((x) => String(x || '').toLowerCase().includes(s))); };
    const count = () => (UI.$('#l-n', main).textContent = [...labelSel].filter((id) => DB.get('equipment', id)).length);
    const draw = () => {
      const list = visible();
      UI.$('#l-list', main).innerHTML = list.length ? list.map((e) => `<label class="pick ${labelSel.has(e.id) ? 'on' : ''}"><input type="checkbox" data-id="${e.id}" ${labelSel.has(e.id) ? 'checked' : ''}>
        <span><b>${esc(e.name)}</b><small>${esc(e.code || '')}${e.location ? '・' + esc(e.location) : ''}</small></span></label>`).join('') : UI.empty('沒有設備');
      UI.$$('#l-list input', main).forEach((c) => (c.onchange = () => { c.checked ? labelSel.add(c.dataset.id) : labelSel.delete(c.dataset.id); c.parentElement.classList.toggle('on', c.checked); count(); }));
      count();
    };
    UI.$('#l-q', main).addEventListener('input', U.debounce((e) => { labelFilter = e.target.value.trim(); draw(); }, 150));
    UI.$('#l-size', main).onchange = (e) => (labelSize = e.target.value);
    UI.$('#l-all', main).onclick = () => { visible().forEach((e) => labelSel.add(e.id)); draw(); };
    UI.$('#l-none', main).onclick = () => { labelSel.clear(); draw(); };
    UI.$('#l-print', main).onclick = () => {
      const list = eqs.filter((e) => labelSel.has(e.id));
      if (!list.length) return UI.toast('請先勾選設備', 'error');
      SG.labels.print(list, labelSize);
    };
    draw();
  });

  // ====================================================== users (admin)
  function userForm(existing) {
    const isNew = !existing;
    const fields = [
      { name: 'username', label: '登入帳號', required: true, hint: '英文或數字' },
      { name: 'name', label: '顯示名稱', required: true },
      { name: 'role', label: '權限', type: 'select', options: Object.entries(Auth.ROLES).map(([value, label]) => ({ value, label: label + { admin: '（全部功能＋帳號管理）', editor: '（新增、修改、刪除資料）', viewer: '（只能查看）' }[value] })) },
      ...(isNew ? [{ name: 'password', label: '密碼', type: 'password', required: true, hint: '至少 4 個字' }] : [{ name: 'disabled', label: '停用', type: 'checkbox', text: '停用這個帳號（無法登入）' }])
    ];
    UI.formModal({
      title: isNew ? '新增帳號' : '編輯帳號', fields, values: existing || { role: 'editor' }, wide: false,
      afterRender(body) { if (!isNew) UI.$('[name=username]', body).readOnly = true; },
      onSave(v) {
        if (isNew) {
          const u = Auth.createUser(v);
          SG.log('新增帳號', u.name);
        } else {
          const admins = Auth.users().filter((u) => u.role === 'admin' && !u.disabled);
          if (existing.role === 'admin' && (v.role !== 'admin' || v.disabled) && admins.length <= 1) throw new Error('至少要保留一個可用的管理員');
          if (existing.id === Auth.current.id && v.disabled) throw new Error('不能停用自己的帳號');
          DB.put('users', Object.assign({}, existing, { name: v.name, role: v.role, disabled: !!v.disabled }));
          SG.log('修改帳號', v.name);
          Auth.refresh();
        }
        UI.toast('已儲存');
        UI.render();
      }
    });
  }
  function passwordForm(user, self) {
    const fields = [
      ...(self ? [{ name: 'old', label: '目前密碼', type: 'password', required: true }] : []),
      { name: 'pw', label: '新密碼', type: 'password', required: true, hint: '至少 4 個字' },
      { name: 'pw2', label: '再輸入一次', type: 'password', required: true }
    ];
    UI.formModal({
      title: self ? '修改我的密碼' : '重設密碼：' + user.name, fields, wide: false,
      onSave(v) {
        if (self && Auth.hash(v.old, user.salt) !== user.hash) throw new Error('目前密碼不正確');
        if (v.pw !== v.pw2) throw new Error('兩次輸入的新密碼不一樣');
        Auth.setPassword(DB.get('users', user.id), v.pw);
        SG.log(self ? '修改自己的密碼' : '重設密碼', user.name);
        if (self) {
          // Keep this device signed in with the new hash.
          const u = DB.get('users', user.id);
          Auth.saveSession(u, Auth.remembered());
          Auth.current = u;
        }
        UI.toast('密碼已更新');
      }
    });
  }
  UI.route('/users', function (main) {
    const users = Auth.users().sort((a, b) => a.username.localeCompare(b.username));
    main.innerHTML = `${UI.pageHead('帳號管理', `<button class="btn primary" id="u-add">＋ 新增帳號</button>`, '每位同事各自一個帳號，紀錄會標示是誰操作的')}
      <section class="card">${UI.table(users, [
        { label: '帳號', render: (u) => `<span class="mono">${esc(u.username)}</span>` },
        { label: '名稱', render: (u) => `<b>${esc(u.name)}</b>${u.id === Auth.current.id ? ' ' + UI.badge('我', 'b-blue') : ''}`, cls: 'primary-col' },
        { label: '權限', render: (u) => UI.badge(Auth.ROLES[u.role] || u.role, u.role === 'admin' ? 'b-red' : u.role === 'editor' ? 'b-blue' : 'b-gray') },
        { label: '狀態', render: (u) => (u.disabled ? UI.badge('已停用', 'b-gray') : UI.badge('啟用', 'b-green')) },
        { label: '', render: (u) => `<button class="btn sm" data-ue="${u.id}">編輯</button><button class="btn sm" data-up="${u.id}">重設密碼</button>${u.id !== Auth.current.id ? `<button class="icon-btn" data-ud="${u.id}" title="刪除">🗑️</button>` : ''}`, cls: 'actions' }
      ])}</section>`;
    UI.$('#u-add', main).onclick = () => userForm(null);
    UI.$$('[data-ue]', main).forEach((b) => (b.onclick = () => userForm(DB.get('users', b.dataset.ue))));
    UI.$$('[data-up]', main).forEach((b) => (b.onclick = () => passwordForm(DB.get('users', b.dataset.up), b.dataset.up === Auth.current.id)));
    UI.$$('[data-ud]', main).forEach((b) => (b.onclick = async () => {
      const u = DB.get('users', b.dataset.ud);
      if (u.role === 'admin' && Auth.users().filter((x) => x.role === 'admin' && !x.disabled).length <= 1) return UI.toast('至少要保留一個管理員', 'error');
      if (await F.remove('users', u, u.name)) UI.render();
    }));
  }, { admin: true });

  // ====================================================== activity
  let actFilter = '';
  UI.route('/activity', function (main) {
    const acts = DB.all('activity').sort((a, b) => b.at - a.at);
    const users = [...new Set(acts.map((a) => a.userName))];
    main.innerHTML = `${UI.pageHead('操作紀錄', `<select id="a-user"><option value="">全部人員</option>${users.map((u) => `<option ${actFilter === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>`, '最近 2000 筆')}
      <section class="card">${(() => {
        const rows = acts.filter((a) => !actFilter || a.userName === actFilter).slice(0, 500);
        return rows.length ? `<ul class="list act">${rows.map((a) => `<li class="list-row"><div class="grow"><b>${esc(a.action)}</b> ${esc(a.target)}<small>${esc(a.userName)}・${U.fmtTime(a.at)}</small></div></li>`).join('')}</ul>` : UI.empty('沒有紀錄');
      })()}</section>`;
    UI.$('#a-user', main).onchange = (e) => { actFilter = e.target.value; UI.render(); };
  });

  // ====================================================== settings
  UI.route('/settings', function (main) {
    const s = DB.settings();
    const admin = Auth.can('admin');
    const sc = SG.sync.cfg();
    const me = Auth.current;
    main.innerHTML = `${UI.pageHead('設定')}
      <section class="card">
        <div class="card-head"><h2>我的帳號</h2></div>
        <p><b>${esc(me.name)}</b>（${esc(me.username)}）・${esc(Auth.ROLES[me.role])}</p>
        <div class="btn-row"><button class="btn" id="s-pw">修改密碼</button><button class="btn" id="s-logout">登出</button></div>
      </section>
      <section class="card" id="sync-card">
        <div class="card-head"><h2>☁️ 雲端同步</h2><span id="s-sync-state"></span></div>
        <p class="small muted">連上同一個雲端的電腦、手機會自動同步所有資料（每分鐘一次，修改後幾秒內也會同步）。</p>
        ${SG.sync.enabled() ? `
          <p class="small">雲端網址：<span class="mono break">${esc(sc.url)}</span></p>
          <div class="btn-row"><button class="btn primary" id="s-sync-now">立即同步</button>${admin ? `<button class="btn" id="s-sync-off">停止這台裝置的同步</button>` : ''}</div>` : `
          ${admin ? `<div class="form-grid">
            <div class="field span-2"><label>雲端網址（Apps Script 網頁應用程式）</label><input id="s-url" value="${esc(sc.url || '')}" placeholder="https://script.google.com/macros/s/…/exec"></div>
            <div class="field span-2"><label>同步密碼</label><input id="s-key" type="password" placeholder="至少 6 個字" autocomplete="new-password"><small class="hint">雲端第一次連線時，輸入的密碼就會成為同步密碼；其他裝置要輸入同一組密碼。請自行保管。</small></div>
          </div><div class="btn-row"><button class="btn primary" id="s-connect">連線並同步</button></div>` : '<p class="small">尚未連線雲端，請管理員設定。</p>'}`}
      </section>
      ${admin ? `<section class="card">
        <div class="card-head"><h2>基本設定</h2></div>
        <div class="form-grid">
          <div class="field"><label>單位／店名</label><input id="s-org" value="${esc(s.orgName)}"></div>
          <div class="field"><label>QR 標籤連結網址</label><input id="s-qr" value="${esc(s.qrBaseUrl)}"><small class="hint">手機掃描標籤時打開的網頁版位址</small></div>
          <div class="field"><label>常用分類（用逗號分隔）</label><input id="s-cats" value="${esc(s.categories.join('，'))}" placeholder="廚房設備，空調，資訊設備"></div>
          <div class="field"><label>常用位置（用逗號分隔）</label><input id="s-locs" value="${esc(s.locations.join('，'))}" placeholder="一樓廚房，二樓辦公室"></div>
          <div class="field span-2"><label>分店（用逗號分隔，只有一家店可留空）</label><input id="s-stores" value="${esc(s.stores.join('，'))}" placeholder="碧潭店，新店店"><small class="hint">設定後，設備可以指定分店，左上角可切換只看某一家分店</small></div>
        </div>
        <div class="btn-row"><button class="btn primary" id="s-save">儲存設定</button></div>
      </section>` : ''}
      <section class="card">
        <div class="card-head"><h2>備份與還原</h2></div>
        <p class="small muted">建議定期匯出備份檔（.json），換電腦或資料出問題時可以還原。</p>
        <div class="btn-row"><button class="btn" id="s-backup">匯出完整備份</button><button class="btn" id="s-xlsx">匯出全部資料（Excel）</button>${admin ? `<button class="btn" id="s-restore">從備份還原</button>` : ''}</div>
        <input type="file" id="s-file" accept=".json,application/json" hidden>
      </section>
      <section class="card">
        <div class="card-head"><h2>這台裝置</h2></div>
        <p class="small muted">${SG.desktop ? '電腦版，資料存在 ' + esc(SG.desktop.dataPath || '本機') : '網頁版，資料存在這個瀏覽器'}・版本 ${SG.config.version}</p>
        <div class="field" style="max-width:320px"><label>外觀</label><select id="s-theme">
          ${[['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']].map(([v, l]) => `<option value="${v}" ${SG.theme.get() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="btn-row"><button class="btn danger-ghost" id="s-wipe">清除這台裝置的資料</button></div>
      </section>`;
    UI.$('#s-theme', main).onchange = (ev) => SG.theme.set(ev.target.value);
    const on = (sel, fn) => { const el = UI.$(sel, main); if (el) el.onclick = fn; };
    on('#s-pw', () => passwordForm(me, true));
    on('#s-logout', () => { SG.log('登出', me.name); DB.saveNow(); Auth.logout(); location.hash = ''; location.reload(); });
    const st = UI.$('#s-sync-state', main);
    const showState = () => { if (st) st.innerHTML = SG.syncBadge(); };
    showState();
    on('#s-sync-now', async () => { try { const r = await SG.sync.syncNow(); UI.toast(r && r.pulled ? `同步完成，收到 ${r.pulled} 筆更新` : '同步完成'); } catch (e) { UI.toast(e.message, 'error'); } UI.render(); });
    on('#s-sync-off', async () => { if (await UI.confirm('停止後，這台裝置的修改不會再上傳到雲端（雲端資料不會被刪除）。', { ok: '停止同步' })) { SG.sync.disconnect(); UI.render(); } });
    on('#s-connect', async () => {
      const url = UI.$('#s-url', main).value.trim(), key = UI.$('#s-key', main).value;
      if (!/^(https:\/\/script\.google(usercontent)?\.com\/|http:\/\/127\.0\.0\.1:)/.test(url)) return UI.toast('請輸入正確的 Apps Script 網址', 'error');
      const btn = UI.$('#s-connect', main); btn.disabled = true; btn.textContent = '連線中…';
      try { await SG.sync.connect(url, key); SG.sync.start(); SG.log('連線雲端同步', ''); UI.toast('已連線，資料同步完成'); }
      catch (e) { UI.toast(e.code === 'BADKEY' ? '同步密碼錯誤' : e.message, 'error'); }
      UI.render();
    });
    on('#s-save', () => {
      const split = (v) => v.split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean);
      DB.saveSettings({ orgName: UI.$('#s-org', main).value.trim() || '設備管家', qrBaseUrl: UI.$('#s-qr', main).value.trim() || SG.config.publicUrl, categories: split(UI.$('#s-cats', main).value), locations: split(UI.$('#s-locs', main).value), stores: [...new Set(split(UI.$('#s-stores', main).value))] });
      SG.log('修改系統設定', '');
      UI.toast('設定已儲存');
      SG.shell.render();
      UI.render();
    });
    on('#s-xlsx', () => {
      const eqName = (id) => { const e = DB.get('equipment', id); return e ? `${e.code || ''} ${e.name}` : ''; };
      const n = (v) => (v === '' || v == null ? '' : U.num(v));
      SG.excel.save(`設備管家全部資料_${U.today()}.xlsx`, [
        { name: '設備', rows: [SG.EQ_COLS.map((c) => c[1])].concat(DB.all('equipment').sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true })).map((e) => SG.EQ_COLS.map((c) => e[c[0]] == null ? '' : e[c[0]]))) },
        { name: '更換紀錄', rows: [['日期', '設備', '更換項目', '原因', '舊品', '新品', '廠商', '費用', '新品保固到期', '備註']].concat(DB.all('replacements').sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((r) => [r.date, eqName(r.equipmentId), r.item, r.reason, r.oldInfo, r.newInfo, r.vendor, n(r.cost), r.warrantyUntil, r.note])) },
        { name: '保養維修紀錄', rows: [['日期', '類型', '設備', '項目', '處理內容', '廠商', '經手人', '費用']].concat(DB.all('logs').sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((l) => [l.date, l.type, eqName(l.equipmentId), l.title, l.content, l.vendor, l.by, n(l.cost)])) },
        { name: '保養排程', rows: [['設備', '保養項目', '每隔', '單位', '上次', '下次', '廠商', '啟用']].concat(DB.all('plans').map((p) => [eqName(p.equipmentId), p.title, p.intervalValue, UNIT[p.intervalUnit] || '', p.lastDone, p.nextDue, p.vendor, p.active ? '是' : '否'])) },
        { name: '報修', rows: [['報修時間', '設備', '問題', '描述', '緊急', '報修人', '狀態', '廠商', '完成日', '處理結果', '費用']].concat(DB.all('repairs').sort((a, b) => a.reportedAt - b.reportedAt).map((r) => [U.fmtTime(r.reportedAt), eqName(r.equipmentId), r.title, r.desc, r.urgency, r.reporter, r.status, r.vendor, r.doneDate, r.resolution, n(r.cost)])) },
        { name: '報價', rows: [['報價項目', '廠商', '報價日期', '未稅價', '稅額', '含稅價', '稅率(%)', '已採用', '相關設備', '備註']].concat(DB.all('quotes').map((q) => { const t = qParts(q); return [q.item, q.vendor, q.date, t.excl, t.tax, t.incl, t.rate, q.adopted ? '是' : '', eqName(q.equipmentId), q.note]; })) },
        { name: '廠商', rows: [['廠商', '類別', '聯絡人', '電話', '手機', 'Email', '統編', '地址', '備註']].concat(DB.all('vendors').map((v) => [v.name, v.category, v.contact, v.phone, v.mobile, v.email, v.taxId, v.address, v.note])) },
        { name: '耗材庫存', rows: [['耗材', '規格', '單位', '目前庫存', '安全量', '存放位置', '廠商', '參考單價']].concat(DB.all('parts').map((p) => [p.name, p.spec, p.unit, Q.stockOf(p.id), n(p.minQty), p.location, p.vendor, n(p.price)])) }
      ]).then(() => SG.log('匯出全部資料（Excel）', '')).catch((e) => UI.toast(e.message, 'error'));
    });
    on('#s-backup', () => {
      const data = {}; DB.COLLECTIONS.forEach((c) => (data[c] = DB.data[c]));
      U.download(`設備管家備份_${U.today()}.json`, JSON.stringify({ app: 'shebei-guanjia', version: 1, exportedAt: Date.now(), data }), 'application/json');
      SG.log('匯出備份', '');
    });
    on('#s-restore', () => UI.$('#s-file', main).click());
    const file = UI.$('#s-file', main);
    if (file) file.onchange = async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      let j;
      try { j = JSON.parse(await f.text()); } catch (e) { return UI.toast('檔案格式錯誤', 'error'); }
      if (!j || j.app !== 'shebei-guanjia' || !j.data) return UI.toast('這不是設備管家的備份檔', 'error');
      const n = Object.values(j.data.equipment || {}).filter((r) => !r.deleted).length;
      if (!(await UI.confirm(`備份檔包含 ${n} 台設備（${U.fmtTime(j.exportedAt)} 匯出）。\n還原會用備份內容取代這台裝置目前的資料${SG.sync.enabled() ? '，並同步到雲端' : ''}。確定還原？`, { ok: '還原', danger: true }))) return;
      // Fresh timestamps so the restored copy wins over older cloud copies.
      DB.COLLECTIONS.forEach((c) => Object.values(j.data[c] || {}).forEach((r) => { if (r && r.id) r.updatedAt = DB.stamp(); }));
      DB.replaceAll(j.data);
      if (!DB.get('users', Auth.current.id)) { Auth.logout(); location.reload(); return; }
      SG.log('從備份還原', `${n} 台設備`);
      UI.toast('還原完成');
      SG.sync.syncNow().catch(() => {});
      UI.render();
    };
    on('#s-wipe', async () => {
      const dirty = Object.keys(DB.data._dirty).length;
      const msg = SG.sync.enabled()
        ? (dirty ? `還有 ${dirty} 筆修改尚未上傳到雲端，清除後會遺失。\n` : '') + '清除後這台裝置會回到初始畫面，雲端資料不受影響，之後可重新連線取回。'
        : '這台裝置沒有連線雲端，清除後所有資料都會永久消失（建議先匯出備份）。';
      if (!(await UI.confirm(msg + '\n確定清除？', { ok: '清除', danger: true }))) return;
      Auth.logout();
      SG.sync.saveCfg({});
      DB.replaceAll({});
      DB.data._dirty = {};
      DB.saveNow();
      location.hash = '';
      location.reload();
    });
  });

  SG.syncBadge = function () {
    const s = SG.sync;
    if (!s.enabled()) return UI.badge('未連線', 'b-gray');
    if (s.state === 'syncing') return UI.badge('同步中…', 'b-blue');
    if (s.state === 'error') return UI.badge('同步失敗', 'b-red');
    return UI.badge(s.message || '已連線', 'b-green');
  };
})();
