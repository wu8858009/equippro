/* 設備管家 — background running & notifications.
   Desktop: the exe keeps running in the system tray (window closed = hidden),
   so this page keeps syncing every minute and shows Windows notifications
   through the tray icon.
   Phone/tablet: notifications through the service worker; on Android an
   installed app also checks the cloud in the background (Periodic Background
   Sync). iPhone/iPad only run the app while it is open (Apple limitation). */
(function () {
  'use strict';
  const SG = window.SG;
  const { util: U, db: DB, ui: UI, auth: Auth, q: Q } = SG;

  const PREFS_KEY = 'sg_bg';       // { tray, notify, autostart } per device
  const STATE_KEY = 'sg_bgstate';  // shared with the service worker on the web

  const N = (SG.notify = {
    prefs() { return Object.assign({ tray: true, notify: true }, SG.store.get(PREFS_KEY) || {}); },
    setPrefs(patch) { SG.store.set(PREFS_KEY, Object.assign(this.prefs(), patch)); this.saveBgConfig(); },

    // ---- capability
    isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
    standalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
    canNotify() { return !!SG.desktop || 'Notification' in window; },
    permission() { return SG.desktop ? 'granted' : ('Notification' in window ? Notification.permission : 'unsupported'); },
    async canPeriodic() {
      try { const reg = await navigator.serviceWorker.ready; return !!reg.periodicSync; } catch (e) { return false; }
    },

    // ---- state (desktop: prefs file; web: IndexedDB so the service worker can use it)
    async state() {
      if (SG.desktop) return SG.store.get(STATE_KEY) || {};
      try { return (await SG.idb.get(STATE_KEY)) || {}; } catch (e) { return SG.store.get(STATE_KEY) || {}; }
    },
    async saveState(s) {
      if (SG.desktop) return SG.store.set(STATE_KEY, s);
      try { await SG.idb.set(STATE_KEY, s); } catch (e) { SG.store.set(STATE_KEY, s); }
    },
    // What the service worker needs to check the cloud on its own.
    async saveBgConfig() {
      if (SG.desktop || !Auth.current) return;
      const c = SG.sync.cfg();
      const s = await this.state();
      Object.assign(s, { url: c.url, key: c.key, rev: DB.data._rev || 0, enabled: !!(c.enabled && this.prefs().notify && this.permission() === 'granted'), me: Auth.current.id });
      await this.saveState(s);
    },

    // ---- turning it on
    async enable() {
      if (SG.desktop) { this.setPrefs({ notify: true }); return true; }
      if (!('Notification' in window)) throw new Error(this.isIOS() && !this.standalone() ? 'iPhone／iPad 請先用 Safari「分享 → 加入主畫面」，從主畫面圖示開啟後才能開啟通知' : '這個瀏覽器不支援通知');
      const p = await Notification.requestPermission();
      if (p !== 'granted') throw new Error('沒有取得通知權限，請到瀏覽器或手機設定允許通知');
      this.setPrefs({ notify: true });
      await this.registerPeriodic();
      return true;
    },
    async registerPeriodic() {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (!reg.periodicSync) return false;
        const st = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null);
        if (st && st.state === 'denied') return false;
        await reg.periodicSync.register('sg-bg', { minInterval: 60 * 60 * 1000 });
        return true;
      } catch (e) { return false; }
    },

    // ---- showing one
    async show(title, body, url = '#/dash', tag) {
      if (!this.prefs().notify) return;
      if (SG.desktop) {
        return SG.desktop.api('/api/notify', { title, body }).catch(() => {});
      }
      if (this.permission() !== 'granted') return;
      const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: tag || undefined, data: { url } };
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) return reg.showNotification(title, opts);
      } catch (e) { /* fall back */ }
      try { const n = new Notification(title, opts); n.onclick = () => { window.focus(); location.hash = url; n.close(); }; } catch (e) { /* ignore */ }
    },
    // Visible and focused: an in-app toast is enough.
    inFront() { return document.visibilityState === 'visible' && document.hasFocus(); },

    // ---- what is worth telling: new repairs, my repair done, daily digest
    async check() {
      if (!Auth.current) return;
      const me = Auth.current.id;
      const s = await this.state();
      const now = Date.now();
      const all = DB.all('repairs');
      if (!s.lastRepair) { s.lastRepair = now; s.lastDone = now; await this.saveState(s); this.badge(); return this.saveBgConfig(); }
      const fresh = all.filter((r) => r.reportedAt > s.lastRepair && r.reporterId !== me && (r.status === '待處理' || r.status === '處理中') && Q.inStoreRec(r));
      const done = all.filter((r) => r.reporterId === me && r.status === '已完成' && (r.doneAt || 0) > (s.lastDone || 0) && r.updatedAt > s.lastDone);
      s.lastRepair = Math.max(s.lastRepair, ...all.map((r) => r.reportedAt || 0));
      s.lastDone = Math.max(s.lastDone || 0, ...all.map((r) => r.doneAt || 0));
      const front = this.inFront();
      if (fresh.length) {
        const urgent = fresh.filter((r) => r.urgency === '緊急').length;
        const title = `${urgent ? '🚨 ' : '🧰 '}新的報修 ${fresh.length} 件${urgent ? `（緊急 ${urgent}）` : ''}`;
        const body = fresh.slice(0, 3).map((r) => `${Q.eqName(r.equipmentId)}：${r.title}（${r.reporter || ''}）`).join('\n');
        if (front) UI.toast(title.replace(/^\S+ /, '') + '：' + fresh[0].title); else await this.show(title, body, fresh.length === 1 ? '#/repair/' + fresh[0].id : '#/repairs', 'sg-repair');
      }
      if (done.length) {
        const title = '✅ 你報修的設備已處理完成';
        const body = done.slice(0, 3).map((r) => `${Q.eqName(r.equipmentId)}：${r.title}${r.resolution ? '・' + r.resolution : ''}`).join('\n');
        if (front) UI.toast(body.split('\n')[0]); else await this.show(title, body, '#/repair/' + done[0].id, 'sg-done');
      }
      // Once a day (from 7 a.m.): maintenance due and low stock.
      const today = U.today();
      if (s.digestDate !== today && new Date().getHours() >= 7) {
        s.digestDate = today;
        const plans = DB.all('plans').filter((p) => p.active && DB.get('equipment', p.equipmentId) && Q.inStoreRec(p) && p.nextDue && p.nextDue <= today);
        const overdue = plans.filter((p) => p.nextDue < today).length;
        const low = Q.curStore() ? [] : Q.lowParts();
        const open = Q.openRepairs().length;
        const parts = [];
        if (plans.length) parts.push(`保養 ${plans.length} 項${overdue ? `（逾期 ${overdue}）` : ''}`);
        if (open) parts.push(`未完成報修 ${open} 件`);
        if (low.length) parts.push(`耗材需補貨 ${low.length} 項`);
        if (parts.length) await this.show('📋 今日待辦', parts.join('、'), plans.length ? '#/maint' : open ? '#/repairs' : '#/parts', 'sg-digest');
      }
      await this.saveState(s);
      this.badge();
      this.saveBgConfig();
    },
    badge() {
      const n = Q.openRepairs().length;
      try { if (navigator.setAppBadge) { if (n) navigator.setAppBadge(n); else navigator.clearAppBadge(); } } catch (e) { /* ignore */ }
    }
  });

  // ---- settings card (rendered by the settings page)
  N.settingsHtml = function () {
    const p = N.prefs();
    if (SG.desktop) {
      return `<section class="card" id="bg-card"><div class="card-head"><h2>背景執行與通知</h2></div>
        <label class="check"><input type="checkbox" id="bg-tray" ${p.tray ? 'checked' : ''}> <span>關閉視窗時縮到右下角系統匣，在背景繼續同步與提醒</span></label>
        <label class="check" style="margin-top:8px"><input type="checkbox" id="bg-auto"> <span>開機時自動啟動（直接在系統匣背景執行）</span></label>
        <label class="check" style="margin-top:8px"><input type="checkbox" id="bg-notify" ${p.notify ? 'checked' : ''}> <span>顯示 Windows 通知（新報修、報修完成、每日待辦）</span></label>
        <p class="small muted">要完全結束程式：在右下角系統匣的設備管家圖示按右鍵 →「結束」。</p>
        <div class="btn-row"><button class="btn" id="bg-test">傳送測試通知</button></div></section>`;
    }
    const perm = N.permission();
    const ios = N.isIOS();
    return `<section class="card" id="bg-card"><div class="card-head"><h2>背景執行與通知</h2><span id="bg-status"></span></div>
      <p class="small">通知狀態：<b>${perm === 'granted' && p.notify ? '已開啟' : perm === 'denied' ? '已被封鎖（請到瀏覽器／手機設定允許）' : perm === 'unsupported' ? '這個瀏覽器不支援' : '尚未開啟'}</b></p>
      <div class="btn-row">
        ${perm === 'granted' && p.notify ? `<button class="btn" id="bg-off">關閉通知</button><button class="btn" id="bg-test">傳送測試通知</button>` : `<button class="btn primary" id="bg-on">🔔 開啟通知</button>`}
      </div>
      <ul class="small muted bg-tips">
        <li>開啟後，新報修、你報修的設備修好了、每天的保養與補貨待辦都會通知你。</li>
        ${ios ? `<li>iPhone／iPad：請先用 Safari「分享 → 加入主畫面」，從主畫面開啟再按「開啟通知」。Apple 不允許網頁 App 在關閉後自己執行，所以會在你打開 App 時立即同步並提醒。</li>`
          : `<li>Android：建議先「安裝應用程式／加到主畫面」。安裝後系統會在背景定期幫你檢查雲端（約每 1～12 小時一次，由手機依電量與使用習慣決定），有新報修就跳通知。<span id="bg-periodic"></span></li>`}
        <li>App 開著（包括切到其他程式時）會每分鐘同步一次。</li>
      </ul></section>`;
  };
  N.wireSettings = async function (root) {
    const $ = (s) => UI.$(s, root);
    const re = () => UI.render();
    if (SG.desktop) {
      try { const r = await SG.desktop.api('/api/autostart'); if ($('#bg-auto')) $('#bg-auto').checked = !!r.on; } catch (e) { /* ignore */ }
      $('#bg-tray').onchange = (e) => { N.setPrefs({ tray: e.target.checked }); SG.desktop.api('/api/bg', { tray: e.target.checked }).catch(() => {}); UI.toast(e.target.checked ? '關閉視窗時會縮到系統匣' : '關閉視窗會直接結束程式'); };
      $('#bg-auto').onchange = async (e) => {
        try { const r = await SG.desktop.api('/api/autostart', { on: e.target.checked }); if (!r.ok) throw new Error(r.error || '設定失敗'); UI.toast(e.target.checked ? '已設定開機自動啟動' : '已取消開機自動啟動'); }
        catch (err) { e.target.checked = !e.target.checked; UI.toast(err.message, 'error'); }
      };
      $('#bg-notify').onchange = (e) => N.setPrefs({ notify: e.target.checked });
    } else {
      const on = $('#bg-on'); if (on) on.onclick = async () => { try { await N.enable(); UI.toast('通知已開啟'); await N.show('🔔 設備管家 PRO', '通知已開啟，有新報修或待辦時會提醒你', '#/dash', 'sg-test'); } catch (e) { UI.toast(e.message, 'error'); } re(); };
      const off = $('#bg-off'); if (off) off.onclick = () => { N.setPrefs({ notify: false }); UI.toast('通知已關閉'); re(); };
      const per = $('#bg-periodic');
      if (per) N.canPeriodic().then((ok) => { per.textContent = ok ? '（這台裝置支援背景檢查 ✓）' : '（這個瀏覽器目前不支援背景檢查，開著 App 時仍會提醒）'; });
    }
    const t = $('#bg-test'); if (t) t.onclick = async () => { await N.show('🔔 測試通知', '設備管家 PRO 的通知運作正常', '#/settings', 'sg-test'); UI.toast('已送出測試通知'); };
  };
})();
