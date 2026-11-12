/**
 * 設備管家 — cloud backend (Google Apps Script web app bound to a spreadsheet).
 *
 * Sheet "records": one row per record
 *   A collection | B id | C updatedAt | D deleted | E rev | F.. JSON (split into 45k-char cells)
 * Every write gets a new server revision number (REV). Clients send their
 * changes plus the last REV they saw and receive everything newer.
 * Conflicts: the record with the larger updatedAt wins.
 *
 * The first client to call `claim` sets the sync password (stored as a hash).
 */
var SHEET = 'records';
var FIXED = 5;
var CHUNK = 45000;
var PAGE = 1500;
var COLLECTIONS = ['users', 'equipment', 'replacements', 'quotes', 'plans', 'logs', 'vendors', 'activity', 'settings'];
var ACTIVITY_MAX = 3000;
var ACTIVITY_KEEP = 2000;

function doGet() {
  return out({ ok: true, app: 'shebei-guanjia', claimed: !!props().getProperty('KEY_HASH') });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'BADREQ', message: '請求格式錯誤' }); }
  var action = req.action;
  if (action === 'status') return out({ ok: true, claimed: !!props().getProperty('KEY_HASH') });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) {
    return out({ ok: false, error: 'BUSY', message: '雲端忙碌中，稍後會自動重試' });
  }
  try {
    if (action === 'claim') return out(claim(req));
    if (!checkKey(req.key)) return out({ ok: false, error: 'BADKEY', message: '同步密碼錯誤' });
    if (action === 'sync') return out(sync(req));
    return out({ ok: false, error: 'BADREQ', message: '未知的操作' });
  } catch (err) {
    return out({ ok: false, error: 'SERVER', message: '雲端錯誤：' + err.message });
  } finally {
    lock.releaseLock();
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function props() { return PropertiesService.getScriptProperties(); }
function hash(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'shebei-guanjia:' + s, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}
function checkKey(key) {
  var h = props().getProperty('KEY_HASH');
  return !!h && typeof key === 'string' && hash(key) === h;
}
function claim(req) {
  if (props().getProperty('KEY_HASH')) return { ok: false, error: 'CLAIMED', message: '雲端已經設定過同步密碼' };
  if (typeof req.key !== 'string' || req.key.length < 6) return { ok: false, error: 'BADREQ', message: '同步密碼至少 6 個字' };
  props().setProperty('KEY_HASH', hash(req.key));
  props().setProperty('REV', '0');
  sheet();
  return { ok: true, claimed: true };
}

function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange(1, 1, 1, FIXED + 1).setValues([['collection', 'id', 'updatedAt', 'deleted', 'rev', 'json']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readFixed(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, FIXED).getValues();
}

function sync(req) {
  var sh = sheet();
  var fixed = readFixed(sh);
  var index = {};
  fixed.forEach(function (r, i) { index[r[0] + '/' + r[1]] = i; });
  var rev = Number(props().getProperty('REV') || 0);
  var changes = Array.isArray(req.changes) ? req.changes : [];
  var appends = [];
  var accepted = 0;

  changes.forEach(function (ch) {
    if (!ch || COLLECTIONS.indexOf(ch.c) < 0 || !ch.id || typeof ch.j !== 'string') return;
    var key = ch.c + '/' + ch.id;
    var u = Number(ch.u) || 0;
    var at = index[key];
    if (at !== undefined && Number(fixed[at][2]) >= u) return; // ours is newer or equal
    rev++;
    accepted++;
    var row = [ch.c, String(ch.id), u, ch.d ? 1 : 0, rev].concat(chunk(ch.j));
    if (at !== undefined) {
      var width = Math.max(sh.getLastColumn(), row.length);
      while (row.length < width) row.push('');
      sh.getRange(at + 2, 1, 1, row.length).setValues([row]);
      fixed[at] = row.slice(0, FIXED);
    } else {
      index[key] = fixed.length + appends.length;
      appends.push(row);
    }
  });
  if (appends.length) {
    var w = appends.reduce(function (m, r) { return Math.max(m, r.length); }, FIXED + 1);
    appends.forEach(function (r) { while (r.length < w) r.push(''); });
    sh.getRange(sh.getLastRow() + 1, 1, appends.length, w).setValues(appends);
    appends.forEach(function (r) { fixed.push(r.slice(0, FIXED)); });
  }
  if (accepted) props().setProperty('REV', String(rev));
  if (accepted && pruneActivity(sh)) fixed = readFixed(sh);

  // Everything newer than what the client has seen, oldest first, one page at a time.
  var since = Number(req.since) || 0;
  var newer = [];
  fixed.forEach(function (r, i) { if (Number(r[4]) > since) newer.push(i); });
  newer.sort(function (a, b) { return Number(fixed[a][4]) - Number(fixed[b][4]); });
  var more = newer.length > PAGE;
  if (more) newer = newer.slice(0, PAGE);
  var rows = [];
  if (newer.length) {
    var width = sh.getLastColumn();
    var data = sh.getRange(2, 1, fixed.length, width).getValues();
    newer.forEach(function (i) {
      var r = data[i];
      rows.push({ c: r[0], id: String(r[1]), u: Number(r[2]), d: Number(r[3]), j: r.slice(FIXED).join('').replace(/^~/, '') });
    });
  }
  var lastRev = more ? Number(fixed[newer[newer.length - 1]][4]) : rev;
  return { ok: true, rev: lastRev, more: more, accepted: accepted, rows: rows };
}

// A leading "~" keeps Sheets from reading JSON-looking text as a number/date.
function chunk(s) {
  s = '~' + s;
  var parts = [];
  for (var i = 0; i < s.length; i += CHUNK) parts.push(s.slice(i, i + CHUNK));
  return parts;
}

// Keeps only the newest ACTIVITY_KEEP activity rows once there are more than ACTIVITY_MAX.
function pruneActivity(sh) {
  var fixed = readFixed(sh);
  var act = [];
  fixed.forEach(function (r, i) { if (r[0] === 'activity') act.push({ i: i, u: Number(r[2]) }); });
  if (act.length <= ACTIVITY_MAX) return false;
  act.sort(function (a, b) { return a.u - b.u; });
  var drop = {};
  act.slice(0, act.length - ACTIVITY_KEEP).forEach(function (a) { drop[a.i] = true; });
  var width = sh.getLastColumn();
  var data = sh.getRange(2, 1, fixed.length, width).getValues();
  var keep = data.filter(function (r, i) { return !drop[i]; });
  sh.getRange(2, 1, fixed.length, width).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
  return true;
}

/** Run once from the editor to authorize spreadsheet access. */
function setup() {
  sheet();
  Logger.log('ready; claimed=' + !!props().getProperty('KEY_HASH'));
}
