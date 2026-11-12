// Local stand-in for the Apps Script web app: runs cloud/Code.gs in a VM
// with minimal fakes of SpreadsheetApp / PropertiesService / LockService /
// ContentService / Utilities, so sync can be tested without Google.
//
//   node tools/gasmock.js [port] [state.json]
//
// The fake sheet mimics Sheets' value coercion (numeric-looking strings
// become numbers, "=..." becomes a formula error) and the 50,000-character
// cell limit, so storage-format bugs show up here too.
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const port = Number(process.argv[2] || 8790);
const statePath = process.argv[3] || '';

let state = { sheets: {}, props: {} };
if (statePath && fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
function persist() { if (statePath) fs.writeFileSync(statePath, JSON.stringify(state)); }

function coerce(v) {
  if (typeof v !== 'string') return v;
  if (v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
  if (v.startsWith('=')) return '#ERROR!';
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v.trim())) return Number(v);
  return v;
}

function makeSheet(name) {
  const grid = state.sheets[name];
  const cell = (r, c) => (grid[r - 1] && grid[r - 1][c - 1] !== undefined ? grid[r - 1][c - 1] : '');
  function range(r, c, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(cell(r + i, c + j)); out.push(row); }
        return out;
      },
      setValues(vals) {
        if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('The number of rows or columns in the data does not match the range.');
        for (let i = 0; i < nr; i++) {
          grid[r + i - 1] = grid[r + i - 1] || [];
          for (let j = 0; j < nc; j++) grid[r + i - 1][c + j - 1] = coerce(vals[i][j]);
        }
        return this;
      },
      clearContent() {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (grid[r + i - 1]) grid[r + i - 1][c + j - 1] = '';
        return this;
      }
    };
  }
  const lastRow = () => { let n = grid.length; while (n > 0 && !(grid[n - 1] || []).some(v => v !== '' && v !== undefined)) n--; return n; };
  const lastCol = () => grid.reduce((m, row) => Math.max(m, (row || []).length), 0);
  return {
    getRange: range,
    getLastRow: lastRow,
    getDataRange: () => range(1, 1, Math.max(1, lastRow()), Math.max(1, lastCol())),
    setFrozenRows() {}
  };
}

const sandbox = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => (state.sheets[n] ? makeSheet(n) : null),
      insertSheet: (n) => { state.sheets[n] = []; return makeSheet(n); }
    })
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (k in state.props ? state.props[k] : null),
      setProperty: (k, v) => { state.props[k] = String(v); }
    })
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({ text, mime: 'text/plain', setMimeType(m) { this.mime = m; return this; } })
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b))
  },
  console
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'cloud', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'GET') {
    const o = sandbox.doGet();
    res.writeHead(200, { ...cors, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(o.text);
  }
  if (req.method !== 'POST') { res.writeHead(405, cors); return res.end(); }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    let o;
    try { o = sandbox.doPost({ postData: { contents: body } }); } catch (e) { res.writeHead(500, cors); return res.end(String(e)); }
    persist();
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(o.text);
  });
}).listen(port, () => console.log('gasmock listening on http://localhost:' + port));
