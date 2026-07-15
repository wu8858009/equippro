/* EPM.auth — login/session/user management */
(function () {
  const S = EPM.storage;

  function getUsers() { return S.read(S.KEYS.users, []); }
  function saveUsers(list) { S.write(S.KEYS.users, list); }
  function hasUsers() { return getUsers().length > 0; }

  function login(username, password) {
    const users = getUsers();
    const user = users.find(u => u.username === String(username || '').trim());
    if (!user) return { ok: false, message: '帳號不存在' };
    if (!user.active) return { ok: false, message: '此帳號已被停用，請聯絡管理員' };
    if (user.passwordHash !== S.simpleHash(password || '')) return { ok: false, message: '密碼錯誤' };
    S.write(S.KEYS.session, { userId: user.id, loginAt: Date.now() });
    logActivity('登入系統', '-', '使用者登入', user);
    return { ok: true, user };
  }

  function logout() {
    const u = getCurrentUser();
    if (u) logActivity('登出系統', '-', '使用者登出', u);
    localStorage.removeItem(S.KEYS.session);
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

  function createUser({ username, password, name, role }) {
    const users = getUsers();
    username = String(username || '').trim();
    if (!username || !password) return { ok: false, message: '帳號與密碼為必填' };
    if (users.some(u => u.username === username)) return { ok: false, message: '帳號已存在' };
    const user = {
      id: S.uid('u'), username, passwordHash: S.simpleHash(password),
      name: (name || '').trim() || username, role: role === 'admin' ? 'admin' : 'staff',
      active: true, createdAt: Date.now()
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
    createUser, updateUser, deleteUser, logActivity
  };
})();
