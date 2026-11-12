/* EPM.labels — QR code generation and printable equipment labels */
(function () {
  const S = EPM.storage;
  const DEFAULT_BASE_URL = 'https://wu8858009.github.io/equippro/';

  const SIZES = {
    small: { label: '小（40×30mm，每列 4 張）', cols: 4, w: 40, h: 30, qr: 22 },
    medium: { label: '中（63×38mm，每列 3 張）', cols: 3, w: 63, h: 38, qr: 30 },
    large: { label: '大（90×50mm，每列 2 張）', cols: 2, w: 90, h: 50, qr: 40 }
  };

  function settings() { return S.read(S.KEYS.settings, {}); }
  function baseUrl() {
    let u = (settings().qrBaseUrl || '').trim() || DEFAULT_BASE_URL;
    u = u.replace(/#.*$/, '');
    return u;
  }
  function equipmentUrl(eq) { return baseUrl() + '#/qr/' + encodeURIComponent(eq.id); }

  // Renders `text` as a crisp, scalable SVG (one <path> for all dark modules)
  // so labels print sharply at any size.
  function qrSvg(text, opts) {
    opts = opts || {};
    const qr = qrcode(0, opts.ecc || 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const margin = opts.margin === undefined ? 2 : opts.margin;
    const size = n + margin * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += 'M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" class="qr-svg">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  function esc(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function labelHtml(eq, sizeKey, opts) {
    const sz = SIZES[sizeKey] || SIZES.medium;
    opts = opts || {};
    const sub = [eq.department, eq.location].filter(Boolean).join(' · ');
    return `
      <div class="qr-label qr-label-${sizeKey}" style="width:${sz.w}mm;height:${sz.h}mm;">
        <div class="qr-label-code" style="width:${sz.qr}mm;height:${sz.qr}mm;">${qrSvg(equipmentUrl(eq))}</div>
        <div class="qr-label-text">
          ${opts.title ? `<div class="qr-label-org">${esc(opts.title)}</div>` : ''}
          <div class="qr-label-id">${esc(eq.code)}</div>
          <div class="qr-label-name">${esc(eq.name)}</div>
          ${sub && sizeKey !== 'small' ? `<div class="qr-label-sub">${esc(sub)}</div>` : ''}
        </div>
      </div>`;
  }

  // Prints only the labels: a print-only sheet is added to <body>, the app
  // UI is hidden for the print job, and the sheet is removed afterwards.
  function printLabels(items, sizeKey, opts) {
    if (!items || !items.length) return;
    const sz = SIZES[sizeKey] || SIZES.medium;
    let sheet = document.getElementById('label-print-root');
    if (sheet) sheet.remove();
    sheet = document.createElement('div');
    sheet.id = 'label-print-root';
    sheet.innerHTML = `<div class="qr-label-sheet" style="grid-template-columns:repeat(${sz.cols}, ${sz.w}mm);">
      ${items.map(eq => labelHtml(eq, sizeKey, opts)).join('')}</div>`;
    document.body.appendChild(sheet);
    document.body.classList.add('printing-labels');
    // The sheet is hidden on screen (CSS), so leaving it in place a little
    // too long is harmless; it just must be gone before the next print of a
    // regular report. Some WebViews never fire afterprint, so the next user
    // interaction after the dialog also cleans up.
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('printing-labels');
      sheet.remove();
      window.removeEventListener('afterprint', cleanup);
      document.removeEventListener('pointerdown', cleanup, true);
      document.removeEventListener('keydown', cleanup, true);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.addEventListener('pointerdown', cleanup, true);
        document.addEventListener('keydown', cleanup, true);
      }, 1000);
    }, 50);
  }

  window.EPM.labels = { SIZES, DEFAULT_BASE_URL, baseUrl, equipmentUrl, qrSvg, labelHtml, printLabels };
})();
