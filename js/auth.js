/* EPM.auth — login/session/user management */
(function () {
  const S = EPM.storage;

  // Functional modules a staff account's access can be individually toggled
  // for. Admin accounts always have full access regardless of this list —
  // it only narrows what a *staff* role can reach. Routes not in this list
  // (dashboard, users, features) are never module-gated.
  const MODULES = [
    { key: 'equipment', label: '設備清單' },
    { key: 'maintenance', label: '保養維修' },
    { key: 'pricing', label: '價格管理' },
    { key: 'reports', label: '報表分析' }
  ];
  const DEFAULT_MODULES = MODULES.map(m => m.key);

  const LOGIN_LOCK_THRESHOLD = 5;
  const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

  // Login bookkeeping (last login, failed attempts, lockout) is kept in a
  // separate userStats record per user. A login then never rewrites the
  // account record itself, so with cloud sync a login on a device holding a
  // stale copy cannot undo a password, role or active change made elsewhere.
  const STAT_FIELDS = ['lastLoginAt', 'failedAttempts', 'lockedUntil'];
  function readStats() { return S.read(S.KEYS.userStats, []); }
  function statsFor(user) {
    const st = readStats().find(x => x.id === user.id);
    // Accounts saved before userStats existed carry the fields themselves.
    return st || { id: user.id, lastLoginAt: user.lastLoginAt || null, failedAttempts: user.failedAttempts || 0, lockedUntil: user.lockedUntil || null };
  }
  function saveStats(userId, patch) {
    const all = readStats();
    const idx = all.findIndex(x => x.id === userId);
    const user = rawUsers().find(u => u.id === userId);
    const base = idx >= 0 ? all[idx] : (user ? statsFor(user) : { id: userId });
    const next = { ...base, ...patch, id: userId };
    if (idx >= 0) all[idx] = next; else all.push(next);
    S.write(S.KEYS.userStats, all);
  }

  function rawUsers() { return S.read(S.KEYS.users, []); }
  // Accounts with their login bookkeeping merged in (read-only view).
  function getUsers() {
    const stats = readStats();
    return rawUsers().map(u => {
      const st = stats.find(x => x.id === u.id);
      if (!st) return u;
      const merged = { ...u };
      STAT_FIELDS.forEach(k => { merged[k] = st[k]; });
      return merged;
    });
  }
  function saveUsers(list) {
    // Strip the bookkeeping fields so they never travel inside the account record.
    S.write(S.KEYS.users, list.map(u => {
      const clean = { ...u };
      STAT_FIELDS.forEach(k => { delete clean[k]; });
      return clean;
    }));
  }
  function hasUsers() { return rawUsers().length > 0; }

  function hasModuleAccess(moduleKey, user) {
    if (!MODULES.some(m => m.key === moduleKey)) return true;
    user = user || getCurrentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    const modules = Array.isArray(user.modules) ? user.modules : DEFAULT_MODULES;
    // Accounts saved before the 保養維修 module existed (no modulesV2 flag)
    // inherit it from their 設備清單 access instead of silently losing it.
    if (moduleKey === 'maintenance' && !user.modulesV2) return modules.includes('equipment');
    return modules.includes(moduleKey);
  }

  function login(username, password) {
    const user = rawUsers().find(u => u.username === String(username || '').trim());
    if (!user) return { ok: false, message: '帳號不存在' };
    if (!user.active) return { ok: false, message: '此帳號已被停用，請聯絡管理員' };
    const st = statsFor(user);
    if (st.lockedUntil && Date.now() < st.lockedUntil) {
      const mins = Math.max(1, Math.ceil((st.lockedUntil - Date.now()) / 60000));
      return { ok: false, message: `密碼錯誤次數過多，帳號已鎖定，請於約 ${mins} 分鐘後再試` };
    }
    if (user.passwordHash !== S.simpleHash(password || '')) {
      const failed = (st.failedAttempts || 0) + 1;
      if (failed >= LOGIN_LOCK_THRESHOLD) {
        saveStats(user.id, { failedAttempts: 0, lockedUntil: Date.now() + LOGIN_LOCK_DURATION_MS });
        logActivity('帳號鎖定', user.username, `連續輸入錯誤密碼達 ${LOGIN_LOCK_THRESHOLD} 次`, user);
        return { ok: false, message: '密碼錯誤次數過多，帳號已暫時鎖定' };
      }
      saveStats(user.id, { failedAttempts: failed });
      return { ok: false, message: '密碼錯誤' };
    }
    saveStats(user.id, { failedAttempts: 0, lockedUntil: null, lastLoginAt: Date.now() });
    S.write(S.KEYS.session, { userId: user.id, loginAt: Date.now() });
    logActivity('登入系統', '-', '使用者登入', user);
    return { ok: true, user };
  }

  function logout() {
    const u = getCurrentUser();
    if (u) logActivity('登出系統', '-', '使用者登出', u);
    S.remove(S.KEYS.session);
  }

  function getCurrentUser() {
    const session = S.read(S.KEYS.session, null);
    if (!session) return null;
    return rawUsers().find(u => u.id === session.userId) || null;
  }

  function isAdmin() {
    const u = getCurrentUser();
    return !!u && u.role === 'admin';
  }

  function createUser({ username, password, name, role, modules }) {
    const users = rawUsers();
    username = String(username || '').trim();
    if (!username || !password) return { ok: false, message: '帳號與密碼為必填' };
    if (users.some(u => u.username === username)) return { ok: false, message: '帳號已存在' };
    const user = {
      id: S.uid('u'), username, passwordHash: S.simpleHash(password),
      name: (name || '').trim() || username, role: role === 'admin' ? 'admin' : 'staff',
      modules: Array.isArray(modules) ? modules : DEFAULT_MODULES.slice(), modulesV2: true,
      active: true, createdAt: Date.now()
    };
    users.push(user);
    saveUsers(users);
    logActivity('新增使用者', user.username, `角色: ${user.role === 'admin' ? '管理員' : '一般人員'}`);
    return { ok: true, user };
  }

  function updateUser(id, patch) {
    const users = rawUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return { ok: false, message: '找不到使用者' };
    patch = { ...patch };
    if (Array.isArray(patch.modules)) patch.modulesV2 = true;
    if (patch.password) {
      patch.passwordHash = S.simpleHash(patch.password);
      delete patch.password;
    }
    if (patch.active === false && users[idx].role === 'admin' &&
        users.filter(u => u.role === 'admin' && u.active).length <= 1) {
      return { ok: false, message: '至少須保留一位啟用中的管理員' };
    }
    users[idx] = { ...users[idx], ...patch };
    saveUsers(users);
    logActivity('編輯使用者', users[idx].username, '更新使用者資料');
    return { ok: true, user: users[idx] };
  }

  function unlockUser(id) {
    const user = rawUsers().find(u => u.id === id);
    if (!user) return { ok: false, message: '找不到使用者' };
    saveStats(id, { failedAttempts: 0, lockedUntil: null });
    logActivity('解除帳號鎖定', user.username, '-');
    return { ok: true, user };
  }

  function deleteUser(id) {
    let users = rawUsers();
    const target = users.find(u => u.id === id);
    if (!target) return { ok: false, message: '找不到使用者' };
    if (target.role === 'admin' && users.filter(u => u.role === 'admin' && u.active).length <= 1) {
      return { ok: false, message: '至少須保留一位管理員' };
    }
    users = users.filter(u => u.id !== id);
    saveUsers(users);
    S.write(S.KEYS.userStats, readStats().filter(x => x.id !== id));
    logActivity('刪除使用者', target.username, '-');
    return { ok: true };
  }

  function logActivity(action, target, detail, overrideUser) {
    const list = S.read(S.KEYS.activity, []);
    const user = overrideUser || getCurrentUser();
    list.unshift({
      id: S.uid('log'), timestamp: Date.now(),
      userId: user ? user.id : null, userName: user ? user.name : '系統',
      action, target, detail
    });
    S.write(S.KEYS.activity, list.slice(0, 300));
  }

  window.EPM.auth = {
    login, logout, getCurrentUser, isAdmin, getUsers, hasUsers,
    createUser, updateUser, deleteUser, unlockUser, logActivity,
    hasModuleAccess, MODULES, DEFAULT_MODULES
  };
})();
