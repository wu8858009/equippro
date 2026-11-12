/**
 * EquipPro 雲端同步後端 (Google Apps Script)
 *
 * 安裝：
 *   1. 建立一個新的 Google 試算表 → 擴充功能 → Apps Script
 *   2. 把本檔內容貼到 Code.gs 並儲存
 *   3. 部署 → 新增部署作業 → 類型「網頁應用程式」
 *      執行身分：我；誰可以存取：所有人 → 部署並授權
 *   4. 複製「網頁應用程式網址」（結尾是 /exec），貼到 EquipPro「系統設定 → 雲端同步」
 *   第一次連線時輸入的同步密碼會成為這個後端的密碼（之後所有裝置都要用同一組）。
 *
 * 資料表「records」每列一筆紀錄：
 *   c（集合）| id | ts（修改時間）| rev（伺服器版本號）| deleted | n（JSON 分段數）| JSON 分段…
 * JSON 會切成多格存放，避開單一儲存格 5 萬字的上限（照片是 base64，較大）。
 */

var SHEET_NAME = 'records';
var HEADER = ['c', 'id', 'ts', 'rev', 'deleted', 'n'];
var FIXED_COLS = HEADER.length;
var CHUNK = 40000;
// Every stored chunk starts with this marker so Sheets never reads a chunk
// as a number, date or formula (a JSON fragment can start with "=", "-", digits…).
var MARK = '~';
var MAX_PULL_CHARS = 4000000;
var COLLECTIONS = ['users', 'equipment', 'replacements', 'quotes', 'activity', 'maintenancePlans', 'maintenanceLogs'];

// 在編輯器選擇這個函式按「執行」一次，完成授權並建立 records 工作表。
function setup() {
  getSheet();
  Logger.log('EquipPro 雲端後端已就緒');
}

function doGet() {
  return ContentService.createTextOutput('EquipPro 雲端同步後端運作中。請在 EquipPro 的「系統設定 → 雲端同步」貼上本網址。');
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: 'BAD_REQUEST', message: '請求格式錯誤' });
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var auth = checkKey(req.key);
    if (!auth.ok) return out(auth);
    if (req.action === 'ping') return out(ping(auth.claimed));
    if (req.action === 'sync') return out(sync(req));
    return out({ ok: false, error: 'BAD_ACTION', message: '未知的動作' });
  } catch (err) {
    return out({ ok: false, error: 'SERVER', message: '雲端處理失敗：' + err });
  } finally {
    lock.releaseLock();
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hashKey(key) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'equippro:' + key, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// The first client to connect sets the sync password; later requests must match it.
function checkKey(key) {
  key = String(key || '');
  if (key.length < 4) return { ok: false, error: 'AUTH', message: '同步密碼至少 4 個字元' };
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('KEY_HASH');
  if (!stored) {
    props.setProperty('KEY_HASH', hashKey(key));
    return { ok: true, claimed: true };
  }
  if (stored !== hashKey(key)) return { ok: false, error: 'AUTH', message: '同步密碼錯誤' };
  return { ok: true, claimed: false };
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, FIXED_COLS).setValues([HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function currentRev() {
  return Number(PropertiesService.getScriptProperties().getProperty('REV') || 0);
}

function ping(claimed) {
  var sh = getSheet();
  var counts = {};
  var last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 5).getValues().forEach(function (r) {
      if (Number(r[4])) return;
      counts[r[0]] = (counts[r[0]] || 0) + 1;
    });
  }
  return { ok: true, claimed: !!claimed, rev: currentRev(), counts: counts };
}

function readIndex(sh) {
  var index = {};
  var last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, FIXED_COLS).getValues().forEach(function (r, i) {
      index[r[0] + '|' + r[1]] = { row: i + 2, ts: Number(r[2]), rev: Number(r[3]), n: Number(r[5]) || 0 };
    });
  }
  return index;
}

function sync(req) {
  var sh = getSheet();
  var props = PropertiesService.getScriptProperties();
  var rev = currentRev();
  var index = readIndex(sh);
  var rejected = [];
  var appends = [];
  var changes = Array.isArray(req.changes) ? req.changes : [];

  changes.forEach(function (ch) {
    if (!ch || COLLECTIONS.indexOf(ch.c) === -1 || !ch.id) return;
    var key = ch.c + '|' + ch.id;
    var ts = Number(ch.ts) || 0;
    var existing = index[key];
    if (existing && existing.ts > ts) { rejected.push(key); return; }
    rev++;
    var json = ch.deleted ? '' : JSON.stringify(ch.data);
    var chunks = [];
    for (var p = 0; p < json.length; p += CHUNK) chunks.push(MARK + json.substr(p, CHUNK));
    var row = [ch.c, String(ch.id), ts, rev, ch.deleted ? 1 : 0, chunks.length].concat(chunks);
    if (existing) {
      sh.getRange(existing.row, 1, 1, row.length).setValues([row]);
      if (existing.n > chunks.length) {
        sh.getRange(existing.row, FIXED_COLS + chunks.length + 1, 1, existing.n - chunks.length).clearContent();
      }
      existing.ts = ts; existing.rev = rev; existing.n = chunks.length;
    } else {
      appends.push(row);
      index[key] = { row: -1, ts: ts, rev: rev, n: chunks.length };
    }
  });
  if (appends.length) {
    var start = sh.getLastRow() + 1;
    var width = appends.reduce(function (m, r) { return Math.max(m, r.length); }, FIXED_COLS);
    var padded = appends.map(function (r) { while (r.length < width) r.push(''); return r; });
    sh.getRange(start, 1, padded.length, width).setValues(padded);
    padded.forEach(function (r, i) { index[r[0] + '|' + r[1]].row = start + i; });
  }
  props.setProperty('REV', String(rev));

  // Pull: everything newer than the client's cursor (plus the server copy of
  // anything we rejected), oldest first, capped per response.
  var since = Number(req.since) || 0;
  var wanted = [];
  Object.keys(index).forEach(function (k) {
    var it = index[k];
    if (it.rev > since || rejected.indexOf(k) !== -1) wanted.push(it);
  });
  wanted.sort(function (a, b) { return a.rev - b.rev; });

  var rows = [];
  var more = false;
  var cursor = rev;
  if (wanted.length) {
    var data = sh.getDataRange().getValues();
    var chars = 0;
    for (var i = 0; i < wanted.length; i++) {
      var r = data[wanted[i].row - 1];
      var n = Number(r[5]) || 0;
      var json = '';
      for (var j = 0; j < n; j++) json += String(r[FIXED_COLS + j]).substr(MARK.length);
      if (rows.length && chars + json.length > MAX_PULL_CHARS && wanted[i].rev > since) {
        more = true;
        cursor = Math.max(since, wanted[i - 1].rev);
        break;
      }
      chars += json.length;
      var deleted = !!Number(r[4]);
      rows.push({ c: r[0], id: String(r[1]), ts: Number(r[2]), rev: Number(r[3]), deleted: deleted, data: deleted || !json ? null : JSON.parse(json) });
    }
  }
  return { ok: true, rows: rows, cursor: cursor, more: more, rejected: rejected };
}
