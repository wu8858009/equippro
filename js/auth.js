/* EPM.auth — login/session/user management */
(function () {
  const S = EPM.storage;

  // Functional modules a staff account's access can be individually toggled
  // for. Admin accounts always have full access regardless of this list —
  // it only narrows what a *staff* role can reach. Routes not in this list
  // (dashboard, users, features) are never module-gated.
  const MODULES = [
    { key: 'equipment', label: '設備清單' },
    { key: 'pricing', label: '價格管理' },
    { key: 'reports', label: '報表分析' }
  ];
  const DEFAULT_MODULES = MODULES.map(m => m.key);

  const LOGIN_LOCK_THRESHOLD = 5;
  const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

  function getUsers() { return S.read(S.KEYS.users, []); }
  function saveUsers(list) { S.write(S.KEYS.users, list); }
  function hasUsers() { return getUsers().length > 0; }

  function hasModuleAccess(moduleKey, user) {
    if (!MODULES.some(m => m.key === moduleKey)) return true;
    user = user || getCurrentUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    const modules = Array.isArray(user.modules) ? user.modules : DEFAULT_MODULES;
    return modules.includes(moduleKey);
  }

  function login(username, password) {
    const users = getUsers();
    const user = users.find(u => u.username === String(username || '').trim());
    if (!user) return { ok: false, message: '帳號不存在' };
    if (!user.active) return { ok: false, message: '此帳號已被停用，請聯絡管理員' };
    if (user.lockedUntil && Date.now() < user.lockedUntil) {
      const mins = Math.max(1, Math.ceil((user.lockedUntil - Date.now()) / 60000));
      return { ok: false, message: `密碼錯誤次數過多，帳號已鎖定，請於約 ${mins} 分鐘後再試` };
    }
    if (user.passwordHash !== S.simpleHash(password || '')) {
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      if (user.failedAttempts >= LOGIN_LOCK_THRESHOLD) {
        user.lockedUntil = Date.now() + LOGIN_LOCK_DURATION_MS;
        user.failedAttempts = 0;
        saveUsers(users);
        logActivity('帳號鎖定', user.username, `連續輸入錯誤密碼達 ${LOGIN_LOCK_THRESHOLD} 次`, user);
        return { ok: false, message: '密碼錯誤次數過多，帳號已暫時鎖定' };
      }
      saveUsers(users);
      return { ok: false, message: '密碼錯誤' };
    }
    user.failedAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = Date.now();
    saveUsers(users);
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
    return getUsers().find(u => u.id === session.userId) || null;
  }

  function isAdmin() {
    const u = getCurrentUser();
    return !!u && u.role === 'admin';
  }

  function createUser({ username, password, name, role, modules }) {
    const users = getUsers();
    username = String(username || '').trim();
    if (!username || !password) return { ok: false, message: '帳號與密碼為必填' };
    if (users.some(u => u.username === username)) return { ok: false, message: '帳號已存在' };
    const user = {
      id: S.uid('u'), username, passwordHash: S.simpleHash(password),
      name: (name || '').trim() || username, role: role === 'admin' ? 'admin' : 'staff',
      modules: Array.isArray(modules) ? modules : DEFAULT_MODULES.slice(),
      active: true, createdAt: Date.now(),
      lastLoginAt: null, failedAttempts: 0, lockedUntil: null
    };
    users.push(user);
    saveUsers(users);
    logActivity('新增使用者', user.username, `角色: ${user.role === 'admin' ? '管理員' : '一般人員'}`);
    return { ok: true, user };
  }

  function updateUser(id, patch) {
    const users = getUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return { ok: false, message: '找不到使用者' };
    patch = { ...patch };
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
    const users = getUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return { ok: false, message: '找不到使用者' };
    users[idx].failedAttempts = 0;
    users[idx].lockedUntil = null;
    saveUsers(users);
    logActivity('解除帳號鎖定', users[idx].username, '-');
    return { ok: true, user: users[idx] };
  }

  function deleteUser(id) {
    let users = getUsers();
    const target = users.find(u => u.id === id);
    if (!target) return { ok: false, message: '找不到使用者' };
    if (target.role === 'admin' && users.filter(u => u.role === 'admin' && u.active).length <= 1) {
      return { ok: false, message: '至少須保留一位管理員' };
    }
    users = users.filter(u => u.id !== id);
    saveUsers(users);
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
