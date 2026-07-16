/* EPM.app — router, view rendering, event wiring */
(function () {
  const S = EPM.storage;
  const root = document.getElementById('app-root');

  /* ---------- helpers ---------- */
  function esc(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) { return 'NT$ ' + Number(n || 0).toLocaleString(); }
  function fmtDate(d) { return d ? d : '—'; }
  const STATUS_LABEL = EPM.reports.STATUS_LABEL;
  function statusBadge(status) {
    const cls = { active: 'badge-good', pending: 'badge-warn', retired: 'badge-muted', damaged: 'badge-crit' }[status] || 'badge-muted';
    return `<span class="badge ${cls}">${esc(STATUS_LABEL[status] || status)}</span>`;
  }
  function toast(msg, type) {
    const box = document.getElementById('toast-root');
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' toast-' + type : '');
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3200);
  }
  function confirmAction(msg) { return window.confirm(msg); }

  /* ---------- modal ---------- */
  const modalRoot = document.getElementById('modal-root');
  function openModal(html, opts) {
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal-card">${html}</div></div>`;
    modalRoot.classList.add('open');
    modalRoot.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
    modalRoot.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
    if (opts && opts.onMount) opts.onMount(modalRoot);
  }
  function closeModal() { modalRoot.classList.remove('open'); modalRoot.innerHTML = ''; }

  /* ---------- theme ---------- */
  function applyTheme() {
    const t = S.read(S.KEYS.theme, 'auto');
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  function cycleTheme() {
    const t = S.read(S.KEYS.theme, 'auto');
    const next = t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto';
    S.write(S.KEYS.theme, next);
    applyTheme();
    render();
  }
  function themeLabel() {
    const t = S.read(S.KEYS.theme, 'auto');
    return t === 'auto' ? '🌓 自動' : t === 'light' ? '☀️ 亮色' : '🌙 暗色';
  }

  /* ---------- router ---------- */
  function parseHash() {
    const hash = (location.hash || '#/dashboard').replace(/^#\/?/, '');
    const [route, id] = hash.split('/');
    return { route: route || 'dashboard', id };
  }
  window.addEventListener('hashchange', render);

  function navigate(path) { location.hash = path; }

  /* ---------- shell ---------- */
  const NAV_ITEMS = [
    { route: 'dashboard', label: '儀表板', icon: '📊' },
    { route: 'equipment', label: '設備清單', icon: '🖥️' },
    { route: 'pricing', label: '價格管理', icon: '💰' },
    { route: 'reports', label: '報表分析', icon: '📈' },
    { route: 'users', label: '使用者管理', icon: '👤', adminOnly: true },
    { route: 'features', label: '功能介紹', icon: '✨' }
  ];

  function renderShell(route, contentHtml) {
    const user = EPM.auth.getCurrentUser();
    const isAdmin = EPM.auth.isAdmin();
    root.innerHTML = `
      <div class="app-shell">
        <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
        <aside class="sidebar" id="sidebar">
          <div class="brand">
            <div class="brand-mark">EP</div>
            <div class="brand-text">
              <div class="brand-title">EquipPro</div>
              <div class="brand-sub">企業級設備管理系統</div>
            </div>
          </div>
          <nav class="nav">
            ${NAV_ITEMS.filter(n => !n.adminOnly || isAdmin).map(n => `
              <a href="#/${n.route}" class="nav-item ${route === n.route ? 'active' : ''}">
                <span class="nav-icon">${n.icon}</span><span>${esc(n.label)}</span>
              </a>`).join('')}
          </nav>
          <div class="sidebar-footer">
            <div class="user-chip">
              <div class="avatar">${esc((user.name || '?').slice(0, 1))}</div>
              <div class="user-meta">
                <div class="user-name">${esc(user.name)}</div>
                <div class="user-role">${user.role === 'admin' ? '管理員' : '一般人員'}</div>
              </div>
            </div>
            <button class="btn btn-ghost btn-block" id="logout-btn">登出</button>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <button class="icon-btn mobile-menu-btn" id="mobile-menu-btn" aria-label="開啟選單">☰</button>
            <div class="topbar-title">${esc(NAV_ITEMS.find(n => n.route === route)?.label || '')}</div>
            <div class="topbar-actions">
              <button class="btn btn-ghost" id="theme-toggle">${themeLabel()}</button>
            </div>
          </header>
          <main class="content" id="page-content">${contentHtml}</main>
        </div>
      </div>`;
    document.getElementById('logout-btn').addEventListener('click', () => {
      EPM.auth.logout();
      navigate('/login');
    });
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
      sidebar.classList.add('open');
      backdrop.classList.add('open');
    });
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('open');
    });
    document.getElementById('theme-toggle').addEventListener('click', cycleTheme);
  }

  /* ---------- login view ---------- */
  function renderLogin(message) {
    root.innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <div class="login-brand">
            <div class="brand-mark lg">EP</div>
            <div class="brand-title lg">EquipPro</div>
            <div class="brand-sub">企業級設備更換紀錄與價位管理系統</div>
          </div>
          <form id="login-form" class="form">
            <label class="field">
              <span>帳號</span>
              <input type="text" name="username" autocomplete="username" required autofocus />
            </label>
            <label class="field">
              <span>密碼</span>
              <input type="password" name="password" autocomplete="current-password" required />
            </label>
            ${message ? `<div class="form-error">${esc(message)}</div>` : ''}
            <button type="submit" class="btn btn-primary btn-block">登入</button>
          </form>
        </div>
      </div>`;
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const result = EPM.auth.login(fd.get('username'), fd.get('password'));
      if (result.ok) { navigate('/dashboard'); }
      else { renderLogin(result.message); }
    });
  }

  /* ---------- first-run setup view (create the first admin account) ---------- */
  function renderSetup(message) {
    root.innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <div class="login-brand">
            <div class="brand-mark lg">EP</div>
            <div class="brand-title lg">EquipPro</div>
            <div class="brand-sub">企業級設備更換紀錄與價位管理系統</div>
          </div>
          <div class="login-hint" style="margin:0 0 16px;">首次使用，請先建立管理員帳號</div>
          <form id="setup-form" class="form">
            <label class="field">
              <span>姓名</span>
              <input type="text" name="name" autocomplete="name" />
            </label>
            <label class="field">
              <span>帳號 *</span>
              <input type="text" name="username" autocomplete="username" required autofocus />
            </label>
            <label class="field">
              <span>密碼 *</span>
              <input type="password" name="password" autocomplete="new-password" required minlength="4" />
            </label>
            <label class="field">
              <span>確認密碼 *</span>
              <input type="password" name="password2" autocomplete="new-password" required minlength="4" />
            </label>
            ${message ? `<div class="form-error">${esc(message)}</div>` : ''}
            <button type="submit" class="btn btn-primary btn-block">建立管理員帳號並登入</button>
          </form>
        </div>
      </div>`;
    document.getElementById('setup-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const username = fd.get('username');
      const password = fd.get('password');
      if (password !== fd.get('password2')) { renderSetup('兩次輸入的密碼不一致'); return; }
      const result = EPM.auth.createUser({ username, password, name: fd.get('name'), role: 'admin' });
      if (!result.ok) { renderSetup(result.message); return; }
      const login = EPM.auth.login(username, password);
      if (login.ok) navigate('/dashboard'); else renderLogin();
    });
  }

  /* ---------- dashboard view ---------- */
  function renderDashboard() {
    const s = EPM.reports.summary();
    const activity = S.read(S.KEYS.activity, []).slice(0, 8);
    const isAdmin = EPM.auth.isAdmin();
    const u = EPM.reports.userSummary();
    const html = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">總設備數</div>
          <div class="stat-value">${s.totalCount}</div>
          <div class="stat-sub">台設備列管中</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">總資產價值</div>
          <div class="stat-value">${fmtMoney(s.totalValue)}</div>
          <div class="stat-sub">採購金額累計</div>
        </div>
        <div class="stat-card ${s.upcoming.length ? 'stat-warn' : ''}">
          <div class="stat-label">待汰換提醒</div>
          <div class="stat-value">${s.upcoming.length}</div>
          <div class="stat-sub">90 天內到期或逾期</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">累計更換成本</div>
          <div class="stat-value">${fmtMoney(s.totalReplaceCost)}</div>
          <div class="stat-sub">歷史更換支出</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3>設備狀態分布</h3></div>
          <div class="chart-box"><canvas id="chart-status"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>各類別設備數量</h3></div>
          <div class="chart-box"><canvas id="chart-category"></canvas></div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3>部門別設備分布</h3></div>
          <div class="chart-box"><canvas id="chart-department"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>廠商報價決策狀態</h3></div>
          <div class="chart-box"><canvas id="chart-quote-decision"></canvas></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>更換成本趨勢</h3></div>
        <div class="chart-box chart-box-wide"><canvas id="chart-trend"></canvas></div>
      </div>

      ${isAdmin ? `
      <div class="card">
        <div class="card-header"><h3>使用者與權限概況</h3><button class="btn btn-sm btn-ghost" id="goto-users-btn">前往使用者管理</button></div>
        <div class="grid-2">
          <div class="mini-stat-row">
            <div class="mini-stat"><div class="mini-stat-value">${u.total}</div><div class="mini-stat-label">使用者總數</div></div>
            <div class="mini-stat"><div class="mini-stat-value">${u.admin}</div><div class="mini-stat-label">管理員</div></div>
            <div class="mini-stat"><div class="mini-stat-value">${u.staff}</div><div class="mini-stat-label">一般人員</div></div>
            <div class="mini-stat"><div class="mini-stat-value">${u.active}</div><div class="mini-stat-label">啟用中</div></div>
            <div class="mini-stat"><div class="mini-stat-value">${u.disabled}</div><div class="mini-stat-label">已停用</div></div>
          </div>
          <div class="chart-box"><canvas id="chart-user-role"></canvas></div>
        </div>
      </div>` : ''}

      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3>待汰換設備</h3></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>設備</th><th>部門</th><th>剩餘天數</th><th>狀態</th></tr></thead>
              <tbody>
                ${s.upcoming.length ? s.upcoming.map(e => `
                  <tr class="row-link" data-nav="#/equipment/${e.id}">
                    <td>${esc(e.name)}</td>
                    <td>${esc(e.department || '—')}</td>
                    <td class="${e.daysLeft < 0 ? 'text-crit' : e.daysLeft <= 30 ? 'text-warn' : ''}">${e.daysLeft < 0 ? `已逾期 ${Math.abs(e.daysLeft)} 天` : `${e.daysLeft} 天`}</td>
                    <td>${statusBadge(e.status)}</td>
                  </tr>`).join('') : `<tr><td colspan="4" class="empty-cell">目前沒有需要注意的設備</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>最近活動</h3></div>
          <ul class="activity-list">
            ${activity.length ? activity.map(a => `
              <li>
                <div class="activity-main"><strong>${esc(a.userName)}</strong> ${esc(a.action)}${a.target && a.target !== '-' ? ' · ' + esc(a.target) : ''}</div>
                <div class="activity-time">${new Date(a.timestamp).toLocaleString('zh-TW')}</div>
              </li>`).join('') : `<li class="empty-cell">尚無活動紀錄</li>`}
          </ul>
        </div>
      </div>`;
    renderShell('dashboard', html);
    document.querySelectorAll('[data-nav]').forEach(row => row.addEventListener('click', () => navigate(row.dataset.nav.replace('#', ''))));
    EPM.reports.renderStatusChart('chart-status');
    EPM.reports.renderCategoryChart('chart-category');
    EPM.reports.renderDepartmentChart('chart-department');
    EPM.reports.renderQuoteDecisionChart('chart-quote-decision');
    EPM.reports.renderCostTrendChart('chart-trend');
    if (isAdmin) {
      EPM.reports.renderUserRoleChart('chart-user-role');
      document.getElementById('goto-users-btn').addEventListener('click', () => navigate('/users'));
    }
  }

  /* ---------- equipment list view ---------- */
  let eqFilters = { search: '', category: '', status: '' };
  function renderEquipmentList() {
    const isAdmin = EPM.auth.isAdmin();
    const all = EPM.equipment.list();
    const cats = EPM.equipment.categories();
    const filtered = all.filter(e => {
      if (eqFilters.category && e.category !== eqFilters.category) return false;
      if (eqFilters.status && e.status !== eqFilters.status) return false;
      if (eqFilters.search) {
        const q = eqFilters.search.toLowerCase();
        if (!(e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || (e.department || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });

    const html = `
      <div class="toolbar">
        <input type="text" class="input" id="eq-search" placeholder="搜尋設備名稱、編號或部門…" value="${esc(eqFilters.search)}" />
        <select class="input" id="eq-filter-category">
          <option value="">全部類別</option>
          ${cats.map(c => `<option value="${esc(c)}" ${eqFilters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <select class="input" id="eq-filter-status">
          <option value="">全部狀態</option>
          ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${eqFilters.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" id="eq-export">匯出 CSV</button>
        <button class="btn btn-primary" id="eq-add">＋ 新增設備</button>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>編號</th><th>名稱</th><th>類別</th><th>部門 / 位置</th><th>採購日期</th><th>狀態</th><th>採購金額</th><th></th></tr></thead>
            <tbody>
              ${filtered.length ? filtered.map(e => `
                <tr class="row-link" data-nav="#/equipment/${e.id}">
                  <td class="mono">${esc(e.code)}</td>
                  <td>${esc(e.name)}</td>
                  <td>${esc(e.category || '—')}</td>
                  <td>${esc(e.department || '—')} / ${esc(e.location || '—')}</td>
                  <td class="mono">${fmtDate(e.purchaseDate)}</td>
                  <td>${statusBadge(e.status)}</td>
                  <td class="mono">${fmtMoney(e.purchasePrice)}</td>
                  <td class="row-actions">
                    <button class="btn btn-sm btn-ghost" data-edit="${e.id}">編輯</button>
                    ${isAdmin ? `<button class="btn btn-sm btn-ghost btn-danger" data-delete="${e.id}">刪除</button>` : ''}
                  </td>
                </tr>`).join('') : `<tr><td colspan="8" class="empty-cell">找不到符合條件的設備</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    renderShell('equipment', html);

    document.getElementById('eq-search').addEventListener('input', (e) => { eqFilters.search = e.target.value; renderEquipmentList(); });
    document.getElementById('eq-filter-category').addEventListener('change', (e) => { eqFilters.category = e.target.value; renderEquipmentList(); });
    document.getElementById('eq-filter-status').addEventListener('change', (e) => { eqFilters.status = e.target.value; renderEquipmentList(); });
    document.getElementById('eq-export').addEventListener('click', () => { EPM.reports.exportEquipmentCSV(); toast('已匯出設備清單 CSV'); });
    document.getElementById('eq-add').addEventListener('click', () => openEquipmentForm());
    root.querySelectorAll('[data-nav]').forEach(row => row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return;
      navigate(row.dataset.nav.replace('#', ''));
    }));
    root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openEquipmentForm(EPM.equipment.get(b.dataset.edit)); }));
    root.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const eq = EPM.equipment.get(b.dataset.delete);
      if (confirmAction(`確定要刪除設備「${eq.name}」嗎？相關更換紀錄與報價也會一併刪除，此操作無法復原。`)) {
        EPM.equipment.remove(b.dataset.delete);
        toast('已刪除設備');
        renderEquipmentList();
      }
    }));
  }

  function openEquipmentForm(existing) {
    const isEdit = !!existing;
    const cats = EPM.equipment.categories();
    const html = `
      <div class="modal-header"><h3>${isEdit ? '編輯設備' : '新增設備'}</h3><button class="icon-btn" data-close-modal>✕</button></div>
      <form id="eq-form" class="form modal-body">
        <div class="form-row">
          <label class="field"><span>設備編號</span><input type="text" name="code" placeholder="留空自動產生" value="${esc(existing?.code)}" /></label>
          <label class="field"><span>設備名稱 *</span><input type="text" name="name" required value="${esc(existing?.name)}" /></label>
        </div>
        <div class="form-row">
          <label class="field"><span>類別</span><input type="text" name="category" list="cat-list" value="${esc(existing?.category)}" placeholder="例如：IT設備" />
            <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
          </label>
          <label class="field"><span>狀態</span>
            <select name="status">
              ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${existing?.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="form-row">
          <label class="field"><span>使用部門</span><input type="text" name="department" value="${esc(existing?.department)}" /></label>
          <label class="field"><span>放置位置</span><input type="text" name="location" value="${esc(existing?.location)}" /></label>
        </div>
        <div class="form-row">
          <label class="field"><span>採購日期</span><input type="date" name="purchaseDate" value="${esc(existing?.purchaseDate)}" /></label>
          <label class="field"><span>採購金額</span><input type="number" min="0" name="purchasePrice" value="${existing?.purchasePrice ?? ''}" /></label>
        </div>
        <div class="form-row">
          <label class="field"><span>保固期間（月）</span><input type="number" min="0" name="warrantyMonths" value="${existing?.warrantyMonths ?? ''}" /></label>
          <label class="field"><span>預期使用年限（年）</span><input type="number" min="0" name="lifespanYears" value="${existing?.lifespanYears ?? ''}" /></label>
        </div>
        <label class="field"><span>供應商</span><input type="text" name="supplier" value="${esc(existing?.supplier)}" /></label>
        <label class="field"><span>備註</span><textarea name="notes" rows="2">${esc(existing?.notes)}</textarea></label>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
          <button type="submit" class="btn btn-primary">${isEdit ? '儲存變更' : '新增設備'}</button>
        </div>
      </form>`;
    openModal(html, {
      onMount: () => {
        document.getElementById('eq-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          if (isEdit) EPM.equipment.update(existing.id, data);
          else EPM.equipment.create(data);
          closeModal();
          toast(isEdit ? '已儲存設備變更' : '已新增設備');
          if (parseHash().route === 'equipment' && parseHash().id) renderEquipmentDetail(parseHash().id);
          else renderEquipmentList();
        });
      }
    });
  }

  /* ---------- equipment detail view ---------- */
  function renderEquipmentDetail(id) {
    const eq = EPM.equipment.get(id);
    const isAdmin = EPM.auth.isAdmin();
    if (!eq) { navigate('/equipment'); return; }
    const replacements = EPM.equipment.listReplacements(id).sort((a, b) => b.createdAt - a.createdAt);
    const quotes = EPM.pricing.list(id).sort((a, b) => a.price - b.price);

    const html = `
      <div class="detail-header">
        <button class="btn btn-ghost btn-sm" id="back-btn">← 返回設備清單</button>
      </div>
      <div class="card">
        <div class="card-header">
          <h3>${esc(eq.name)} <span class="mono muted">(${esc(eq.code)})</span></h3>
          <div class="card-header-actions">${statusBadge(eq.status)}<button class="btn btn-sm btn-ghost" id="eq-edit-btn">編輯</button></div>
        </div>
        <div class="detail-grid">
          <div><span class="detail-label">類別</span><span>${esc(eq.category || '—')}</span></div>
          <div><span class="detail-label">部門</span><span>${esc(eq.department || '—')}</span></div>
          <div><span class="detail-label">位置</span><span>${esc(eq.location || '—')}</span></div>
          <div><span class="detail-label">採購日期</span><span class="mono">${fmtDate(eq.purchaseDate)}</span></div>
          <div><span class="detail-label">採購金額</span><span class="mono">${fmtMoney(eq.purchasePrice)}</span></div>
          <div><span class="detail-label">保固期間</span><span>${eq.warrantyMonths || 0} 個月</span></div>
          <div><span class="detail-label">預期使用年限</span><span>${eq.lifespanYears || 0} 年</span></div>
          <div><span class="detail-label">供應商</span><span>${esc(eq.supplier || '—')}</span></div>
        </div>
        ${eq.notes ? `<div class="detail-notes"><span class="detail-label">備註</span><p>${esc(eq.notes)}</p></div>` : ''}
      </div>

      <div class="card">
        <div class="card-header"><h3>更換紀錄</h3><button class="btn btn-sm btn-primary" id="add-replacement-btn">＋ 新增更換紀錄</button></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>日期</th><th>原因</th><th>成本</th><th>廠商</th><th>經辦人</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
            <tbody>
              ${replacements.length ? replacements.map(r => `
                <tr>
                  <td class="mono">${fmtDate(r.replaceDate)}</td>
                  <td>${esc(r.reason || '—')}</td>
                  <td class="mono">${fmtMoney(r.cost)}</td>
                  <td>${esc(r.vendor || '—')}</td>
                  <td>${esc(r.operator || '—')}</td>
                  ${isAdmin ? `<td class="row-actions"><button class="btn btn-sm btn-ghost btn-danger" data-del-rep="${r.id}">刪除</button></td>` : ''}
                </tr>`).join('') : `<tr><td colspan="${isAdmin ? 6 : 5}" class="empty-cell">尚無更換紀錄</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>廠商報價</h3><button class="btn btn-sm btn-primary" id="add-quote-btn">＋ 新增報價</button></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>項目</th><th>廠商</th><th>報價</th><th>報價日期</th><th>有效期限</th><th>狀態</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
            <tbody>
              ${quotes.length ? quotes.map((q, i) => `
                <tr class="${q.selected ? 'row-selected' : ''}">
                  <td>${esc(q.itemName)}</td>
                  <td>${esc(q.vendor)}</td>
                  <td class="mono ${i === 0 ? 'text-good' : ''}">${fmtMoney(q.price)}</td>
                  <td class="mono">${fmtDate(q.quoteDate)}</td>
                  <td class="mono">${fmtDate(q.validUntil)}</td>
                  <td>${q.selected ? '<span class="badge badge-good">已選定</span>' : (isAdmin ? `<button class="btn btn-sm btn-ghost" data-select-quote="${q.id}">選定</button>` : '—')}</td>
                  ${isAdmin ? `<td class="row-actions"><button class="btn btn-sm btn-ghost btn-danger" data-del-quote="${q.id}">刪除</button></td>` : ''}
                </tr>`).join('') : `<tr><td colspan="${isAdmin ? 7 : 6}" class="empty-cell">尚無報價紀錄</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;

    renderShell('equipment', html);
    document.getElementById('back-btn').addEventListener('click', () => navigate('/equipment'));
    document.getElementById('eq-edit-btn').addEventListener('click', () => openEquipmentForm(eq));
    document.getElementById('add-replacement-btn').addEventListener('click', () => openReplacementForm(eq));
    document.getElementById('add-quote-btn').addEventListener('click', () => openQuoteForm(eq));
    root.querySelectorAll('[data-del-rep]').forEach(b => b.addEventListener('click', () => {
      if (confirmAction('確定要刪除這筆更換紀錄嗎？')) { EPM.equipment.removeReplacement(b.dataset.delRep); toast('已刪除更換紀錄'); renderEquipmentDetail(id); }
    }));
    root.querySelectorAll('[data-del-quote]').forEach(b => b.addEventListener('click', () => {
      if (confirmAction('確定要刪除這筆報價嗎？')) { EPM.pricing.removeQuote(b.dataset.delQuote); toast('已刪除報價'); renderEquipmentDetail(id); }
    }));
    root.querySelectorAll('[data-select-quote]').forEach(b => b.addEventListener('click', () => {
      EPM.pricing.selectVendor(b.dataset.selectQuote); toast('已選定廠商'); renderEquipmentDetail(id);
    }));
  }

  function openReplacementForm(eq) {
    const html = `
      <div class="modal-header"><h3>新增更換紀錄 — ${esc(eq.name)}</h3><button class="icon-btn" data-close-modal>✕</button></div>
      <form id="rep-form" class="form modal-body">
        <div class="form-row">
          <label class="field"><span>更換日期 *</span><input type="date" name="replaceDate" required value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label class="field"><span>成本</span><input type="number" min="0" name="cost" /></label>
        </div>
        <label class="field"><span>更換原因</span><input type="text" name="reason" /></label>
        <div class="form-row">
          <label class="field"><span>廠商</span><input type="text" name="vendor" /></label>
          <label class="field"><span>舊設備處置</span><input type="text" name="disposal" placeholder="例如：原廠回收" /></label>
        </div>
        <label class="field"><span>備註</span><textarea name="notes" rows="2"></textarea></label>
        <label class="checkbox-field"><input type="checkbox" name="markRetired" checked /> 同步將此設備狀態標記為「已汰換」</label>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
          <button type="submit" class="btn btn-primary">新增紀錄</button>
        </div>
      </form>`;
    openModal(html, {
      onMount: () => {
        document.getElementById('rep-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const data = Object.fromEntries(fd.entries());
          data.equipmentId = eq.id;
          data.markRetired = fd.get('markRetired') === 'on';
          EPM.equipment.addReplacement(data);
          closeModal();
          toast('已新增更換紀錄');
          renderEquipmentDetail(eq.id);
        });
      }
    });
  }

  function openQuoteForm(eq, defaultItemName) {
    const html = `
      <div class="modal-header"><h3>新增報價 — ${esc(eq.name)}</h3><button class="icon-btn" data-close-modal>✕</button></div>
      <form id="quote-form" class="form modal-body">
        <label class="field"><span>報價項目 *</span><input type="text" name="itemName" required value="${esc(defaultItemName || eq.name + ' 汰換')}" /></label>
        <div class="form-row">
          <label class="field"><span>廠商 *</span><input type="text" name="vendor" required /></label>
          <label class="field"><span>報價金額 *</span><input type="number" min="0" name="price" required /></label>
        </div>
        <div class="form-row">
          <label class="field"><span>報價日期</span><input type="date" name="quoteDate" value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label class="field"><span>有效期限</span><input type="date" name="validUntil" /></label>
        </div>
        <label class="field"><span>聯絡方式</span><input type="text" name="contact" /></label>
        <label class="field"><span>備註</span><textarea name="notes" rows="2"></textarea></label>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
          <button type="submit" class="btn btn-primary">新增報價</button>
        </div>
      </form>`;
    openModal(html, {
      onMount: () => {
        document.getElementById('quote-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          data.equipmentId = eq.id;
          EPM.pricing.addQuote(data);
          closeModal();
          toast('已新增報價');
          if (parseHash().route === 'pricing') renderPricing(); else renderEquipmentDetail(eq.id);
        });
      }
    });
  }

  /* ---------- pricing view ---------- */
  function renderPricing() {
    const isAdmin = EPM.auth.isAdmin();
    const groups = EPM.pricing.groupedByItem();
    const html = `
      <div class="toolbar">
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" id="quotes-export">匯出 CSV</button>
      </div>
      ${groups.length ? groups.map(g => {
        const eq = EPM.equipment.get(g.equipmentId);
        return `
        <div class="card">
          <div class="card-header">
            <h3>${esc(g.itemName)} <span class="muted">— ${esc(eq ? eq.name : '')}</span></h3>
            <button class="btn btn-sm btn-ghost" data-add-quote="${g.equipmentId}" data-item="${esc(g.itemName)}">＋ 新增報價</button>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>廠商</th><th>報價</th><th>報價日期</th><th>有效期限</th><th>聯絡方式</th><th>狀態</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
              <tbody>
                ${g.quotes.map((q, i) => `
                  <tr class="${q.selected ? 'row-selected' : ''}">
                    <td>${esc(q.vendor)}</td>
                    <td class="mono ${i === 0 ? 'text-good' : ''}">${fmtMoney(q.price)}</td>
                    <td class="mono">${fmtDate(q.quoteDate)}</td>
                    <td class="mono">${fmtDate(q.validUntil)}</td>
                    <td>${esc(q.contact || '—')}</td>
                    <td>${q.selected ? '<span class="badge badge-good">已選定</span>' : (isAdmin ? `<button class="btn btn-sm btn-ghost" data-select-quote="${q.id}">選定</button>` : '—')}</td>
                    ${isAdmin ? `<td class="row-actions"><button class="btn btn-sm btn-ghost btn-danger" data-del-quote="${q.id}">刪除</button></td>` : ''}
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
      }).join('') : `<div class="card"><div class="empty-cell">尚無報價資料，請至設備詳細頁面新增報價</div></div>`}`;

    renderShell('pricing', html);
    document.getElementById('quotes-export').addEventListener('click', () => { EPM.reports.exportQuotesCSV(); toast('已匯出報價紀錄 CSV'); });
    root.querySelectorAll('[data-add-quote]').forEach(b => b.addEventListener('click', () => {
      const eq = EPM.equipment.get(b.dataset.addQuote);
      if (eq) openQuoteForm(eq, b.dataset.item);
    }));
    root.querySelectorAll('[data-select-quote]').forEach(b => b.addEventListener('click', () => { EPM.pricing.selectVendor(b.dataset.selectQuote); toast('已選定廠商'); renderPricing(); }));
    root.querySelectorAll('[data-del-quote]').forEach(b => b.addEventListener('click', () => {
      if (confirmAction('確定要刪除這筆報價嗎？')) { EPM.pricing.removeQuote(b.dataset.delQuote); toast('已刪除報價'); renderPricing(); }
    }));
  }

  /* ---------- reports view ---------- */
  function renderReports() {
    const groups = EPM.pricing.groupedByItem();
    const html = `
      <div class="toolbar">
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" id="export-eq">匯出設備清單</button>
        <button class="btn btn-ghost" id="export-rep">匯出更換紀錄</button>
        <button class="btn btn-ghost" id="export-quote">匯出報價紀錄</button>
        <button class="btn btn-primary" id="print-report">列印報表</button>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3>設備狀態分布</h3></div>
          <div class="chart-box"><canvas id="r-chart-status"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>各類別設備數量</h3></div>
          <div class="chart-box"><canvas id="r-chart-category"></canvas></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>更換成本趨勢</h3></div>
        <div class="chart-box chart-box-wide"><canvas id="r-chart-trend"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header">
          <h3>廠商報價比較</h3>
          <select class="input" id="r-item-select">
            <option value="">選擇比較項目…</option>
            ${groups.map(g => `<option value="${g.key}">${esc(g.itemName)}</option>`).join('')}
          </select>
        </div>
        <div class="chart-box chart-box-wide"><canvas id="r-chart-vendor"></canvas></div>
      </div>`;
    renderShell('reports', html);
    EPM.reports.renderStatusChart('r-chart-status');
    EPM.reports.renderCategoryChart('r-chart-category');
    EPM.reports.renderCostTrendChart('r-chart-trend');
    if (groups.length) {
      document.getElementById('r-item-select').value = groups[0].key;
      EPM.reports.renderVendorCompareChart('r-chart-vendor', groups[0]);
    }
    document.getElementById('r-item-select').addEventListener('change', (e) => {
      const g = groups.find(g => g.key === e.target.value);
      EPM.reports.renderVendorCompareChart('r-chart-vendor', g);
    });
    document.getElementById('export-eq').addEventListener('click', () => { EPM.reports.exportEquipmentCSV(); toast('已匯出設備清單 CSV'); });
    document.getElementById('export-rep').addEventListener('click', () => { EPM.reports.exportReplacementsCSV(); toast('已匯出更換紀錄 CSV'); });
    document.getElementById('export-quote').addEventListener('click', () => { EPM.reports.exportQuotesCSV(); toast('已匯出報價紀錄 CSV'); });
    document.getElementById('print-report').addEventListener('click', () => window.print());
  }

  /* ---------- users view (admin only) ---------- */
  function renderUsers() {
    if (!EPM.auth.isAdmin()) { navigate('/dashboard'); return; }
    const users = EPM.auth.getUsers();
    const me = EPM.auth.getCurrentUser();
    const html = `
      <div class="toolbar">
        <div class="toolbar-spacer"></div>
        <button class="btn btn-primary" id="add-user-btn">＋ 新增使用者</button>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>帳號</th><th>姓名</th><th>角色</th><th>狀態</th><th>建立時間</th><th></th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td class="mono">${esc(u.username)}</td>
                  <td>${esc(u.name)}</td>
                  <td>${u.role === 'admin' ? '<span class="badge badge-good">管理員</span>' : '<span class="badge badge-muted">一般人員</span>'}</td>
                  <td>${u.active ? '<span class="badge badge-good">啟用中</span>' : '<span class="badge badge-crit">已停用</span>'}</td>
                  <td class="mono">${new Date(u.createdAt).toLocaleDateString('zh-TW')}</td>
                  <td class="row-actions">
                    <button class="btn btn-sm btn-ghost" data-edit-user="${u.id}">編輯</button>
                    <button class="btn btn-sm btn-ghost" data-toggle-user="${u.id}">${u.active ? '停用' : '啟用'}</button>
                    ${u.id !== me.id ? `<button class="btn btn-sm btn-ghost btn-danger" data-del-user="${u.id}">刪除</button>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    renderShell('users', html);
    document.getElementById('add-user-btn').addEventListener('click', () => openUserForm());
    root.querySelectorAll('[data-edit-user]').forEach(b => b.addEventListener('click', () => openUserForm(users.find(u => u.id === b.dataset.editUser))));
    root.querySelectorAll('[data-toggle-user]').forEach(b => b.addEventListener('click', () => {
      const u = users.find(u => u.id === b.dataset.toggleUser);
      const result = EPM.auth.updateUser(u.id, { active: !u.active });
      if (!result.ok) toast(result.message, 'error'); else toast(u.active ? '已停用帳號' : '已啟用帳號');
      renderUsers();
    }));
    root.querySelectorAll('[data-del-user]').forEach(b => b.addEventListener('click', () => {
      if (confirmAction('確定要刪除此使用者嗎？')) {
        const result = EPM.auth.deleteUser(b.dataset.delUser);
        if (!result.ok) toast(result.message, 'error'); else toast('已刪除使用者');
        renderUsers();
      }
    }));
  }

  function openUserForm(existing) {
    const isEdit = !!existing;
    const html = `
      <div class="modal-header"><h3>${isEdit ? '編輯使用者' : '新增使用者'}</h3><button class="icon-btn" data-close-modal>✕</button></div>
      <form id="user-form" class="form modal-body">
        <label class="field"><span>帳號 *</span><input type="text" name="username" required value="${esc(existing?.username)}" ${isEdit ? 'disabled' : ''} /></label>
        <label class="field"><span>姓名</span><input type="text" name="name" value="${esc(existing?.name)}" /></label>
        <label class="field"><span>${isEdit ? '重設密碼（留空則不變更）' : '密碼 *'}</span><input type="password" name="password" ${isEdit ? '' : 'required'} /></label>
        <label class="field"><span>角色</span>
          <select name="role">
            <option value="staff" ${existing?.role === 'staff' ? 'selected' : ''}>一般人員</option>
            <option value="admin" ${existing?.role === 'admin' ? 'selected' : ''}>管理員</option>
          </select>
        </label>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
          <button type="submit" class="btn btn-primary">${isEdit ? '儲存變更' : '新增使用者'}</button>
        </div>
      </form>`;
    openModal(html, {
      onMount: () => {
        document.getElementById('user-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          if (!data.password) delete data.password;
          const result = isEdit ? EPM.auth.updateUser(existing.id, data) : EPM.auth.createUser(data);
          if (!result.ok) { toast(result.message, 'error'); return; }
          closeModal();
          toast(isEdit ? '已儲存使用者變更' : '已新增使用者');
          renderUsers();
        });
      }
    });
  }

  /* ---------- features overview view ---------- */
  const FEATURE_GROUPS = [
    {
      title: '核心功能',
      items: [
        { icon: '📊', name: '儀表板總覽', desc: '即時掌握總設備數、總資產價值、待汰換提醒與累計更換成本，並以圖表呈現狀態分布、類別統計與成本趨勢。' },
        { icon: '🖥️', name: '設備清單與更換紀錄', desc: '新增、編輯、刪除設備資料，記錄採購日期、保固期間、使用年限；每台設備可查詢完整的更換歷史。' },
        { icon: '💰', name: '價格管理與報價比較', desc: '依項目分組管理多家廠商報價，自動標示最低價，可選定合作廠商並保留完整報價歷程與聯絡資訊。' },
        { icon: '📈', name: '統計報表與圖表分析', desc: '狀態分布、類別數量、成本趨勢、廠商比價共四種圖表，並可匯出 CSV 或直接列印報表。' },
        { icon: '👤', name: '多使用者權限管理', desc: '管理員／一般人員角色區隔：管理員可管理帳號、刪除資料；一般人員可查看與新增，但無法刪除或管理使用者。' }
      ]
    },
    {
      title: '進階特色',
      items: [
        { icon: '⏰', name: '待汰換提醒', desc: '依採購日期與預期使用年限自動計算，90 天內到期或已逾期的設備會自動列在儀表板中提醒。' },
        { icon: '📝', name: '操作稽核紀錄', desc: '記錄誰在何時新增、編輯或刪除了哪些資料，方便追蹤異動與稽核。' },
        { icon: '📤', name: '資料匯出', desc: '設備清單、更換紀錄、報價紀錄皆可一鍵匯出為相容 Excel 的 CSV 檔案。' },
        { icon: '🌓', name: '深色／淺色主題', desc: '可切換自動、亮色、暗色三種顯示模式，符合不同使用情境與個人偏好。' },
        { icon: '🔐', name: '首次設定精靈', desc: '系統不內建預設帳密，首次啟動會引導建立專屬的管理員帳號，降低憑證外洩風險。' },
        { icon: '💾', name: '免安裝、免伺服器', desc: '純前端網頁應用，資料儲存在瀏覽器本機；可直接開啟使用，也能部署到任何網頁伺服器或 GitHub Pages。' }
      ]
    }
  ];

  function renderFeatures() {
    const html = `
      ${FEATURE_GROUPS.map(group => `
        <div class="card">
          <div class="card-header"><h3>${esc(group.title)}</h3></div>
          <div class="feature-grid">
            ${group.items.map(f => `
              <div class="feature-card">
                <div class="feature-icon">${f.icon}</div>
                <div class="feature-name">${esc(f.name)}</div>
                <div class="feature-desc">${esc(f.desc)}</div>
              </div>`).join('')}
          </div>
        </div>`).join('')}`;
    renderShell('features', html);
  }

  /* ---------- main render dispatch ---------- */
  function render() {
    if (!EPM.auth.hasUsers()) { renderSetup(); return; }
    const user = EPM.auth.getCurrentUser();
    const { route, id } = parseHash();
    if (!user) { renderLogin(); return; }
    switch (route) {
      case 'equipment': id ? renderEquipmentDetail(id) : renderEquipmentList(); break;
      case 'pricing': renderPricing(); break;
      case 'reports': renderReports(); break;
      case 'users': renderUsers(); break;
      case 'features': renderFeatures(); break;
      case 'dashboard': default: renderDashboard(); break;
    }
  }

  window.EPM.app = { render, navigate, toast };

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    EPM.storage.seed();
    applyTheme();
    render();
  });
})();
