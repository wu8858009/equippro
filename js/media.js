/* 設備管家 — photos/attachments, Excel (SheetJS, loaded on demand) and printing. */
(function () {
  'use strict';
  const SG = window.SG;
  const { util: U, db: DB, ui: UI, auth: Auth } = SG;
  const esc = U.esc;

  // ====================================================== photos & documents
  // photo: { parentType: 'equipment'|'replacement'|'log'|'repair'|'quote', parentId, kind, caption, data,
  //          mime?: 'application/pdf', name?, size? }  — PDFs are kept as data URLs too.
  const KINDS = {
    equipment: ['外觀', '銘牌', '安裝位置', '說明書', '其他'],
    replacement: ['發票', '保固單', '施工照片', '其他'],
    log: ['發票', '保固單', '施工照片', '其他'],
    repair: ['故障照片', '修好後', '發票', '其他'],
    quote: ['報價單', '請購單', '規格／型錄', '其他']
  };
  const PDF_MAX = 8 * 1024 * 1024; // keep sync and storage reasonable
  const isPdf = (p) => p && (p.mime === 'application/pdf' || /^data:application\/pdf/.test(p.data || ''));
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const readDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('無法讀取檔案'));
    r.readAsDataURL(file);
  });
  // data: URL -> blob: URL (browsers refuse to show PDFs from data: URLs in frames)
  const blobUrl = (dataUrl) => {
    const [head, b64] = dataUrl.split(',');
    const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  };

  const M = (SG.media = {
    KINDS, isPdf,
    list(type, id) {
      return DB.all('photos').filter((p) => p.parentType === type && p.parentId === id).sort((a, b) => a.createdAt - b.createdAt);
    },
    count(type, id) { return this.list(type, id).length; },
    removeFor(type, id) { this.list(type, id).forEach((p) => DB.remove('photos', p.id)); },
    pick(multiple = true) {
      return new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*,application/pdf,.pdf'; inp.multiple = multiple;
        inp.onchange = () => resolve(Array.from(inp.files || []));
        inp.click();
      });
    },
    async add(type, id, kind) {
      const files = await this.pick(true);
      if (!files.length) return 0;
      let n = 0, docs = 0;
      for (const f of files) {
        try {
          if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
            if (f.size > PDF_MAX) throw new Error(`「${f.name}」${kb(f.size)}，超過 8 MB，請先壓縮或改拍照`);
            let data = await readDataUrl(f);
            if (!/^data:application\/pdf/.test(data)) data = 'data:application/pdf;base64,' + data.split(',')[1];
            DB.put('photos', { parentType: type, parentId: id, kind: kind || KINDS[type][0], caption: '', data, mime: 'application/pdf', name: f.name, size: f.size }, { quiet: true });
            docs++;
          } else {
            const data = await U.compressImage(f, 1600, 300000);
            DB.put('photos', { parentType: type, parentId: id, kind: kind || KINDS[type][0], caption: '', data }, { quiet: true });
          }
          n++;
        } catch (e) { UI.toast(e.message, 'error'); }
      }
      if (n) {
        DB.changed('photos');
        SG.log('加入附件', `${n - docs ? (n - docs) + ' 張照片' : ''}${docs ? (n - docs ? '、' : '') + docs + ' 個 PDF' : ''}`);
        UI.toast(`已加入 ${n} 個檔案`);
      }
      return n;
    },
    thumb(p) {
      if (isPdf(p)) {
        return `<button class="g-thumb g-pdf" data-ph="${p.id}" title="${esc(p.name || 'PDF')}"><b class="pdf-ico">PDF</b><em>${esc(p.name || 'PDF 文件')}</em>${p.kind ? `<span>${esc(p.kind)}</span>` : ''}</button>`;
      }
      return `<button class="g-thumb" data-ph="${p.id}" title="${esc(p.kind || '')}"><img src="${p.data}" alt="" loading="lazy">${p.kind ? `<span>${esc(p.kind)}</span>` : ''}</button>`;
    },
    // Thumbnails + add button. `editable` lets the user add/delete.
    html(type, id, { editable = Auth.can('edit'), empty = '還沒有附件' } = {}) {
      const ps = this.list(type, id);
      const kinds = KINDS[type];
      return `<div class="gallery" data-gal="${type}|${id}">
        ${ps.map((p) => this.thumb(p)).join('')}
        ${editable ? `<div class="g-add"><select class="g-kind" aria-label="類別">${kinds.map((k) => `<option>${k}</option>`).join('')}</select><button class="btn sm" data-phadd="${type}|${id}">📎 加照片／PDF</button></div>` : ''}
        ${!ps.length && !editable ? `<p class="muted small">${empty}</p>` : ''}
      </div>`;
    },
    wire(root, onChange) {
      UI.$$('[data-phadd]', root).forEach((b) => (b.onclick = async () => {
        const [type, id] = b.dataset.phadd.split('|');
        const kind = UI.$('.g-kind', b.parentElement).value;
        b.disabled = true;
        const n = await this.add(type, id, kind);
        b.disabled = false;
        if (n) (onChange || UI.render)();
      }));
      UI.$$('[data-ph]', root).forEach((b) => (b.onclick = () => this.view(b.dataset.ph, onChange)));
    },
    fileName(p, i) {
      if (isPdf(p)) return p.name || `${p.kind || '文件'}_${U.today()}.pdf`;
      return `${p.kind || '照片'}_${U.today()}_${i + 1}.jpg`;
    },
    view(photoId, onChange) {
      const p0 = DB.get('photos', photoId);
      if (!p0) return;
      const all = this.list(p0.parentType, p0.parentId);
      let i = Math.max(0, all.findIndex((p) => p.id === photoId));
      let objUrl = null;
      const canEdit = Auth.can('edit');
      const m = UI.modal({
        title: '附件', wide: true,
        body: `<div class="ph-view"><button class="ph-nav prev" aria-label="上一個">‹</button><div id="ph-stage"></div><button class="ph-nav next" aria-label="下一個">›</button></div>
          <div class="ph-meta"><span id="ph-count" class="muted small"></span>
          ${canEdit ? `<select id="ph-kind">${KINDS[p0.parentType].map((k) => `<option>${k}</option>`).join('')}</select><input id="ph-cap" placeholder="說明（可不填）">` : '<span id="ph-capro"></span>'}</div>`,
        actions: [
          ...(canEdit ? [{ label: '刪除', kind: 'danger-ghost', onClick: async () => {
            if (!(await UI.confirm('確定刪除這個附件？', { ok: '刪除', danger: true }))) return false;
            DB.remove('photos', all[i].id);
            all.splice(i, 1);
            UI.toast('已刪除');
            if (!all.length) { (onChange || UI.render)(); return true; }
            i = Math.min(i, all.length - 1); show(); (onChange || UI.render)();
            return false;
          } }] : []),
          { label: '另開視窗', onClick: () => { M.open(all[i]); return false; } },
          { label: '下載', onClick: () => { M.downloadData(all[i].data, M.fileName(all[i], i)); return false; } },
          { label: '關閉', kind: 'primary' }
        ],
        onClose: () => { if (objUrl) URL.revokeObjectURL(objUrl); }
      });
      m.el.classList.add('ph-modal');
      const save = () => {
        if (!canEdit) return;
        const p = DB.get('photos', all[i].id);
        const kind = UI.$('#ph-kind', m.body).value, caption = UI.$('#ph-cap', m.body).value.trim();
        if (p && (p.kind !== kind || (p.caption || '') !== caption)) { all[i] = DB.put('photos', Object.assign({}, p, { kind, caption })); }
      };
      const show = () => {
        const p = all[i];
        const stage = UI.$('#ph-stage', m.body);
        if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
        if (isPdf(p)) {
          // Inline preview needs the browser's own PDF viewer (desktop browsers,
          // the exe, Safari); Android Chrome has none, so offer a big button.
          const inline = navigator.pdfViewerEnabled !== false && !/Android/i.test(navigator.userAgent);
          if (inline) {
            objUrl = blobUrl(p.data);
            stage.innerHTML = `<iframe class="pdf-frame" title="PDF" src="${objUrl}#view=FitH"></iframe>
              <p class="pdf-cap">📄 ${esc(p.name || 'PDF 文件')}${p.size ? '・' + kb(p.size) : ''}　看不到內容時請按「另開視窗」或「下載」</p>`;
          } else {
            stage.innerHTML = `<div class="pdf-card"><b class="pdf-ico big">PDF</b><div class="pdf-name">${esc(p.name || 'PDF 文件')}</div>
              <div class="muted small">${p.size ? kb(p.size) : ''}</div><button class="btn primary" id="pdf-open">開啟 PDF</button></div>`;
            UI.$('#pdf-open', stage).onclick = () => M.open(p);
          }
        } else stage.innerHTML = `<img id="ph-img" src="${p.data}" alt="">`;
        UI.$('#ph-count', m.body).textContent = `${i + 1} / ${all.length}`;
        if (canEdit) { UI.$('#ph-kind', m.body).value = p.kind || KINDS[p.parentType][0]; UI.$('#ph-cap', m.body).value = p.caption || ''; }
        else UI.$('#ph-capro', m.body).textContent = [p.kind, p.caption].filter(Boolean).join('：');
        UI.$$('.ph-nav', m.body).forEach((b) => (b.hidden = all.length < 2));
      };
      UI.$('.prev', m.body).onclick = () => { save(); i = (i - 1 + all.length) % all.length; show(); };
      UI.$('.next', m.body).onclick = () => { save(); i = (i + 1) % all.length; show(); };
      if (canEdit) {
        UI.$('#ph-kind', m.body).onchange = save;
        UI.$('#ph-cap', m.body).onchange = save;
      }
      show();
    },
    // Full-size view in a new tab (desktop: saves the file and opens it with the default program).
    open(p) {
      if (SG.desktop) return SG.desktop.openFile(this.fileName(p, 0), p.data);
      const url = blobUrl(p.data);
      const w = window.open(url, '_blank');
      if (!w) this.downloadData(p.data, this.fileName(p, 0));
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    // Attachment manager for any record (quote, replacement, log...).
    manage(type, id, title) {
      const m = UI.modal({ title: '附件 — ' + title, wide: true, body: '<div class="att-body"></div>', actions: [{ label: '關閉', kind: 'primary' }], onClose: () => UI.render() });
      const paint = () => {
        const box = UI.$('.att-body', m.body);
        box.innerHTML = `<p class="small muted">可放照片或 PDF（例如廠商報價單、請購單、型錄），PDF 單檔最大 8 MB</p>${this.html(type, id, { empty: '沒有附件' })}`;
        this.wire(box, paint);
      };
      paint();
      return m;
    },
    downloadData(dataUrl, name) {
      if (SG.desktop) return SG.desktop.saveFile(name, dataUrl);
      const url = /^data:/.test(dataUrl) ? blobUrl(dataUrl) : dataUrl;
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      if (url !== dataUrl) setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  });

  // ====================================================== Excel
  let xlsxLoading = null;
  const X = (SG.excel = {
    load() {
      if (window.XLSX) return Promise.resolve(window.XLSX);
      if (!xlsxLoading) xlsxLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/xlsx.mini.min.js';
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { xlsxLoading = null; reject(new Error('無法載入 Excel 元件')); };
        document.head.appendChild(s);
      });
      return xlsxLoading;
    },
    // sheets: [{ name, rows: [[header...], [..]...], widths?: [chars] }]
    async save(fileName, sheets) {
      const XLSX = await this.load();
      const wb = XLSX.utils.book_new();
      sheets.forEach((sh) => {
        const ws = XLSX.utils.aoa_to_sheet(sh.rows);
        ws['!cols'] = (sh.rows[0] || []).map((h, i) => ({ wch: (sh.widths && sh.widths[i]) || Math.min(40, Math.max(8, ...sh.rows.slice(0, 200).map((r) => String(r[i] == null ? '' : r[i]).length * 1.6))) }));
        XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
      });
      if (SG.desktop) {
        const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
        return SG.desktop.saveFile(fileName, 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + b64);
      }
      XLSX.writeFile(wb, fileName);
    },
    // Reads the first sheet of .xlsx/.xls/.csv into an array of rows (strings).
    async readRows(file) {
      if (/\.csv$/i.test(file.name)) {
        let text = await file.text();
        if (text.includes('�')) { try { text = new TextDecoder('big5').decode(await file.arrayBuffer()); } catch (e) { /* keep */ } }
        return U.parseCsv(text);
      }
      const XLSX = await this.load();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' });
      return rows.map((r) => r.map((c) => (c instanceof Date ? U.ymd(c) : String(c)))).filter((r) => r.some((c) => c.trim() !== ''));
    }
  });

  // ====================================================== printing
  // Prints `bodyHtml` as a document (use the browser's "Save as PDF" for PDF).
  SG.print = function (title, bodyHtml, { landscape = false } = {}) {
    let area = UI.$('#print-area');
    if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
    const s = DB.settings();
    const store = SG.q.curStore();
    area.innerHTML = `<style>@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }</style>
      <div class="print-doc"><div class="pd-head"><div><div class="pd-org">${esc(s.orgName)}${store ? '・' + esc(store) : ''}</div><h1>${esc(title)}</h1></div>
      <div class="pd-date">列印日期 ${U.today()}<br>${esc(Auth.current ? Auth.current.name : '')}</div></div>${bodyHtml}</div>`;
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 1500); }, 80);
  };
  // Plain table for print documents.
  SG.printTable = (head, rows, { numCols = [] } = {}) => `<table class="pd-table"><thead><tr>${head.map((h, i) => `<th class="${numCols.includes(i) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numCols.includes(i) ? 'num' : ''}">${c == null ? '' : (typeof c === 'object' && c.html ? c.html : esc(c))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="pd-empty">無資料</td></tr>`}</tbody></table>`;
})();
