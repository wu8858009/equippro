/* 設備管家 — boot: desktop bridge, splash, first-run setup, login, app shell. */
(function () {
  'use strict';
  const SG = window.SG;
  const { util: U, db: DB, ui: UI, auth: Auth } = SG;
  const esc = U.esc;
  const root = () => document.getElementById('app');

  // ------------------------------------------------------------ desktop bridge
  // The exe serves this page from its own local server with ?desktop=1 and
  // keeps data in a file under %APPDATA% (the port changes every launch, so
  // localStorage would not survive).
  async function initDesktop() {
    if (!/[?&]desktop=1/.test(location.search)) return null;
    const token = new URLSearchParams(location.search).get('t') || '';
    const nativeFetch = window.fetch.bind(window);
    const fetch = (url, opts = {}) => nativeFetch(url, Object.assign({}, opts, { headers: Object.assign({ 'X-SG-Token': token }, opts.headers || {}) }));
    try {
      const r = await fetch('/api/db', { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      let pending = null, sending = false;
      const flush = async () => {
        if (sending || pending == null) return;
        sending = true;
        const body = pending; pending = null;
        try { await fetch('/api/db', { method: 'POST', body }); }
        catch (e) { pending = pending == null ? body : pending; }
        sending = false;
        if (pending != null) setTimeout(flush, 300);
      };
      SG.desktop = {
        dataPath: j.path,
        prefs: j.prefs || {},
        save(text) { pending = text; flush(); },
        setPref(k, v) {
          if (v == null) delete this.prefs[k]; else this.prefs[k] = v;
          fetch('/api/prefs', { method: 'POST', body: JSON.stringify(this.prefs) }).catch(() => {});
        },
        async saveFile(name, text) {
          try {
            const res = await fetch('/api/savefile?name=' + encodeURIComponent(name), { method: 'POST', body: text });
            const k = await res.json();
            if (k.ok) UI.toast('已儲存到：' + k.path); else if (!k.cancelled) UI.toast(k.error || '儲存失敗', 'error');
          } catch (e) { UI.toast('儲存失敗', 'error'); }
        }
      };
      window.addEventListener('beforeunload', () => { if (pending != null) navigator.sendBeacon('/api/db?t=' + encodeURIComponent(token), pending); });
      return j.db || null;
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------ splash
  const splashStart = Date.now();
  function hideSplash() {
    const s = document.getElementById('splash');
    if (!s) return;
    const wait = Math.max(0, 1400 - (Date.now() - splashStart));
    setTimeout(() => { s.classList.add('out'); setTimeout(() => s.remove(), 500); }, wait);
  }

  // ------------------------------------------------------------ auth screens
  function authScreen(inner) {
    root().innerHTML = `<div class="auth"><div class="auth-card">
      <div class="auth-logo"><img src="icons/icon-192.png" alt=""><div><h1>設備管家</h1><p>${esc(DB.settings().orgName !== '設備管家' ? DB.settings().orgName : '設備・更換・報價・保養 一次管理')}</p></div></div>
      ${inner}</div></div>`;
  }

  function showSetup() {
    authScreen(`
      <h2>歡迎使用！</h2>
      <p class="muted small">這台裝置還沒有任何資料。請選擇：</p>
      <div class="setup-choice">
        <button class="choice" id="c-new"><span>🆕</span><b>第一次使用</b><small>建立管理員帳號，開始建立設備資料</small></button>
        <button class="choice" id="c-cloud"><span>☁️</span><b>連接現有雲端</b><small>其他裝置已經在用了，輸入同步密碼取回資料</small></button>
      </div>`);
    UI.$('#c-new').onclick = showCreateAdmin;
    UI.$('#c-cloud').onclick = showConnect;
  }

  function showCreateAdmin() {
    authScreen(`
      <h2>建立管理員帳號</h2>
      <form id="f-admin" class="auth-form">
        <label>登入帳號<input name="username" autocomplete="username" placeholder="例如 admin" required></label>
        <label>顯示名稱<input name="name" placeholder="例如 王店長" required></label>
        <label>密碼<input name="password" type="password" autocomplete="new-password" required></label>
        <label>再輸入一次密碼<input name="password2" type="password" autocomplete="new-password" required></label>
        <button class="btn primary block">建立並登入</button>
        <button type="button" class="btn ghost block" id="back">‹ 返回</button>
      </form>`);
    UI.$('#back').onclick = showSetup;
    UI.$('#f-admin').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        if (f.get('password') !== f.get('password2')) throw new Error('兩次輸入的密碼不一樣');
        Auth.createUser({ username: f.get('username'), name: f.get('name'), password: f.get('password'), role: 'admin' });
        Auth.login(f.get('username'), f.get('password'), true);
        SG.log('建立系統', '');
        startApp();
      } catch (err) { UI.toast(err.message, 'error'); }
    };
  }

  function showConnect() {
    const cfg = SG.sync.cfg();
    authScreen(`
      <h2>連接雲端</h2>
      <form id="f-cloud" class="auth-form">
        <label>雲端網址<input name="url" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" required></label>
        <label>同步密碼<input name="key" type="password" autocomplete="off" required></label>
        <p class="small muted">同步密碼由第一次設定雲端的管理員決定，請向管理員詢問。</p>
        <button class="btn primary block" id="go">連線</button>
        <button type="button" class="btn ghost block" id="back">‹ 返回</button>
      </form>`);
    UI.$('#back').onclick = showSetup;
    UI.$('#f-cloud').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = UI.$('#go');
      btn.disabled = true; btn.textContent = '連線中…';
      try {
        const url = String(f.get('url')).trim();
        if (!/^(https:\/\/|http:\/\/127\.0\.0\.1:)/.test(url)) throw new Error('請輸入正確的網址');
        await SG.sync.connect(url, f.get('key'));
        if (Auth.hasUsers()) { UI.toast('已取回雲端資料，請登入'); showLogin(); }
        else { UI.toast('雲端是空的，請建立管理員帳號'); showCreateAdmin(); }
      } catch (err) {
        UI.toast(err.code === 'BADKEY' ? '同步密碼錯誤' : err.message, 'error');
        btn.disabled = false; btn.textContent = '連線';
      }
    };
  }

  function showLogin() {
    authScreen(`
      <h2>登入</h2>
      <form id="f-login" class="auth-form">
        <label>帳號<input name="username" autocomplete="username" required></label>
        <label>密碼<input name="password" type="password" autocomplete="current-password" required></label>
        <label class="check"><input type="checkbox" name="remember" checked> <span>記住我（這台裝置保持登入）</span></label>
        <button class="btn primary block">登入</button>
      </form>
      ${SG.sync.enabled() ? `<p class="small muted center">☁️ 已連線雲端　<a href="#" id="resync">重新同步帳號</a></p>` : ''}`);
    UI.$('#f-login').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { Auth.login(f.get('username'), f.get('password'), !!f.get('remember')); startApp(); }
      catch (err) { UI.toast(err.message, 'error'); }
    };
    const rs = UI.$('#resync');
    if (rs) rs.onclick = async (e) => {
      e.preventDefault();
      try { await SG.sync.syncNow(); UI.toast('已更新'); } catch (err) { UI.toast(err.message, 'error'); }
    };
    if (SG.sync.enabled()) SG.sync.syncNow().catch(() => {});
  }

  // ------------------------------------------------------------ shell
  const NAV = [
    ['#/dash', '🏠', '總覽', '^/dash'],
    ['#/equipment', '🗄️', '設備', '^/(equipment|eq/)'],
    ['#/maint', '🛠️', '保養維修', '^/maint'],
    ['#/quotes', '💰', '報價比價', '^/quotes'],
    ['#/reports', '📊', '統計報表', '^/reports'],
    ['#/vendors', '📇', '廠商', '^/vendors'],
    ['#/labels', '🏷️', 'QR 標籤', '^/labels'],
    ['#/activity', '📜', '操作紀錄', '^/activity'],
    ['#/users', '👥', '帳號管理', '^/users', 'admin'],
    ['#/settings', '⚙️', '設定', '^/settings']
  ];
  const MOBILE_NAV = ['#/dash', '#/equipment', '#/maint', '#/quotes'];

  const shell = (SG.shell = {
    render() {
      const me = Auth.current;
      const items = NAV.filter((n) => !n[4] || Auth.can(n[4]));
      root().innerHTML = `
        <aside class="side">
          <div class="brand"><img src="icons/icon-192.png" alt=""><div><b>設備管家</b><small id="org-name">${esc(DB.settings().orgName)}</small></div></div>
          <nav class="nav">${items.map(([h, i, l, m]) => `<a href="${h}" data-match="${m}"><span>${i}</span>${l}</a>`).join('')}</nav>
          <div class="side-foot"><div class="me">👤 ${esc(me.name)} <small>${esc(Auth.ROLES[me.role])}</small></div><div id="sync-pill"></div></div>
        </aside>
        <header class="topbar">
          <div class="brand"><img src="icons/icon-192.png" alt=""><b>設備管家</b></div>
          <span id="sync-pill-m"></span>
        </header>
        <main id="main"></main>
        <nav class="nav bottom-nav">
          ${items.filter((n) => MOBILE_NAV.includes(n[0])).map(([h, i, l, m]) => `<a href="${h}" data-match="${m}"><span>${i}</span>${l.replace('保養維修', '保養').replace('報價比價', '報價')}</a>`).join('')}
          <a href="#" id="more-btn" data-match="^/(reports|vendors|labels|activity|users|settings)"><span>☰</span>更多</a>
        </nav>`;
      UI.$('#more-btn').onclick = (e) => {
        e.preventDefault();
        const m = UI.modal({
          title: '更多功能',
          body: `<div class="more-grid">${items.filter((n) => !MOBILE_NAV.includes(n[0])).map(([h, i, l]) => `<a href="${h}" class="more-item"><span>${i}</span>${l}</a>`).join('')}</div>
            <p class="small muted center">👤 ${esc(me.name)}（${esc(Auth.ROLES[me.role])}）</p>`
        });
        UI.$$('.more-item', m.body).forEach((a) => a.addEventListener('click', () => m.close()));
      };
      this.syncPill();
    },
    refresh() { const o = UI.$('#org-name'); if (o) o.textContent = DB.settings().orgName; },
    syncPill() {
      const html = SG.sync.enabled() ? `<a href="#/settings" class="sync-pill" title="${esc(SG.sync.message)}">${SG.syncBadge()}</a>` : '';
      ['#sync-pill', '#sync-pill-m'].forEach((s) => { const el = UI.$(s); if (el) el.innerHTML = html; });
    }
  });

  document.addEventListener('sg-sync', () => {
    shell.syncPill();
    const st = UI.$('#s-sync-state'); if (st) st.innerHTML = SG.syncBadge();
  });

  // Re-render the current page when data arrives from the cloud, unless the
  // user is typing in a form.
  const rerender = U.debounce(() => {
    if (!Auth.current || UI.$('.modal-wrap')) return;
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && UI.$('#main').contains(a)) return;
    UI.render();
  }, 300);

  function startApp() {
    shell.render();
    if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/dash';
    UI.render();
    SG.sync.start();
    DB.onChange((c) => { if (c === 'users') { Auth.refresh(); } if (c === 'settings') shell.refresh(); rerender(); });
  }

  // ------------------------------------------------------------ boot
  async function boot() {
    try {
      const desktopDb = await initDesktop();
      DB.load(desktopDb);
      if (!SG.desktop && 'serviceWorker' in navigator && location.protocol === 'https:') {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      }
      if (!Auth.hasUsers()) showSetup();
      else if (Auth.restore()) startApp();
      else showLogin();
    } catch (e) {
      console.error(e);
      root().innerHTML = `<div class="auth"><div class="auth-card"><h2>啟動失敗</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">重新載入</button></div></div>`;
    }
    hideSplash();
  }
  boot();
})();
