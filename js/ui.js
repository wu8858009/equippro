/* 設備管家 — UI helpers: toast, modal, form builder, tables, charts, router, shell. */
(function () {
  'use strict';
  const SG = window.SG;
  const U = SG.util;
  const esc = U.esc;
  const UI = (SG.ui = {});

  UI.$ = (sel, root = document) => root.querySelector(sel);
  UI.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ------------------------------------------------------------- toast
  UI.toast = function (msg, kind = 'ok') {
    let box = UI.$('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast toast-' + kind;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), kind === 'error' ? 4200 : 2400);
    setTimeout(() => t.remove(), kind === 'error' ? 4700 : 2900);
  };

  // ------------------------------------------------------------- modal
  let modalStack = [];
  UI.modal = function ({ title, body, wide, actions = [], onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn modal-x" aria-label="關閉">✕</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div></div>`;
    const bodyEl = UI.$('.modal-body', wrap);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const foot = UI.$('.modal-foot', wrap);
    const api = {
      el: wrap, body: bodyEl,
      close() {
        wrap.classList.add('out');
        setTimeout(() => wrap.remove(), 160);
        modalStack = modalStack.filter((m) => m !== api);
        if (!modalStack.length) document.body.classList.remove('modal-open');
        if (onClose) onClose();
      }
    };
    if (!actions.length) foot.remove();
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.kind || '');
      b.textContent = a.label;
      b.type = 'button';
      b.onclick = async () => {
        if (!a.onClick) return api.close();
        b.disabled = true;
        try { const r = await a.onClick(api); if (r !== false) api.close(); }
        catch (e) { UI.toast(e.message || String(e), 'error'); }
        finally { b.disabled = false; }
      };
      foot.appendChild(b);
    });
    UI.$('.modal-x', wrap).onclick = () => api.close();
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap._downOutside = true; });
    wrap.addEventListener('click', (e) => { if (e.target === wrap && wrap._downOutside) api.close(); wrap._downOutside = false; });
    document.body.appendChild(wrap);
    modalStack.push(api);
    document.body.classList.add('modal-open'); // stop the page behind from scrolling
    const first = UI.$('input:not([type=hidden]):not([readonly]),select,textarea', bodyEl);
    if (first && window.matchMedia('(pointer:fine)').matches) setTimeout(() => first.focus(), 50);
    return api;
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
  });

  UI.confirm = (msg, { ok = '確定', danger = false, title = '請確認' } = {}) => new Promise((resolve) => {
    let done = false;
    UI.modal({
      title, body: `<p class="confirm-msg">${esc(msg).replace(/\n/g, '<br>')}</p>`,
      actions: [
        { label: '取消', onClick: () => { done = true; resolve(false); } },
        { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } }
      ],
      onClose: () => { if (!done) resolve(false); }
    });
  });

  // ------------------------------------------------------------- forms
  // fields: [{name,label,type,options,required,placeholder,list,span,hint,step,min,value}]
  UI.formHtml = function (fields, values = {}) {
    return `<div class="form-grid">${fields.map((f) => {
      if (f.type === 'section') return `<div class="form-section span-2">${esc(f.label)}</div>`;
      if (f.type === 'html') return `<div class="span-2">${f.html}</div>`;
      const v = values[f.name] != null ? values[f.name] : (f.value != null ? f.value : '');
      const id = 'f_' + f.name;
      const req = f.required ? ' required' : '';
      const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
      let input;
      if (f.type === 'select') {
        input = `<select id="${id}" name="${f.name}"${req}>${f.options.map((o) => {
          const ov = typeof o === 'object' ? o.value : o, ol = typeof o === 'object' ? o.label : o;
          return `<option value="${esc(ov)}"${String(ov) === String(v) ? ' selected' : ''}>${esc(ol)}</option>`;
        }).join('')}</select>`;
      } else if (f.type === 'textarea') {
        input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}"${ph}${req}>${esc(v)}</textarea>`;
      } else if (f.type === 'checkbox') {
        input = `<label class="check"><input type="checkbox" id="${id}" name="${f.name}"${v ? ' checked' : ''}> <span>${esc(f.text || '')}</span></label>`;
      } else {
        const t = f.type || 'text';
        const listAttr = f.list ? ` list="${id}_list"` : '';
        const extra = (f.step ? ` step="${f.step}"` : '') + (f.min != null ? ` min="${f.min}"` : '') + (t === 'number' ? ' inputmode="decimal"' : '');
        input = `<input id="${id}" name="${f.name}" type="${t}" value="${esc(v)}"${ph}${req}${listAttr}${extra} autocomplete="off">` +
          (f.list ? `<datalist id="${id}_list">${f.list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : '');
      }
      return `<div class="field ${f.span === 2 ? 'span-2' : ''}"><label for="${id}">${esc(f.label)}${f.required ? ' <b class="req">*</b>' : ''}</label>${input}${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ''}</div>`;
    }).join('')}</div>`;
  };
  UI.readForm = function (root, fields) {
    const out = {};
    fields.forEach((f) => {
      if (!f.name || f.type === 'section' || f.type === 'html') return;
      const el = root.querySelector(`[name="${f.name}"]`);
      if (!el) return;
      if (f.type === 'checkbox') out[f.name] = el.checked;
      else if (f.type === 'number') out[f.name] = el.value === '' ? '' : U.num(el.value);
      else out[f.name] = el.value.trim();
      if (f.required && (out[f.name] === '' || out[f.name] == null)) throw new Error(`請填寫「${f.label}」`);
    });
    return out;
  };
  // Opens a modal with a form. onSave(values) may throw to keep it open.
  UI.formModal = function ({ title, fields, values, onSave, saveLabel = '儲存', wide = true, afterRender, extraActions = [] }) {
    const m = UI.modal({
      title, wide,
      body: `<form class="sg-form" novalidate>${UI.formHtml(fields, values || {})}<button type="submit" hidden></button></form>`,
      actions: [...extraActions, { label: '取消' }, {
        label: saveLabel, kind: 'primary', onClick: async (api) => {
          const vals = UI.readForm(api.body, fields);
          await onSave(vals, api);
        }
      }]
    });
    const form = UI.$('form', m.body);
    form.addEventListener('submit', (e) => { e.preventDefault(); UI.$('.modal-foot .primary', m.el).click(); });
    if (afterRender) afterRender(m.body, m);
    return m;
  };

  // ------------------------------------------------------------- bits
  UI.badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
  UI.empty = (text, icon = '📭') => `<div class="empty"><div class="empty-icon">${icon}</div><p>${esc(text)}</p></div>`;
  UI.statusBadge = (s) => UI.badge(s || '使用中', { '使用中': 'b-green', '維修中': 'b-amber', '閒置': 'b-gray', '已汰換': 'b-red' }[s] || 'b-gray');

  // Simple sortable table that turns into cards on narrow screens.
  // cols: [{key,label,render(row),sort(row),cls}]
  UI.table = function (rows, cols, { onRow, empty = '沒有資料', id } = {}) {
    if (!rows.length) return UI.empty(empty);
    return `<div class="tbl-wrap"><table class="tbl" ${id ? `id="${id}"` : ''}><thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr ${onRow ? `data-row="${esc(onRow(r))}" class="clickable"` : ''}>${cols.map((c) => `<td class="${c.cls || ''}" data-label="${esc(c.label)}">${c.render ? c.render(r, i) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  };

  // Horizontal or vertical bar chart in SVG; data: [{label, value}]
  UI.barChart = function (data, { money = true, height = 220, color = 'var(--accent)' } = {}) {
    if (!data.length || !data.some((d) => d.value > 0)) return UI.empty('這段期間沒有資料', '📊');
    const max = Math.max(...data.map((d) => d.value)) || 1;
    const W = Math.max(data.length * 46, 320), H = height, pad = 26;
    const bw = (W - 10) / data.length;
    const fmt = (v) => money ? (v >= 10000 ? (v / 10000).toFixed(v >= 100000 ? 0 : 1) + '萬' : Math.round(v).toLocaleString()) : String(v);
    const bars = data.map((d, i) => {
      const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * (H - pad * 2));
      const x = 5 + i * bw + bw * 0.18, w = bw * 0.64, y = H - pad - h;
      return `<g><title>${esc(d.label)}：${money ? U.money(d.value) : d.value}</title>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${color}"/>
        ${d.value > 0 ? `<text x="${x + w / 2}" y="${y - 5}" class="ch-val">${fmt(d.value)}</text>` : ''}
        <text x="${x + w / 2}" y="${H - 8}" class="ch-lab">${esc(d.label)}</text></g>`;
    }).join('');
    return `<div class="chart-scroll"><svg class="chart" viewBox="0 0 ${W} ${H}" style="min-width:${data.length * 30}px" role="img">
      <line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" class="ch-axis"/>${bars}</svg></div>`;
  };
  // Ranked list with proportional bars (good on phones).
  UI.rankBars = function (data, { money = true, limit = 10 } = {}) {
    data = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    if (!data.length) return UI.empty('沒有資料', '📊');
    const shown = data.slice(0, limit);
    if (data.length > limit) shown.push({ label: `其他 ${data.length - limit} 項`, value: data.slice(limit).reduce((t, d) => t + d.value, 0) });
    const max = Math.max(...shown.map((d) => d.value));
    return `<div class="rank">${shown.map((d) => `<div class="rank-row"><div class="rank-lab" title="${esc(d.label)}">${esc(d.label)}</div>
      <div class="rank-bar"><i style="width:${Math.max(2, (d.value / max) * 100)}%"></i></div>
      <div class="rank-val">${money ? U.money(d.value) : d.value}</div></div>`).join('')}</div>`;
  };

  // ------------------------------------------------------------- router
  const routes = [];
  UI.route = (pattern, render, opts = {}) => routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), render, opts });
  UI.go = (hash) => { if (location.hash === hash) UI.render(); else location.hash = hash; };
  UI.currentPath = () => (location.hash.replace(/^#/, '') || '/dash');
  UI.render = function () {
    const path = UI.currentPath();
    const main = UI.$('#main');
    if (!main || !SG.auth.current) return;
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.opts.admin && !SG.auth.can('admin')) { main.innerHTML = UI.empty('只有管理員可以使用這個頁面', '🔒'); return; }
      UI.$$('.nav a[data-match]').forEach((a) => a.classList.toggle('active', new RegExp(a.dataset.match).test(path)));
      const scrollKey = path;
      const keepScroll = UI._lastPath === scrollKey;
      const y = window.scrollY;
      try { r.render(main, ...m.slice(1).map(decodeURIComponent)); }
      catch (e) { console.error(e); main.innerHTML = `<div class="card">頁面發生錯誤：${esc(e.message)}</div>`; }
      if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
      UI.$$('.chart-scroll', main).forEach((el) => (el.scrollLeft = el.scrollWidth)); // newest months in view
      UI._lastPath = scrollKey;
      const t = UI.$('h1', main);
      document.title = (t ? t.textContent.trim() + ' · ' : '') + SG.db.settings().orgName;
      return;
    }
    UI.go('#/dash');
  };
  window.addEventListener('hashchange', () => UI.render());

  UI.pageHead = (title, actionsHtml = '', sub = '') =>
    `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="page-actions">${actionsHtml}</div></div>`;
})();
