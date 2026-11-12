// Runs cloud/Code.gs locally with in-memory fakes of the Apps Script services.
// Usage: node tools/gasmock.js <port> [state.json]
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const port = Number(process.argv[2] || 8792);
const stateFile = process.argv[3];
let state = { props: {}, rows: [] };
if (stateFile && fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => stateFile && fs.writeFileSync(stateFile, JSON.stringify(state));

function makeSheet() {
  const grid = state.rows; // array of arrays, row 0 = header
  const lastCol = () => grid.reduce((m, r) => { let n = r.length; while (n > 0 && (r[n - 1] === '' || r[n - 1] == null)) n--; return Math.max(m, n); }, 0);
  const lastRow = () => { let n = grid.length; while (n > 0 && !grid[n - 1].some((c) => c !== '' && c != null)) n--; return n; };
  const range = (r, c, nr, nc) => ({
    getValues() {
      const out = [];
      for (let i = 0; i < nr; i++) { const row = grid[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? '' : row[c - 1 + j]); out.push(o); }
      return out;
    },
    setValues(vals) {
      if (vals.length !== nr || vals.some((v) => v.length !== nc)) throw new Error('setValues dimension mismatch');
      vals.forEach((v, i) => { const row = grid[r - 1 + i] = grid[r - 1 + i] || []; v.forEach((x, j) => (row[c - 1 + j] = x)); });
    },
    clearContent() { for (let i = 0; i < nr; i++) { const row = grid[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = ''; } }
  });
  return {
    getLastRow: lastRow, getLastColumn: lastCol,
    getRange: (r, c, nr = 1, nc = 1) => range(r, c, nr, nc),
    getDataRange: () => range(1, 1, lastRow(), lastCol()),
    setFrozenRows() {}
  };
}

const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in state.props ? state.props[k] : null), setProperty: (k, v) => { state.props[k] = String(v); } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b))
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: () => (state.rows.length ? makeSheet() : null),
      insertSheet: () => { state.rows.push([]); return makeSheet(); }
    })
  },
  Logger: { log: console.log }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'cloud', 'Code.gs'), 'utf8'), ctx);

http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let out;
    try {
      out = req.method === 'POST' ? ctx.doPost({ postData: { contents: body } }) : ctx.doGet();
      save();
    } catch (e) { out = { text: JSON.stringify({ ok: false, error: 'MOCK', message: e.stack }) }; }
    res.writeHead(200, cors);
    res.end(out.text);
  });
}).listen(port, '127.0.0.1', () => console.log('gasmock on ' + port));
