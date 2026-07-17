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
            ${NAV_ITEMS.filter(n => (!n.adminOnly || isAdmin) && EPM.auth.hasModuleAccess(n.route)).map(n => `
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
  const DASHBOARD_SECTIONS = [
    { id: 'stats', label: '統計總覽', adminOnly: false },
    { id: 'alerts', label: '分級到期預警', adminOnly: false },
    { id: 'depreciation', label: '資產折舊與淨值', adminOnly: false },
    { id: 'timeline', label: '汰換規劃時間軸', adminOnly: false },
    { id: 'charts1', label: '狀態與類別分布', adminOnly: false },
    { id: 'charts2', label: '部門與報價決策', adminOnly: false },
    { id: 'trend', label: '更換成本趨勢', adminOnly: false },
    { id: 'admin', label: '使用者與權限概況', adminOnly: true },
    { id: 'lists', label: '待汰換清單與活動紀錄', adminOnly: false }
  ];
  const DEFAULT_DASHBOARD_LAYOUT = DASHBOARD_SECTIONS.map(sec => ({ id: sec.id, visible: true }));

  function getDashboardLayout() {
    const saved = S.read(S.KEYS.dashboardLayout, null);
    if (!Array.isArray(saved) || !saved.length) return DEFAULT_DASHBOARD_LAYOUT.slice();
    // Merge in any section the saved layout doesn't know about yet (e.g. after an app update).
    const known = new Set(saved.map(item => item.id));
    const merged = saved.filter(item => DASHBOARD_SECTIONS.some(d => d.id === item.id));
    DASHBOARD_SECTIONS.forEach(d => { if (!known.has(d.id)) merged.push({ id: d.id, visible: true }); });
    return merged;
  }
  function saveDashboardLayout(layout) { S.write(S.KEYS.dashboardLayout, layout); }

  let dashRangePreset = 'all';
  let dashRangeCustom = { start: '', end: '' };
  function getDashRange() {
    if (dashRangePreset === 'custom') {
      if (!dashRangeCustom.start || !dashRangeCustom.end) return null;
      const start = new Date(dashRangeCustom.start).getTime();
      const end = new Date(dashRangeCustom.end + 'T23:59:59.999').getTime();
      if (isNaN(start) || isNaN(end) || start > end) return null;
      return { start, end };
    }
    return EPM.reports.presetRange(dashRangePreset);
  }
  function dashRangeLabel(range) {
    if (dashRangePreset === 'custom') return range ? '自訂區間' : '自訂區間（請選擇日期）';
    return { all: '全部期間', month: '本月', quarter: '本季', year: '本年' }[dashRangePreset] || '全部期間';
  }

  function renderDashboard() {
    const range = getDashRange();
    const s = EPM.reports.summary();
    const dep = EPM.reports.depreciationSummary();
    const costCmp = EPM.reports.costComparison(range);
    const activity = S.read(S.KEYS.activity, []).slice(0, 8);
    const isAdmin = EPM.auth.isAdmin();
    const u = EPM.reports.userSummary();
    const layout = getDashboardLayout();
    const T = EPM.reports.ALERT_TIER_LABEL, TC = EPM.reports.ALERT_TIER_COLOR;

    const deltaHtml = costCmp.deltaPct === null ? '' : `
        <div class="stat-sub ${costCmp.deltaPct > 0 ? 'text-crit' : costCmp.deltaPct < 0 ? 'text-good' : ''}">
          ${costCmp.deltaPct === 0 ? '與上期持平' : (costCmp.deltaPct > 0 ? '▲' : '▼') + Math.abs(Math.round(costCmp.deltaPct)) + '% 較上期'}
        </div>`;

    const sections = {
      stats: `
      <div class="stat-grid dash-section dash-stats">
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
          <div class="stat-label">${range ? '期間更換成本' : '累計更換成本'}</div>
          <div class="stat-value">${fmtMoney(costCmp.current)}</div>
          ${deltaHtml || '<div class="stat-sub">歷史更換支出</div>'}
        </div>
      </div>`,

      alerts: `
      <div class="card dash-section dash-alerts">
        <div class="card-header"><h3>分級到期預警</h3></div>
        <div class="tier-grid">
          ${['overdue', 't30', 't60', 't90'].map(k => `
            <div class="tier-card" style="--tier-color:${TC[k]}">
              <div class="stat-label">${T[k]}</div>
              <div class="stat-value" style="color:${TC[k]}">${s.alertTiers[k]}</div>
              <div class="stat-sub">台設備</div>
            </div>`).join('')}
        </div>
      </div>`,

      depreciation: `
      <div class="card dash-section dash-depreciation">
        <div class="card-header"><h3>資產折舊與淨值</h3></div>
        <div class="grid-2">
          <div class="mini-stat-row">
            <div class="mini-stat"><div class="mini-stat-value">${fmtMoney(dep.totalOriginal)}</div><div class="mini-stat-label">原始採購金額</div></div>
            <div class="mini-stat"><div class="mini-stat-value">${fmtMoney(dep.totalNet)}</div><div class="mini-stat-label">目前帳面淨值</div></div>
            <div class="mini-stat"><div class="mini-stat-value">${fmtMoney(dep.totalDepreciated)}</div><div class="mini-stat-label">累計折舊金額</div></div>
          </div>
          <div class="chart-box"><canvas id="chart-depreciation"></canvas></div>
        </div>
      </div>`,

      timeline: `
      <div class="card dash-section dash-timeline">
        <div class="card-header"><h3>未來 12 個月汰換規劃時間軸</h3></div>
        <div class="chart-box chart-box-wide"><canvas id="chart-timeline"></canvas></div>
      </div>`,

      charts1: `
      <div class="grid-2 dash-section dash-charts-1">
        <div class="card">
          <div class="card-header"><h3>設備狀態分布</h3></div>
          <div class="chart-box"><canvas id="chart-status"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>各類別設備數量</h3></div>
          <div class="chart-box"><canvas id="chart-category"></canvas></div>
        </div>
      </div>`,

      charts2: `
      <div class="grid-2 dash-section dash-charts-2">
        <div class="card">
          <div class="card-header"><h3>部門別設備分布</h3></div>
          <div class="chart-box"><canvas id="chart-department"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>廠商報價決策狀態</h3></div>
          <div class="chart-box"><canvas id="chart-quote-decision"></canvas></div>
        </div>
      </div>`,

      trend: `
      <div class="card dash-section dash-trend">
        <div class="card-header"><h3>更換成本趨勢（${dashRangeLabel(range)}）</h3></div>
        <div class="chart-box chart-box-wide"><canvas id="chart-trend"></canvas></div>
      </div>`,

      admin: isAdmin ? `
      <div class="card dash-section dash-admin">
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
      </div>` : '',

      lists: `
      <div class="grid-2 dash-section dash-lists">
        <div class="card">
          <div class="card-header"><h3>待汰換設備</h3></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>設備</th><th>部門</th><th>剩餘天數</th><th>狀態</th></tr></thead>
              <tbody>
                ${s.upcoming.length ? s.upcoming.map(e => `
                  <tr class="row-link" data-nav="#/equipment/${e.id}">
                    <td data-label="設備">${esc(e.name)}</td>
                    <td data-label="部門">${esc(e.department || '—')}</td>
                    <td data-label="剩餘天數" class="${e.daysLeft < 0 ? 'text-crit' : e.daysLeft <= 30 ? 'text-warn' : ''}">${e.daysLeft < 0 ? `已逾期 ${Math.abs(e.daysLeft)} 天` : `${e.daysLeft} 天`}</td>
                    <td data-label="狀態">${statusBadge(e.status)}</td>
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
      </div>`
    };

    const toolbarHtml = `
      <div class="toolbar dash-toolbar">
        <div class="range-btn-group">
          ${['all', 'month', 'quarter', 'year', 'custom'].map(p => `
            <button type="button" class="range-btn ${dashRangePreset === p ? 'active' : ''}" data-range="${p}">${{ all: '全部', month: '本月', quarter: '本季', year: '本年', custom: '自訂' }[p]}</button>`).join('')}
        </div>
        ${dashRangePreset === 'custom' ? `
          <input type="date" class="input" id="dash-range-start" value="${esc(dashRangeCustom.start)}" />
          <span class="muted">至</span>
          <input type="date" class="input" id="dash-range-end" value="${esc(dashRangeCustom.end)}" />
        ` : ''}
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" id="dash-customize-btn">⚙️ 自訂版面</button>
      </div>`;

    const bodyHtml = layout
      .filter(item => sections[item.id] && item.visible !== false)
      .filter(item => { const def = DASHBOARD_SECTIONS.find(d => d.id === item.id); return !def || !def.adminOnly || isAdmin; })
      .map(item => sections[item.id]).join('');

    renderShell('dashboard', toolbarHtml + bodyHtml);

    document.querySelectorAll('[data-nav]').forEach(row => row.addEventListener('click', () => navigate(row.dataset.nav.replace('#', ''))));

    document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => {
      dashRangePreset = btn.dataset.range;
      renderDashboard();
    }));
    const startInput = document.getElementById('dash-range-start');
    const endInput = document.getElementById('dash-range-end');
    if (startInput) startInput.addEventListener('change', (e) => { dashRangeCustom.start = e.target.value; renderDashboard(); });
    if (endInput) endInput.addEventListener('change', (e) => { dashRangeCustom.end = e.target.value; renderDashboard(); });
    document.getElementById('dash-customize-btn').addEventListener('click', () => openDashboardLayoutModal(isAdmin));

    if (document.getElementById('chart-status')) EPM.reports.renderStatusChart('chart-status');
    if (document.getElementById('chart-category')) EPM.reports.renderCategoryChart('chart-category');
    if (document.getElementById('chart-department')) EPM.reports.renderDepartmentChart('chart-department');
    if (document.getElementById('chart-quote-decision')) EPM.reports.renderQuoteDecisionChart('chart-quote-decision');
    if (document.getElementById('chart-trend')) EPM.reports.renderCostTrendChart('chart-trend', range);
    if (document.getElementById('chart-depreciation')) EPM.reports.renderDepreciationChart('chart-depreciation');
    if (document.getElementById('chart-timeline')) EPM.reports.renderReplacementTimelineChart('chart-timeline');
    if (isAdmin && document.getElementById('chart-user-role')) {
      EPM.reports.renderUserRoleChart('chart-user-role');
      document.getElementById('goto-users-btn').addEventListener('click', () => navigate('/users'));
    }
  }

  function openDashboardLayoutModal(isAdmin) {
    const layout = getDashboardLayout();
    const visibleSections = DASHBOARD_SECTIONS.filter(d => !d.adminOnly || isAdmin);
    const ordered = layout.filter(item => visibleSections.some(d => d.id === item.id));
    visibleSections.forEach(d => { if (!ordered.some(o => o.id === d.id)) ordered.push({ id: d.id, visible: true }); });

    const html = `
      <div class="modal-header"><h3>自訂儀表板版面</h3><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0 0 12px;font-size:12.5px;">拖曳調整區塊順序，取消勾選可暫時隱藏該區塊。</p>
        <ul class="layout-list" id="layout-list">
          ${ordered.map(item => {
            const def = visibleSections.find(d => d.id === item.id);
            return `
            <li class="layout-item" draggable="true" data-id="${item.id}">
              <span class="drag-handle">⠿</span>
              <label class="checkbox-field" style="flex:1;">
                <input type="checkbox" data-layout-visible ${item.visible !== false ? 'checked' : ''} />
                <span>${esc(def ? def.label : item.id)}</span>
              </label>
            </li>`;
          }).join('')}
        </ul>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" id="layout-reset-btn">還原預設</button>
        <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
        <button type="button" class="btn btn-primary" id="layout-save-btn">儲存</button>
      </div>`;

    openModal(html, {
      onMount: (modalEl) => {
        const list = modalEl.querySelector('#layout-list');
        let dragEl = null;
        list.querySelectorAll('.layout-item').forEach(li => {
          li.addEventListener('dragstart', () => { dragEl = li; li.classList.add('dragging'); });
          li.addEventListener('dragend', () => { dragEl = null; li.classList.remove('dragging'); });
          li.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!dragEl || dragEl === li) return;
            const rect = li.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            list.insertBefore(dragEl, before ? li : li.nextSibling);
          });
        });
        modalEl.querySelector('#layout-reset-btn').addEventListener('click', () => {
          saveDashboardLayout(DEFAULT_DASHBOARD_LAYOUT.slice());
          closeModal();
          toast('已還原預設版面');
          renderDashboard();
        });
        modalEl.querySelector('#layout-save-btn').addEventListener('click', () => {
          const newLayout = Array.from(list.querySelectorAll('.layout-item')).map(li => ({
            id: li.dataset.id,
            visible: li.querySelector('[data-layout-visible]').checked
          }));
          // Sections the current user can't see (e.g. admin-only, for a staff account) stay untouched.
          const preserved = getDashboardLayout().filter(item => !visibleSections.some(d => d.id === item.id));
          saveDashboardLayout([...newLayout, ...preserved]);
          closeModal();
          toast('已儲存版面設定');
          renderDashboard();
        });
      }
    });
  }

  /* ---------- equipment list view ---------- */
  const EQ_COLUMNS = [
    { key: 'code', label: '編號', sortable: true, default: true },
    { key: 'name', label: '名稱', sortable: true, default: true },
    { key: 'category', label: '類別', sortable: true, default: true },
    { key: 'department', label: '部門', sortable: true, default: true },
    { key: 'location', label: '位置', sortable: true, default: true },
    { key: 'purchaseDate', label: '採購日期', sortable: true, default: true },
    { key: 'status', label: '狀態', sortable: true, default: true },
    { key: 'purchasePrice', label: '採購金額', sortable: true, default: true },
    { key: 'supplier', label: '供應商', sortable: true, default: false },
    { key: 'warrantyMonths', label: '保固(月)', sortable: true, default: false },
    { key: 'lifespanYears', label: '使用年限(年)', sortable: true, default: false }
  ];
  const EQ_PAGE_SIZE = 20;

  let eqFilters = { search: '', category: '', status: '', department: '', supplier: '', dateFrom: '', dateTo: '', priceMin: '', priceMax: '' };
  let eqSort = { field: 'code', dir: 'asc' };
  let eqSelected = new Set();
  let eqPage = 1;
  let eqAdvancedOpen = false;

  function getEqColumns() {
    const saved = S.read(S.KEYS.equipmentColumns, null);
    if (Array.isArray(saved) && saved.length) return saved.filter(k => EQ_COLUMNS.some(c => c.key === k));
    return EQ_COLUMNS.filter(c => c.default).map(c => c.key);
  }
  function saveEqColumns(keys) { S.write(S.KEYS.equipmentColumns, keys); }

  function eqColValue(e, key) {
    if (key === 'status') return STATUS_LABEL[e.status] || e.status || '';
    if (key === 'purchasePrice' || key === 'warrantyMonths' || key === 'lifespanYears') return Number(e[key]) || 0;
    return e[key] || '';
  }
  function eqCompare(a, b, field) {
    const av = eqColValue(a, field), bv = eqColValue(b, field);
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv), 'zh-Hant');
  }
  function eqCellHtml(e, key) {
    switch (key) {
      case 'code': return `<td class="mono" data-label="編號">${esc(e.code)}</td>`;
      case 'name': return `<td data-label="名稱">${esc(e.name)}</td>`;
      case 'category': return `<td data-label="類別">${esc(e.category || '—')}</td>`;
      case 'department': return `<td data-label="部門">${esc(e.department || '—')}</td>`;
      case 'location': return `<td data-label="位置">${esc(e.location || '—')}</td>`;
      case 'purchaseDate': return `<td class="mono" data-label="採購日期">${fmtDate(e.purchaseDate)}</td>`;
      case 'status': return `<td data-label="狀態">${statusBadge(e.status)}</td>`;
      case 'purchasePrice': return `<td class="mono" data-label="採購金額">${fmtMoney(e.purchasePrice)}</td>`;
      case 'supplier': return `<td data-label="供應商">${esc(e.supplier || '—')}</td>`;
      case 'warrantyMonths': return `<td class="mono" data-label="保固(月)">${e.warrantyMonths || 0}</td>`;
      case 'lifespanYears': return `<td class="mono" data-label="使用年限">${e.lifespanYears || 0} 年</td>`;
      default: return '<td></td>';
    }
  }

  function renderEquipmentList() {
    const isAdmin = EPM.auth.isAdmin();
    const all = EPM.equipment.list();
    const cats = EPM.equipment.categories();
    const depts = EPM.equipment.departments();
    const columns = getEqColumns();

    const filtered = all.filter(e => {
      if (eqFilters.category && e.category !== eqFilters.category) return false;
      if (eqFilters.status && e.status !== eqFilters.status) return false;
      if (eqFilters.department && e.department !== eqFilters.department) return false;
      if (eqFilters.supplier && !(e.supplier || '').toLowerCase().includes(eqFilters.supplier.toLowerCase())) return false;
      if (eqFilters.dateFrom && (!e.purchaseDate || e.purchaseDate < eqFilters.dateFrom)) return false;
      if (eqFilters.dateTo && (!e.purchaseDate || e.purchaseDate > eqFilters.dateTo)) return false;
      if (eqFilters.priceMin && (e.purchasePrice || 0) < Number(eqFilters.priceMin)) return false;
      if (eqFilters.priceMax && (e.purchasePrice || 0) > Number(eqFilters.priceMax)) return false;
      if (eqFilters.search) {
        const q = eqFilters.search.toLowerCase();
        if (!(e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || (e.department || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });

    const sorted = filtered.slice().sort((a, b) => {
      const c = eqCompare(a, b, eqSort.field);
      return eqSort.dir === 'asc' ? c : -c;
    });

    const totalPages = Math.max(1, Math.ceil(sorted.length / EQ_PAGE_SIZE));
    if (eqPage > totalPages) eqPage = totalPages;
    if (eqPage < 1) eqPage = 1;
    const pageItems = sorted.slice((eqPage - 1) * EQ_PAGE_SIZE, eqPage * EQ_PAGE_SIZE);

    const activeFilterCount = ['department', 'supplier', 'dateFrom', 'dateTo', 'priceMin', 'priceMax'].filter(k => eqFilters[k]).length;

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
        <button class="btn btn-ghost" id="eq-advanced-toggle">進階篩選${activeFilterCount ? ` (${activeFilterCount})` : ''} ${eqAdvancedOpen ? '▲' : '▼'}</button>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" id="eq-columns-btn">欄位設定</button>
        <button class="btn btn-ghost" id="eq-export">匯出 CSV</button>
        <button class="btn btn-primary" id="eq-add">＋ 新增設備</button>
      </div>

      ${eqAdvancedOpen ? `
      <div class="filter-panel">
        <label class="field"><span>部門</span>
          <select class="input" id="eq-filter-department">
            <option value="">全部部門</option>
            ${depts.map(d => `<option value="${esc(d)}" ${eqFilters.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>供應商</span><input type="text" class="input" id="eq-filter-supplier" placeholder="供應商關鍵字" value="${esc(eqFilters.supplier)}" /></label>
        <label class="field"><span>採購日期（起）</span><input type="date" class="input" id="eq-filter-date-from" value="${esc(eqFilters.dateFrom)}" /></label>
        <label class="field"><span>採購日期（迄）</span><input type="date" class="input" id="eq-filter-date-to" value="${esc(eqFilters.dateTo)}" /></label>
        <label class="field"><span>採購金額（下限）</span><input type="number" min="0" class="input" id="eq-filter-price-min" value="${esc(eqFilters.priceMin)}" /></label>
        <label class="field"><span>採購金額（上限）</span><input type="number" min="0" class="input" id="eq-filter-price-max" value="${esc(eqFilters.priceMax)}" /></label>
        <div class="field" style="justify-content:flex-end;">
          <button type="button" class="btn btn-ghost btn-block" id="eq-filter-clear">清除進階篩選</button>
        </div>
      </div>` : ''}

      ${eqSelected.size ? `
      <div class="bulk-bar">
        <strong>已選取 ${eqSelected.size} 筆</strong>
        <button class="btn btn-sm btn-ghost" id="bulk-export">匯出選取項目 CSV</button>
        ${isAdmin ? `
        <select class="input" id="bulk-status" style="width:auto;">
          <option value="">批次變更狀態…</option>
          ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-ghost btn-danger" id="bulk-delete">批次刪除</button>` : ''}
        <button class="btn btn-sm btn-ghost" id="bulk-clear">取消選取</button>
      </div>` : ''}

      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th class="checkbox-cell"><input type="checkbox" id="eq-select-all" ${pageItems.length && pageItems.every(e => eqSelected.has(e.id)) ? 'checked' : ''} /></th>
              ${columns.map(key => {
                const col = EQ_COLUMNS.find(c => c.key === key);
                const active = eqSort.field === key;
                return `<th class="${col.sortable ? 'sortable' : ''}" data-sort="${key}">${esc(col.label)}${active ? `<span class="sort-arrow">${eqSort.dir === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`;
              }).join('')}
              <th></th>
            </tr></thead>
            <tbody>
              ${pageItems.length ? pageItems.map(e => `
                <tr class="row-link" data-nav="#/equipment/${e.id}">
                  <td class="checkbox-cell" data-label=""><input type="checkbox" class="eq-row-check" data-id="${e.id}" ${eqSelected.has(e.id) ? 'checked' : ''} /></td>
                  ${columns.map(key => eqCellHtml(e, key)).join('')}
                  <td class="row-actions">
                    <button class="btn btn-sm btn-ghost" data-edit="${e.id}">編輯</button>
                    ${isAdmin ? `<button class="btn btn-sm btn-ghost btn-danger" data-delete="${e.id}">刪除</button>` : ''}
                  </td>
                </tr>`).join('') : `<tr><td colspan="${columns.length + 2}" class="empty-cell">找不到符合條件的設備</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <span class="muted" style="font-size:12.5px;">共 ${sorted.length} 筆，第 ${eqPage} / ${totalPages} 頁</span>
          <div class="pagination-btns">
            <button class="btn btn-sm btn-ghost" id="eq-page-prev" ${eqPage <= 1 ? 'disabled' : ''}>上一頁</button>
            <button class="btn btn-sm btn-ghost" id="eq-page-next" ${eqPage >= totalPages ? 'disabled' : ''}>下一頁</button>
          </div>
        </div>
      </div>`;
    renderShell('equipment', html);

    const resetPage = () => { eqPage = 1; };

    document.getElementById('eq-search').addEventListener('input', (e) => { eqFilters.search = e.target.value; resetPage(); renderEquipmentList(); });
    document.getElementById('eq-filter-category').addEventListener('change', (e) => { eqFilters.category = e.target.value; resetPage(); renderEquipmentList(); });
    document.getElementById('eq-filter-status').addEventListener('change', (e) => { eqFilters.status = e.target.value; resetPage(); renderEquipmentList(); });
    document.getElementById('eq-advanced-toggle').addEventListener('click', () => { eqAdvancedOpen = !eqAdvancedOpen; renderEquipmentList(); });
    document.getElementById('eq-columns-btn').addEventListener('click', () => openColumnPickerModal());
    document.getElementById('eq-export').addEventListener('click', () => { EPM.reports.exportEquipmentCSV(sorted); toast(`已匯出 ${sorted.length} 筆設備清單 CSV`); });
    document.getElementById('eq-add').addEventListener('click', () => openEquipmentForm());

    const deptSel = document.getElementById('eq-filter-department');
    if (deptSel) deptSel.addEventListener('change', (e) => { eqFilters.department = e.target.value; resetPage(); renderEquipmentList(); });
    const supplierInput = document.getElementById('eq-filter-supplier');
    if (supplierInput) supplierInput.addEventListener('input', (e) => { eqFilters.supplier = e.target.value; resetPage(); renderEquipmentList(); });
    const dateFromInput = document.getElementById('eq-filter-date-from');
    if (dateFromInput) dateFromInput.addEventListener('change', (e) => { eqFilters.dateFrom = e.target.value; resetPage(); renderEquipmentList(); });
    const dateToInput = document.getElementById('eq-filter-date-to');
    if (dateToInput) dateToInput.addEventListener('change', (e) => { eqFilters.dateTo = e.target.value; resetPage(); renderEquipmentList(); });
    const priceMinInput = document.getElementById('eq-filter-price-min');
    if (priceMinInput) priceMinInput.addEventListener('input', (e) => { eqFilters.priceMin = e.target.value; resetPage(); renderEquipmentList(); });
    const priceMaxInput = document.getElementById('eq-filter-price-max');
    if (priceMaxInput) priceMaxInput.addEventListener('input', (e) => { eqFilters.priceMax = e.target.value; resetPage(); renderEquipmentList(); });
    const clearBtn = document.getElementById('eq-filter-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      eqFilters = { ...eqFilters, department: '', supplier: '', dateFrom: '', dateTo: '', priceMin: '', priceMax: '' };
      resetPage();
      renderEquipmentList();
    });

    document.querySelectorAll('.table th.sortable').forEach(th => th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (eqSort.field === field) eqSort.dir = eqSort.dir === 'asc' ? 'desc' : 'asc';
      else { eqSort = { field, dir: 'asc' }; }
      renderEquipmentList();
    }));

    document.getElementById('eq-page-prev').addEventListener('click', () => { if (eqPage > 1) { eqPage--; renderEquipmentList(); } });
    document.getElementById('eq-page-next').addEventListener('click', () => { if (eqPage < totalPages) { eqPage++; renderEquipmentList(); } });

    const selectAll = document.getElementById('eq-select-all');
    selectAll.addEventListener('click', () => {
      if (selectAll.checked) pageItems.forEach(e => eqSelected.add(e.id));
      else pageItems.forEach(e => eqSelected.delete(e.id));
      renderEquipmentList();
    });
    root.querySelectorAll('.eq-row-check').forEach(cb => cb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cb.checked) eqSelected.add(cb.dataset.id); else eqSelected.delete(cb.dataset.id);
      renderEquipmentList();
    }));

    const bulkExportBtn = document.getElementById('bulk-export');
    if (bulkExportBtn) bulkExportBtn.addEventListener('click', () => {
      const items = all.filter(e => eqSelected.has(e.id));
      EPM.reports.exportEquipmentCSV(items);
      toast(`已匯出 ${items.length} 筆選取設備 CSV`);
    });
    const bulkStatusSel = document.getElementById('bulk-status');
    if (bulkStatusSel) bulkStatusSel.addEventListener('change', (e) => {
      const status = e.target.value;
      if (!status) return;
      if (confirmAction(`確定要將選取的 ${eqSelected.size} 筆設備狀態變更為「${STATUS_LABEL[status]}」嗎？`)) {
        eqSelected.forEach(id => EPM.equipment.update(id, { status }));
        toast('已批次變更狀態');
        eqSelected.clear();
        renderEquipmentList();
      } else {
        e.target.value = '';
      }
    });
    const bulkDeleteBtn = document.getElementById('bulk-delete');
    if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', () => {
      if (confirmAction(`確定要刪除選取的 ${eqSelected.size} 筆設備嗎？相關更換紀錄與報價也會一併刪除，此操作無法復原。`)) {
        eqSelected.forEach(id => EPM.equipment.remove(id));
        toast('已批次刪除設備');
        eqSelected.clear();
        renderEquipmentList();
      }
    });
    const bulkClearBtn = document.getElementById('bulk-clear');
    if (bulkClearBtn) bulkClearBtn.addEventListener('click', () => { eqSelected.clear(); renderEquipmentList(); });

    root.querySelectorAll('[data-nav]').forEach(row => row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions') || e.target.closest('.checkbox-cell')) return;
      navigate(row.dataset.nav.replace('#', ''));
    }));
    root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openEquipmentForm(EPM.equipment.get(b.dataset.edit)); }));
    root.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const eq = EPM.equipment.get(b.dataset.delete);
      if (confirmAction(`確定要刪除設備「${eq.name}」嗎？相關更換紀錄與報價也會一併刪除，此操作無法復原。`)) {
        EPM.equipment.remove(b.dataset.delete);
        eqSelected.delete(b.dataset.delete);
        toast('已刪除設備');
        renderEquipmentList();
      }
    }));
  }

  function openColumnPickerModal() {
    const current = getEqColumns();
    const html = `
      <div class="modal-header"><h3>自訂顯示欄位</h3><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="modal-body">
        <div class="form" style="gap:8px;">
          ${EQ_COLUMNS.map(col => `
            <label class="checkbox-field">
              <input type="checkbox" data-col="${col.key}" ${current.includes(col.key) ? 'checked' : ''} />
              <span>${esc(col.label)}</span>
            </label>`).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" id="col-reset-btn">還原預設</button>
        <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
        <button type="button" class="btn btn-primary" id="col-save-btn">儲存</button>
      </div>`;
    openModal(html, {
      onMount: (modalEl) => {
        modalEl.querySelector('#col-reset-btn').addEventListener('click', () => {
          saveEqColumns(EQ_COLUMNS.filter(c => c.default).map(c => c.key));
          closeModal();
          renderEquipmentList();
        });
        modalEl.querySelector('#col-save-btn').addEventListener('click', () => {
          const keys = Array.from(modalEl.querySelectorAll('[data-col]:checked')).map(el => el.dataset.col);
          saveEqColumns(keys.length ? keys : EQ_COLUMNS.filter(c => c.default).map(c => c.key));
          closeModal();
          renderEquipmentList();
        });
      }
    });
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
        <label class="field"><span>設備照片</span><div id="eq-photo-picker"></div></label>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
          <button type="submit" class="btn btn-primary">${isEdit ? '儲存變更' : '新增設備'}</button>
        </div>
      </form>`;
    const pendingPhotos = (existing?.photos || []).slice();
    openModal(html, {
      onMount: (modalEl) => {
        EPM.photos.mountPicker(modalEl.querySelector('#eq-photo-picker'), pendingPhotos);
        document.getElementById('eq-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          data.photos = pendingPhotos;
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
        ${(eq.photos && eq.photos.length) ? `
          <div class="detail-notes">
            <span class="detail-label">設備照片</span>
            <div class="photo-grid photo-grid-view">
              ${eq.photos.map((src, i) => `<div class="photo-thumb" data-view-eq-photo="${i}"><img src="${src}" alt="設備照片 ${i + 1}" /></div>`).join('')}
            </div>
          </div>` : ''}
      </div>

      <div class="card">
        <div class="card-header"><h3>更換紀錄</h3><button class="btn btn-sm btn-primary" id="add-replacement-btn">＋ 新增更換紀錄</button></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>日期</th><th>原因</th><th>成本</th><th>廠商</th><th>經辦人</th><th>照片</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
            <tbody>
              ${replacements.length ? replacements.map(r => `
                <tr>
                  <td class="mono" data-label="日期">${fmtDate(r.replaceDate)}</td>
                  <td data-label="原因">${esc(r.reason || '—')}</td>
                  <td class="mono" data-label="成本">${fmtMoney(r.cost)}</td>
                  <td data-label="廠商">${esc(r.vendor || '—')}</td>
                  <td data-label="經辦人">${esc(r.operator || '—')}</td>
                  <td data-label="照片">${EPM.photos.thumbRowHtml(r.photos, r.id)}</td>
                  ${isAdmin ? `<td class="row-actions"><button class="btn btn-sm btn-ghost btn-danger" data-del-rep="${r.id}">刪除</button></td>` : ''}
                </tr>`).join('') : `<tr><td colspan="${isAdmin ? 7 : 6}" class="empty-cell">尚無更換紀錄</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>廠商報價</h3><button class="btn btn-sm btn-primary" id="add-quote-btn">＋ 新增報價</button></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>項目</th><th>廠商</th><th>報價</th><th>報價日期</th><th>有效期限</th><th>照片</th><th>狀態</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
            <tbody>
              ${quotes.length ? quotes.map((q, i) => `
                <tr class="${q.selected ? 'row-selected' : ''}">
                  <td data-label="項目">${esc(q.itemName)}</td>
                  <td data-label="廠商">${esc(q.vendor)}</td>
                  <td class="mono ${i === 0 ? 'text-good' : ''}" data-label="報價">${fmtMoney(q.price)}</td>
                  <td class="mono" data-label="報價日期">${fmtDate(q.quoteDate)}</td>
                  <td class="mono" data-label="有效期限">${fmtDate(q.validUntil)}</td>
                  <td data-label="照片">${EPM.photos.thumbRowHtml(q.photos, q.id)}</td>
                  <td data-label="狀態">${q.selected ? '<span class="badge badge-good">已選定</span>' : (isAdmin ? `<button class="btn btn-sm btn-ghost" data-select-quote="${q.id}">選定</button>` : '—')}</td>
                  ${isAdmin ? `<td class="row-actions"><button class="btn btn-sm btn-ghost btn-danger" data-del-quote="${q.id}">刪除</button></td>` : ''}
                </tr>`).join('') : `<tr><td colspan="${isAdmin ? 8 : 7}" class="empty-cell">尚無報價紀錄</td></tr>`}
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
    root.querySelectorAll('[data-view-eq-photo]').forEach(el => el.addEventListener('click', () => {
      EPM.photos.openLightbox(eq.photos, Number(el.dataset.viewEqPhoto));
    }));
    root.querySelectorAll('[data-open-photos]').forEach(el => el.addEventListener('click', () => {
      const rid = el.dataset.openPhotos;
      const rec = replacements.find(r => r.id === rid) || quotes.find(q => q.id === rid);
      if (rec) EPM.photos.openLightbox(rec.photos, 0);
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
        <label class="field"><span>照片</span><div id="rep-photo-picker"></div></label>
        <label class="checkbox-field"><input type="checkbox" name="markRetired" checked /> 同步將此設備狀態標記為「已汰換」</label>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
          <button type="submit" class="btn btn-primary">新增紀錄</button>
        </div>
      </form>`;
    const pendingPhotos = [];
    openModal(html, {
      onMount: (modalEl) => {
        EPM.photos.mountPicker(modalEl.querySelector('#rep-photo-picker'), pendingPhotos);
        document.getElementById('rep-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const data = Object.fromEntries(fd.entries());
          data.equipmentId = eq.id;
          data.markRetired = fd.get('markRetired') === 'on';
          data.photos = pendingPhotos;
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
        <label class="field"><span>報價單／照片</span><div id="quote-photo-picker"></div></label>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
          <button type="submit" class="btn btn-primary">新增報價</button>
        </div>
      </form>`;
    const pendingPhotos = [];
    openModal(html, {
      onMount: (modalEl) => {
        EPM.photos.mountPicker(modalEl.querySelector('#quote-photo-picker'), pendingPhotos);
        document.getElementById('quote-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          data.equipmentId = eq.id;
          data.photos = pendingPhotos;
          EPM.pricing.addQuote(data);
          closeModal();
          toast('已新增報價');
          if (parseHash().route === 'pricing') renderPricing(); else renderEquipmentDetail(eq.id);
        });
      }
    });
  }

  /* ---------- pricing view ---------- */
  let pricingFilters = { search: '', status: '' };
  // Keys whose expand/collapse state differs from the default (pending items
  // default open, decided items default collapsed) — see renderPricing().
  let pricingToggled = new Set();

  function pricingSavings(groups) {
    return groups.reduce((sum, g) => {
      if (g.quotes.length < 2) return sum;
      return sum + (g.quotes[g.quotes.length - 1].price - g.quotes[0].price);
    }, 0);
  }

  function renderPricing() {
    const isAdmin = EPM.auth.isAdmin();
    const groups = EPM.pricing.groupedByItem();
    const qd = EPM.reports.quoteDecisionSummary();
    const savings = pricingSavings(groups);

    const search = pricingFilters.search.toLowerCase();
    const filteredGroups = groups.filter(g => {
      const eq = EPM.equipment.get(g.equipmentId);
      const decided = g.quotes.some(q => q.selected);
      if (pricingFilters.status === 'pending' && decided) return false;
      if (pricingFilters.status === 'decided' && !decided) return false;
      if (search) {
        const hay = (g.itemName + ' ' + (eq ? eq.name : '') + ' ' + g.quotes.map(q => q.vendor).join(' ')).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const html = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">報價項目數</div>
          <div class="stat-value">${qd.totalItems}</div>
          <div class="stat-sub">個比價項目</div>
        </div>
        <div class="stat-card ${qd.pending ? 'stat-warn' : ''}">
          <div class="stat-label">待決策</div>
          <div class="stat-value">${qd.pending}</div>
          <div class="stat-sub">尚未選定廠商</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已決定</div>
          <div class="stat-value">${qd.decided}</div>
          <div class="stat-sub">已選定廠商</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">可節省金額</div>
          <div class="stat-value">${fmtMoney(savings)}</div>
          <div class="stat-sub">各項目最高與最低報價差額加總</div>
        </div>
      </div>

      <div class="toolbar">
        <input type="text" class="input" id="pr-search" placeholder="搜尋項目名稱、廠商或設備…" value="${esc(pricingFilters.search)}" />
        <select class="input" id="pr-filter-status">
          <option value="">全部項目</option>
          <option value="pending" ${pricingFilters.status === 'pending' ? 'selected' : ''}>待決策</option>
          <option value="decided" ${pricingFilters.status === 'decided' ? 'selected' : ''}>已決定</option>
        </select>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" id="quotes-export">匯出 CSV</button>
      </div>
      ${filteredGroups.length ? filteredGroups.map(g => {
        const eq = EPM.equipment.get(g.equipmentId);
        const decided = g.quotes.some(q => q.selected);
        const defaultExpanded = !decided;
        const expanded = pricingToggled.has(g.key) ? !defaultExpanded : defaultExpanded;
        return `
        <div class="card">
          <div class="card-header pricing-group-header" data-toggle-group="${esc(g.key)}">
            <h3>
              <span class="collapse-arrow">${expanded ? '▾' : '▸'}</span>
              ${esc(g.itemName)} <span class="muted">— ${esc(eq ? eq.name : '')}</span>
              ${decided ? '<span class="badge badge-good" style="margin-left:8px;">已決定</span>' : '<span class="badge badge-warn" style="margin-left:8px;">待決策</span>'}
            </h3>
            <button class="btn btn-sm btn-ghost" data-add-quote="${g.equipmentId}" data-item="${esc(g.itemName)}">＋ 新增報價</button>
          </div>
          ${expanded ? `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>廠商</th><th>報價</th><th>報價日期</th><th>有效期限</th><th>聯絡方式</th><th>照片</th><th>狀態</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
              <tbody>
                ${g.quotes.map((q, i) => `
                  <tr class="${q.selected ? 'row-selected' : ''}">
                    <td data-label="廠商">${esc(q.vendor)}</td>
                    <td class="mono ${i === 0 ? 'text-good' : ''}" data-label="報價">${fmtMoney(q.price)}</td>
                    <td class="mono" data-label="報價日期">${fmtDate(q.quoteDate)}</td>
                    <td class="mono" data-label="有效期限">${fmtDate(q.validUntil)}</td>
                    <td data-label="聯絡方式">${esc(q.contact || '—')}</td>
                    <td data-label="照片">${EPM.photos.thumbRowHtml(q.photos, q.id)}</td>
                    <td data-label="狀態">${q.selected ? '<span class="badge badge-good">已選定</span>' : (isAdmin ? `<button class="btn btn-sm btn-ghost" data-select-quote="${q.id}">選定</button>` : '—')}</td>
                    ${isAdmin ? `<td class="row-actions"><button class="btn btn-sm btn-ghost btn-danger" data-del-quote="${q.id}">刪除</button></td>` : ''}
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
        </div>`;
      }).join('') : `<div class="card"><div class="empty-cell">找不到符合條件的報價項目</div></div>`}`;

    renderShell('pricing', html);
    document.getElementById('pr-search').addEventListener('input', (e) => { pricingFilters.search = e.target.value; renderPricing(); });
    document.getElementById('pr-filter-status').addEventListener('change', (e) => { pricingFilters.status = e.target.value; renderPricing(); });
    document.getElementById('quotes-export').addEventListener('click', () => { EPM.reports.exportQuotesCSV(); toast('已匯出報價紀錄 CSV'); });
    root.querySelectorAll('[data-toggle-group]').forEach(header => header.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-quote]')) return;
      const key = header.dataset.toggleGroup;
      if (pricingToggled.has(key)) pricingToggled.delete(key); else pricingToggled.add(key);
      renderPricing();
    }));
    root.querySelectorAll('[data-add-quote]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const eq = EPM.equipment.get(b.dataset.addQuote);
      if (eq) openQuoteForm(eq, b.dataset.item);
    }));
    root.querySelectorAll('[data-select-quote]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); EPM.pricing.selectVendor(b.dataset.selectQuote); toast('已選定廠商'); renderPricing(); }));
    root.querySelectorAll('[data-open-photos]').forEach(el => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const q = EPM.pricing.list().find(q => q.id === el.dataset.openPhotos);
      if (q) EPM.photos.openLightbox(q.photos, 0);
    }));
    root.querySelectorAll('[data-del-quote]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirmAction('確定要刪除這筆報價嗎？')) { EPM.pricing.removeQuote(b.dataset.delQuote); toast('已刪除報價'); renderPricing(); }
    }));
  }

  /* ---------- reports view ---------- */
  let reportsRangePreset = 'all';
  let reportsRangeCustom = { start: '', end: '' };
  let reportsCostGroupBy = 'department';

  function getReportsRange() {
    if (reportsRangePreset === 'custom') {
      if (!reportsRangeCustom.start || !reportsRangeCustom.end) return null;
      const start = new Date(reportsRangeCustom.start).getTime();
      const end = new Date(reportsRangeCustom.end + 'T23:59:59.999').getTime();
      if (isNaN(start) || isNaN(end) || start > end) return null;
      return { start, end };
    }
    return EPM.reports.presetRange(reportsRangePreset);
  }
  function reportsRangeLabel(range) {
    if (reportsRangePreset === 'custom') return range ? '自訂區間' : '自訂區間（請選擇日期）';
    return { all: '全部期間', month: '本月', quarter: '本季', year: '本年' }[reportsRangePreset] || '全部期間';
  }

  function renderReports() {
    const range = getReportsRange();
    const groups = EPM.pricing.groupedByItem();
    const costCmp = EPM.reports.costComparison(range);
    const costAnalysis = EPM.reports.costAnalysisByGroup(reportsCostGroupBy, range);
    const warranty = EPM.reports.warrantyAnalysis();
    const warrantyDue = warranty.items.filter(e => e.daysLeft <= 90);

    const deltaHtml = costCmp.deltaPct === null ? '' : `
      <span class="${costCmp.deltaPct > 0 ? 'text-crit' : costCmp.deltaPct < 0 ? 'text-good' : ''}" style="font-size:12px;font-weight:700;">
        ${costCmp.deltaPct === 0 ? '與上期持平' : (costCmp.deltaPct > 0 ? '▲' : '▼') + Math.abs(Math.round(costCmp.deltaPct)) + '% 較上期'}
      </span>`;

    const html = `
      <div class="toolbar">
        <div class="range-btn-group">
          ${['all', 'month', 'quarter', 'year', 'custom'].map(p => `
            <button type="button" class="range-btn ${reportsRangePreset === p ? 'active' : ''}" data-rp-range="${p}">${{ all: '全部', month: '本月', quarter: '本季', year: '本年', custom: '自訂' }[p]}</button>`).join('')}
        </div>
        ${reportsRangePreset === 'custom' ? `
          <input type="date" class="input" id="rp-range-start" value="${esc(reportsRangeCustom.start)}" />
          <span class="muted">至</span>
          <input type="date" class="input" id="rp-range-end" value="${esc(reportsRangeCustom.end)}" />
        ` : ''}
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" id="export-eq">匯出設備清單</button>
        <button class="btn btn-ghost" id="export-rep">匯出更換紀錄</button>
        <button class="btn btn-ghost" id="export-quote">匯出報價紀錄</button>
        <button class="btn btn-primary" id="print-report">🖨️ 產生報表 PDF</button>
      </div>

      <div class="print-report-header">
        <div>EquipPro 設備管理報表</div>
        <div class="muted">報表期間：${esc(reportsRangeLabel(range))}　產生時間：${new Date().toLocaleString('zh-TW')}</div>
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
        <div class="card-header"><h3>更換成本趨勢（${esc(reportsRangeLabel(range))}）</h3>${deltaHtml}</div>
        <div class="chart-box chart-box-wide"><canvas id="r-chart-trend"></canvas></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>${reportsCostGroupBy === 'department' ? '部門別' : '類別別'}成本分析</h3>
          <div class="card-header-actions">
            <button type="button" class="btn btn-sm ${reportsCostGroupBy === 'department' ? 'btn-primary' : 'btn-ghost'}" data-cost-groupby="department">依部門</button>
            <button type="button" class="btn btn-sm ${reportsCostGroupBy === 'category' ? 'btn-primary' : 'btn-ghost'}" data-cost-groupby="category">依類別</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>${reportsCostGroupBy === 'department' ? '部門' : '類別'}</th><th>設備數量</th><th>採購金額累計</th><th>期間更換成本</th><th>平均使用年限</th></tr></thead>
            <tbody>
              ${costAnalysis.length ? costAnalysis.map(g => `
                <tr>
                  <td data-label="${reportsCostGroupBy === 'department' ? '部門' : '類別'}">${esc(g.key)}</td>
                  <td class="mono" data-label="設備數量">${g.count}</td>
                  <td class="mono" data-label="採購金額累計">${fmtMoney(g.purchaseValue)}</td>
                  <td class="mono" data-label="期間更換成本">${fmtMoney(g.replaceCost)}</td>
                  <td class="mono" data-label="平均使用年限">${g.avgLifespan ? g.avgLifespan.toFixed(1) + ' 年' : '—'}</td>
                </tr>`).join('') : `<tr><td colspan="5" class="empty-cell">尚無資料</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3>廠商採購金額分布（${esc(reportsRangeLabel(range))}）</h3></div>
          <div class="chart-box chart-box-wide"><canvas id="r-chart-vendor-spend"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>保固到期分析</h3></div>
          <div class="chart-box"><canvas id="r-chart-warranty"></canvas></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>即將到期／已過保固設備</h3></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>設備</th><th>部門</th><th>保固到期日</th><th>狀態</th></tr></thead>
            <tbody>
              ${warrantyDue.length ? warrantyDue.map(e => `
                <tr class="row-link" data-nav="#/equipment/${e.id}">
                  <td data-label="設備">${esc(e.name)}</td>
                  <td data-label="部門">${esc(e.department || '—')}</td>
                  <td class="mono" data-label="保固到期日">${fmtDate(new Date(e.warrantyEnd).toISOString().slice(0, 10))}</td>
                  <td data-label="狀態" class="${e.daysLeft < 0 ? 'text-crit' : 'text-warn'}">${e.daysLeft < 0 ? `已過保固 ${Math.abs(e.daysLeft)} 天` : `${e.daysLeft} 天內到期`}</td>
                </tr>`).join('') : `<tr><td colspan="4" class="empty-cell">目前沒有即將到期或已過保固的設備</td></tr>`}
            </tbody>
          </table>
        </div>
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
    EPM.reports.renderCostTrendChart('r-chart-trend', range);
    EPM.reports.renderVendorSpendChart('r-chart-vendor-spend', range);
    EPM.reports.renderWarrantyChart('r-chart-warranty');
    if (groups.length) {
      document.getElementById('r-item-select').value = groups[0].key;
      EPM.reports.renderVendorCompareChart('r-chart-vendor', groups[0]);
    }
    document.getElementById('r-item-select').addEventListener('change', (e) => {
      const g = groups.find(g => g.key === e.target.value);
      EPM.reports.renderVendorCompareChart('r-chart-vendor', g);
    });

    document.querySelectorAll('[data-rp-range]').forEach(btn => btn.addEventListener('click', () => { reportsRangePreset = btn.dataset.rpRange; renderReports(); }));
    const rpStart = document.getElementById('rp-range-start');
    const rpEnd = document.getElementById('rp-range-end');
    if (rpStart) rpStart.addEventListener('change', (e) => { reportsRangeCustom.start = e.target.value; renderReports(); });
    if (rpEnd) rpEnd.addEventListener('change', (e) => { reportsRangeCustom.end = e.target.value; renderReports(); });
    document.querySelectorAll('[data-cost-groupby]').forEach(btn => btn.addEventListener('click', () => { reportsCostGroupBy = btn.dataset.costGroupby; renderReports(); }));
    root.querySelectorAll('[data-nav]').forEach(row => row.addEventListener('click', () => navigate(row.dataset.nav.replace('#', ''))));

    document.getElementById('export-eq').addEventListener('click', () => { EPM.reports.exportEquipmentCSV(); toast('已匯出設備清單 CSV'); });
    document.getElementById('export-rep').addEventListener('click', () => { EPM.reports.exportReplacementsCSV(); toast('已匯出更換紀錄 CSV'); });
    document.getElementById('export-quote').addEventListener('click', () => { EPM.reports.exportQuotesCSV(); toast('已匯出報價紀錄 CSV'); });
    document.getElementById('print-report').addEventListener('click', () => window.print());
  }

  /* ---------- users view (admin only) ---------- */
  let userFilters = { search: '', role: '', status: '' };
  let userSelected = new Set();

  function userIsLocked(u) { return !!(u.lockedUntil && Date.now() < u.lockedUntil); }

  function renderUsers() {
    if (!EPM.auth.isAdmin()) { navigate('/dashboard'); return; }
    const all = EPM.auth.getUsers();
    const me = EPM.auth.getCurrentUser();

    const filtered = all.filter(u => {
      const locked = userIsLocked(u);
      if (userFilters.role && u.role !== userFilters.role) return false;
      if (userFilters.status === 'active' && !u.active) return false;
      if (userFilters.status === 'disabled' && u.active) return false;
      if (userFilters.status === 'locked' && !locked) return false;
      if (userFilters.search) {
        const q = userFilters.search.toLowerCase();
        if (!(u.username.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });

    const html = `
      <div class="toolbar">
        <input type="text" class="input" id="user-search" placeholder="搜尋帳號或姓名…" value="${esc(userFilters.search)}" />
        <select class="input" id="user-filter-role">
          <option value="">全部角色</option>
          <option value="admin" ${userFilters.role === 'admin' ? 'selected' : ''}>管理員</option>
          <option value="staff" ${userFilters.role === 'staff' ? 'selected' : ''}>一般人員</option>
        </select>
        <select class="input" id="user-filter-status">
          <option value="">全部狀態</option>
          <option value="active" ${userFilters.status === 'active' ? 'selected' : ''}>啟用中</option>
          <option value="disabled" ${userFilters.status === 'disabled' ? 'selected' : ''}>已停用</option>
          <option value="locked" ${userFilters.status === 'locked' ? 'selected' : ''}>已鎖定</option>
        </select>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" id="user-export">匯出 CSV</button>
        <button class="btn btn-primary" id="add-user-btn">＋ 新增使用者</button>
      </div>

      ${userSelected.size ? `
      <div class="bulk-bar">
        <strong>已選取 ${userSelected.size} 筆</strong>
        <button class="btn btn-sm btn-ghost" id="bulk-enable">批次啟用</button>
        <button class="btn btn-sm btn-ghost btn-danger" id="bulk-disable">批次停用</button>
        <button class="btn btn-sm btn-ghost" id="bulk-clear">取消選取</button>
      </div>` : ''}

      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th class="checkbox-cell"><input type="checkbox" id="user-select-all" ${filtered.length && filtered.every(u => userSelected.has(u.id)) ? 'checked' : ''} /></th>
              <th>帳號</th><th>姓名</th><th>角色</th><th>狀態</th><th>最後登入</th><th>建立時間</th><th></th>
            </tr></thead>
            <tbody>
              ${filtered.length ? filtered.map(u => {
                const locked = userIsLocked(u);
                return `
                <tr>
                  <td class="checkbox-cell" data-label=""><input type="checkbox" class="user-row-check" data-id="${u.id}" ${userSelected.has(u.id) ? 'checked' : ''} /></td>
                  <td class="mono" data-label="帳號">${esc(u.username)}</td>
                  <td data-label="姓名">${esc(u.name)}</td>
                  <td data-label="角色">${u.role === 'admin' ? '<span class="badge badge-good">管理員</span>' : '<span class="badge badge-muted">一般人員</span>'}</td>
                  <td data-label="狀態">${locked ? '<span class="badge badge-crit">🔒 已鎖定</span>' : (u.active ? '<span class="badge badge-good">啟用中</span>' : '<span class="badge badge-crit">已停用</span>')}</td>
                  <td class="mono" data-label="最後登入">${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-TW') : '從未登入'}</td>
                  <td class="mono" data-label="建立時間">${new Date(u.createdAt).toLocaleDateString('zh-TW')}</td>
                  <td class="row-actions">
                    <button class="btn btn-sm btn-ghost" data-audit-user="${u.id}">紀錄</button>
                    <button class="btn btn-sm btn-ghost" data-edit-user="${u.id}">編輯</button>
                    ${locked ? `<button class="btn btn-sm btn-ghost" data-unlock-user="${u.id}">解鎖</button>` : ''}
                    <button class="btn btn-sm btn-ghost" data-toggle-user="${u.id}">${u.active ? '停用' : '啟用'}</button>
                    ${u.id !== me.id ? `<button class="btn btn-sm btn-ghost btn-danger" data-del-user="${u.id}">刪除</button>` : ''}
                  </td>
                </tr>`;
              }).join('') : `<tr><td colspan="8" class="empty-cell">找不到符合條件的使用者</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    renderShell('users', html);

    document.getElementById('user-search').addEventListener('input', (e) => { userFilters.search = e.target.value; renderUsers(); });
    document.getElementById('user-filter-role').addEventListener('change', (e) => { userFilters.role = e.target.value; renderUsers(); });
    document.getElementById('user-filter-status').addEventListener('change', (e) => { userFilters.status = e.target.value; renderUsers(); });
    document.getElementById('user-export').addEventListener('click', () => { EPM.reports.exportUsersCSV(filtered); toast(`已匯出 ${filtered.length} 筆使用者清單 CSV`); });
    document.getElementById('add-user-btn').addEventListener('click', () => openUserForm());

    const selectAll = document.getElementById('user-select-all');
    selectAll.addEventListener('click', () => {
      if (selectAll.checked) filtered.forEach(u => userSelected.add(u.id));
      else filtered.forEach(u => userSelected.delete(u.id));
      renderUsers();
    });
    root.querySelectorAll('.user-row-check').forEach(cb => cb.addEventListener('click', () => {
      if (cb.checked) userSelected.add(cb.dataset.id); else userSelected.delete(cb.dataset.id);
      renderUsers();
    }));

    const bulkEnableBtn = document.getElementById('bulk-enable');
    if (bulkEnableBtn) bulkEnableBtn.addEventListener('click', () => {
      let ok = 0;
      userSelected.forEach(id => { if (EPM.auth.updateUser(id, { active: true }).ok) ok++; });
      toast(`已啟用 ${ok} 筆帳號`);
      userSelected.clear();
      renderUsers();
    });
    const bulkDisableBtn = document.getElementById('bulk-disable');
    if (bulkDisableBtn) bulkDisableBtn.addEventListener('click', () => {
      if (!confirmAction(`確定要停用選取的 ${userSelected.size} 筆帳號嗎？`)) return;
      let ok = 0, blocked = 0;
      userSelected.forEach(id => { if (EPM.auth.updateUser(id, { active: false }).ok) ok++; else blocked++; });
      toast(blocked ? `已停用 ${ok} 筆，${blocked} 筆因須保留至少一位啟用中管理員而略過` : `已停用 ${ok} 筆帳號`);
      userSelected.clear();
      renderUsers();
    });
    const bulkClearBtn = document.getElementById('bulk-clear');
    if (bulkClearBtn) bulkClearBtn.addEventListener('click', () => { userSelected.clear(); renderUsers(); });

    root.querySelectorAll('[data-audit-user]').forEach(b => b.addEventListener('click', () => openUserAuditModal(all.find(u => u.id === b.dataset.auditUser))));
    root.querySelectorAll('[data-edit-user]').forEach(b => b.addEventListener('click', () => openUserForm(all.find(u => u.id === b.dataset.editUser))));
    root.querySelectorAll('[data-unlock-user]').forEach(b => b.addEventListener('click', () => {
      const result = EPM.auth.unlockUser(b.dataset.unlockUser);
      if (!result.ok) toast(result.message, 'error'); else toast('已解除帳號鎖定');
      renderUsers();
    }));
    root.querySelectorAll('[data-toggle-user]').forEach(b => b.addEventListener('click', () => {
      const u = all.find(u => u.id === b.dataset.toggleUser);
      const result = EPM.auth.updateUser(u.id, { active: !u.active });
      if (!result.ok) toast(result.message, 'error'); else toast(u.active ? '已停用帳號' : '已啟用帳號');
      renderUsers();
    }));
    root.querySelectorAll('[data-del-user]').forEach(b => b.addEventListener('click', () => {
      if (confirmAction('確定要刪除此使用者嗎？')) {
        const result = EPM.auth.deleteUser(b.dataset.delUser);
        if (!result.ok) toast(result.message, 'error'); else toast('已刪除使用者');
        userSelected.delete(b.dataset.delUser);
        renderUsers();
      }
    }));
  }

  function openUserAuditModal(user) {
    if (!user) return;
    const activity = S.read(S.KEYS.activity, []).filter(a => a.userId === user.id).slice(0, 100);
    const html = `
      <div class="modal-header"><h3>${esc(user.name)}（${esc(user.username)}）活動紀錄</h3><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="modal-body">
        <ul class="activity-list" style="max-height:60vh;">
          ${activity.length ? activity.map(a => `
            <li>
              <div class="activity-main">${esc(a.action)}${a.target && a.target !== '-' ? ' · ' + esc(a.target) : ''}${a.detail && a.detail !== '-' ? '（' + esc(a.detail) + '）' : ''}</div>
              <div class="activity-time">${new Date(a.timestamp).toLocaleString('zh-TW')}</div>
            </li>`).join('') : '<li class="empty-cell">尚無活動紀錄</li>'}
        </ul>
      </div>
      <div class="modal-footer"><button type="button" class="btn btn-ghost" data-close-modal>關閉</button></div>`;
    openModal(html);
  }

  function openUserForm(existing) {
    const isEdit = !!existing;
    const modules = existing?.modules || EPM.auth.DEFAULT_MODULES;
    const html = `
      <div class="modal-header"><h3>${isEdit ? '編輯使用者' : '新增使用者'}</h3><button class="icon-btn" data-close-modal>✕</button></div>
      <form id="user-form" class="form modal-body">
        <label class="field"><span>帳號 *</span><input type="text" name="username" required value="${esc(existing?.username)}" ${isEdit ? 'disabled' : ''} /></label>
        <label class="field"><span>姓名</span><input type="text" name="name" value="${esc(existing?.name)}" /></label>
        <label class="field"><span>${isEdit ? '重設密碼（留空則不變更）' : '密碼 *'}</span><input type="password" name="password" ${isEdit ? '' : 'required'} /></label>
        <label class="field"><span>角色</span>
          <select name="role" id="user-form-role">
            <option value="staff" ${(existing?.role || 'staff') === 'staff' ? 'selected' : ''}>一般人員</option>
            <option value="admin" ${existing?.role === 'admin' ? 'selected' : ''}>管理員</option>
          </select>
        </label>
        <div class="field" id="user-form-modules" style="${existing?.role === 'admin' ? 'display:none;' : ''}">
          <span>可存取的功能模組（僅適用於一般人員，管理員永遠擁有完整權限）</span>
          <div class="form" style="gap:6px;">
            ${EPM.auth.MODULES.map(m => `
              <label class="checkbox-field">
                <input type="checkbox" name="modules" value="${m.key}" ${modules.includes(m.key) ? 'checked' : ''} />
                <span>${esc(m.label)}</span>
              </label>`).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" data-close-modal>取消</button>
          <button type="submit" class="btn btn-primary">${isEdit ? '儲存變更' : '新增使用者'}</button>
        </div>
      </form>`;
    openModal(html, {
      onMount: (modalEl) => {
        const roleSelect = modalEl.querySelector('#user-form-role');
        const modulesField = modalEl.querySelector('#user-form-modules');
        roleSelect.addEventListener('change', () => {
          modulesField.style.display = roleSelect.value === 'admin' ? 'none' : '';
        });
        document.getElementById('user-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const data = Object.fromEntries(fd.entries());
          data.modules = fd.getAll('modules');
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
      title: '儀表板',
      items: [
        { icon: '📊', name: '儀表板總覽', desc: '即時掌握總設備數、總資產價值、待汰換提醒與累計更換成本，並以圖表呈現狀態分布、類別統計與成本趨勢。' },
        { icon: '📅', name: '日期區間篩選與同期比較', pro: true, desc: '全部／本月／本季／本年／自訂區間一鍵切換，更換成本卡片自動顯示與上一期間相比的漲跌百分比。' },
        { icon: '📉', name: '資產折舊與淨值估算', pro: true, desc: '依採購金額與預期使用年限自動試算目前帳面淨值與累計折舊金額，並以圖表比較各類別的採購金額與淨值。' },
        { icon: '⏰', name: '分級到期預警＋汰換規劃時間軸', pro: true, desc: '待汰換設備依已逾期／30／60／90 天分級標示，並提供未來 12 個月的汰換數量時間軸，方便提前編列預算。' },
        { icon: '🧩', name: '可自訂儀表板版面', pro: true, desc: '拖曳調整區塊順序、勾選顯示或隱藏區塊，個人化版面設定自動儲存於本機。' }
      ]
    },
    {
      title: '設備清單',
      items: [
        { icon: '🖥️', name: '設備清單與更換紀錄', desc: '新增、編輯、刪除設備資料，記錄採購日期、保固期間、使用年限；每台設備可查詢完整的更換歷史與照片。' },
        { icon: '🔍', name: '進階篩選', pro: true, desc: '除了搜尋與類別／狀態篩選外，可加上部門、供應商、採購日期區間、採購金額區間等多條件組合查詢。' },
        { icon: '☑️', name: '批次操作', pro: true, desc: '多選設備後一次批次刪除、批次變更狀態、或只匯出選取項目的 CSV，大量維護資料時更有效率。' },
        { icon: '↕️', name: '表頭排序＋自訂顯示欄位', pro: true, desc: '點擊欄名即可排序，並可自由勾選要顯示的欄位（如供應商、保固、使用年限），版面設定自動記住。' },
        { icon: '📄', name: '分頁瀏覽', pro: true, desc: '設備數量龐大時自動分頁顯示，維持頁面流暢不卡頓。' }
      ]
    },
    {
      title: '價格管理',
      items: [
        { icon: '💰', name: '報價比較與廠商選定', desc: '依項目分組管理多家廠商報價，自動標示最低價，可選定合作廠商並保留完整報價歷程與聯絡資訊。' },
        { icon: '📌', name: '摘要統計卡片', pro: true, desc: '一頁掌握報價項目數、待決策／已決定數量，以及各項目最高與最低報價差額加總的「可節省金額」。' },
        { icon: '🔎', name: '搜尋篩選＋群組摺疊', pro: true, desc: '依項目名稱、廠商或設備搜尋，並可篩選待決策／已決定；待決策項目預設展開、已決定項目自動收合。' }
      ]
    },
    {
      title: '報表分析',
      items: [
        { icon: '📈', name: '統計報表與圖表分析', desc: '狀態分布、類別數量、成本趨勢、廠商比價等圖表，並可匯出 CSV 或直接列印報表。' },
        { icon: '🏢', name: '部門／類別成本分析表', pro: true, desc: '依部門或類別彙總設備數量、採購金額累計、期間更換成本與平均使用年限，快速找出高成本單位。' },
        { icon: '🏭', name: '廠商採購金額分布', pro: true, desc: '彙總所選期間內各廠商的實際更換支出金額與交易次數，找出主要往來廠商。' },
        { icon: '🛡️', name: '保固到期分析', pro: true, desc: '保固內／已過保固比例圖，加上即將到期或已過保固的設備清單，避免過保才發現故障要自費維修。' },
        { icon: '🖨️', name: '一鍵產生報表 PDF', pro: true, desc: '「產生報表 PDF」按鈕觸發列印或另存 PDF，並自動附上報表期間與產生時間。' }
      ]
    },
    {
      title: '使用者管理',
      items: [
        { icon: '👤', name: '多使用者角色管理', desc: '管理員／一般人員角色區隔，管理員可管理帳號、刪除資料，一般人員可查看與新增。' },
        { icon: '🧭', name: '細緻權限管理', pro: true, desc: '可自訂每位一般人員能存取「設備清單／價格管理／報表分析」哪些功能模組，管理員永遠擁有完整權限。' },
        { icon: '🕵️', name: '使用者活動稽核紀錄', pro: true, desc: '點選使用者即可查看該帳號完整的操作歷程，包含登入、新增、編輯、鎖定等紀錄，滿足稽核需求。' },
        { icon: '🔒', name: '登入失敗鎖定保護', pro: true, desc: '連續輸入錯誤密碼達 5 次即暫時鎖定帳號 15 分鐘，防止暴力破解，管理員可手動提前解鎖。' },
        { icon: '☑️', name: '批次啟用／停用＋最後登入時間', pro: true, desc: '多選使用者一次批次啟用或停用；帳號列表加上「最後登入」時間，方便找出久未使用的帳號。' }
      ]
    },
    {
      title: '系統特色',
      items: [
        { icon: '📝', name: '操作稽核紀錄', desc: '記錄誰在何時新增、編輯或刪除了哪些資料，方便追蹤異動與稽核。' },
        { icon: '📤', name: '資料匯出', desc: '設備清單、更換紀錄、報價紀錄、使用者清單皆可一鍵匯出為相容 Excel 的 CSV 檔案。' },
        { icon: '🌓', name: '深色／淺色主題', desc: '可切換自動、亮色、暗色三種顯示模式，符合不同使用情境與個人偏好。' },
        { icon: '🔐', name: '首次設定精靈', desc: '系統不內建預設帳密，首次啟動會引導建立專屬的管理員帳號，降低憑證外洩風險。' },
        { icon: '💾', name: '免安裝、免伺服器', desc: '純前端網頁應用，資料儲存在瀏覽器本機；可直接開啟使用，也能部署到任何網頁伺服器或 GitHub Pages。' },
        { icon: '🖥️', name: '桌面版資料持久化', pro: true, desc: '桌面版資料儲存於系統 AppData 資料夾，不論日後如何安裝新版本、放在哪個資料夾，資料都不會遺失。' }
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
                <div class="feature-name">${esc(f.name)}${f.pro ? ' <span class="badge badge-good feature-pro-badge">PRO</span>' : ''}</div>
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
    if (!EPM.auth.hasModuleAccess(route)) { navigate('/dashboard'); return; }
    switch (route) {
      case 'equipment': id ? renderEquipmentDetail(id) : renderEquipmentList(); break;
      case 'pricing': renderPricing(); break;
      case 'reports': renderReports(); break;
      case 'users': renderUsers(); break;
      case 'features': renderFeatures(); break;
      case 'dashboard': default: renderDashboard(); break;
    }
  }

  window.EPM.app = { render, navigate, toast, openModal, closeModal };

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    EPM.storage.initPersistence().then(() => {
      EPM.storage.seed();
      applyTheme();
      render();
    });
  });
})();
