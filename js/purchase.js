/* 設備管家 — 請購單 (purchase requisition) printed in the same layout as the
   company's paper form, filled from a quote + the vendor directory. The
   print dialog's "Save as PDF" turns it into a PDF. */
(function () {
  'use strict';
  const SG = window.SG;
  const { util: U, db: DB, ui: UI, auth: Auth, q: Q } = SG;
  const esc = U.esc;

  const PAY_METHODS = ['現金', '匯款', '支票'];
  const PAY_UNITS = ['門市費用', '年度費用', '總公司'];

  // Invoice headers printed on the company's paper form (left column first three, right column the rest).
  const DEFAULT_INVOICES = [
    { name: '水灣企業(股)公司', taxId: '80424629' },
    { name: '榕堤水灣餐廳', taxId: '09878206' },
    { name: '水灣企業(股)公司新店分公司', taxId: '54736598' },
    { name: '榕堤水灣店', taxId: '87477121' },
    { name: '峇里水灣有限公司', taxId: '53690481' }
  ];

  // Settings for the form (stored with the other organisation settings).
  // Until someone saves their own list, the paper form's defaults are used.
  SG.prSettings = function () {
    const s = DB.get('settings', 'org') || {};
    return {
      prefix: s.prPrefix != null ? s.prPrefix : '水灣',
      unit: s.prUnit || DB.settings().orgName,
      logo: s.prLogo || '',
      invoices: Array.isArray(s.prInvoices) && s.prInvoices.length ? s.prInvoices : DEFAULT_INVOICES,
      version: s.prVersion != null ? s.prVersion : '20210321 第三版'
    };
  };
  SG.parseInvoices = (text) => String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)[\s：:]+([0-9]{8})$/.exec(l);
    return m ? { name: m[1].trim(), taxId: m[2] } : { name: l, taxId: '' };
  });

  const roc = (ymd) => {
    const d = U.parseDate(ymd) || new Date();
    return { y: d.getFullYear() - 1911, m: d.getMonth() + 1, d: d.getDate() };
  };
  const box = (on) => `<span class="pr-box ${on ? 'on' : ''}"></span>`;
  const n0 = (v) => (v === '' || v == null ? '' : Math.round(U.num(v)).toLocaleString('zh-TW'));

  function vendorOf(name) { return DB.all('vendors').find((v) => v.name === name) || null; }
  function partsOf(q) {
    const t = U.tax(q.amount != null ? q.amount : q.priceIncl, q.taxMode || 'incl', q.taxRate == null ? 5 : q.taxRate);
    return t;
  }

  // ------------------------------------------------------------ the printed form
  function formHtml(q, pr) {
    const cfg = SG.prSettings();
    const v = vendorOf(q.vendor) || {};
    const t = partsOf(q);
    const qty = U.num(pr.qty) || 1;
    const total = q.taxMode === 'excl' ? t.excl : t.incl;
    const unitPrice = total / qty;
    const date = roc(pr.date);
    const lines = [{ text: pr.itemText || q.item, price: unitPrice, qty, unit: pr.unit || '台', total }];
    while (lines.length < 6) lines.push(null);
    const invoices = cfg.invoices.length ? cfg.invoices : [];
    // Like the paper form: first half of the companies on the left, the rest plus 其他／無發票 on the right.
    const invHalf = invoices.length ? Math.ceil(invoices.length / 2) : 1;
    const invItems = [...invoices.map((x, i) => ({ key: 'i' + i, label: x.name + (x.taxId ? '：' + x.taxId : '') })), { key: 'other', label: '其他：' + (pr.invoice === 'other' ? esc(pr.invoiceOther || '') : '') }, { key: 'none', label: '無發票' }];
    const invCol = (arr) => arr.map((x) => `<div class="pr-chk">${box(pr.invoice === x.key)}${x.key === 'other' ? x.label : esc(x.label)}</div>`).join('');
    const op = pr.opinion || '';
    return `<div class="pr-doc">
      <div class="pr-top">
        ${cfg.logo ? `<img class="pr-logo" src="${cfg.logo}" alt="">` : ''}
        <div class="pr-title">請購單</div>
      </div>
      <div class="pr-sub">
        <div>${esc(cfg.prefix)}請購字第 <u class="pr-no">${esc(pr.no || '')}</u> 號</div>
        <div>填寫日期：<u>${date.y}</u> 年 <u>${date.m}</u> 月 <u>${date.d}</u> 日</div>
      </div>
      <table class="pr-t">
        <tr><td class="pr-unit"><b>申請單位：</b><span class="pr-fill">${esc(pr.unitName || cfg.unit)}</span></td></tr>
      </table>
      <table class="pr-t pr-items">
        <colgroup><col style="width:52%"><col style="width:13%"><col style="width:9%"><col style="width:9%"><col style="width:17%"></colgroup>
        <tr class="pr-h"><th>請購廠牌／品名／規格</th><th>單價</th><th>數量</th><th>單位</th><th>總價</th></tr>
        ${lines.map((l) => `<tr class="pr-line"><td class="pr-fill">${l ? esc(l.text).replace(/\n/g, '<br>') : ''}</td><td class="num pr-fill">${l ? n0(l.price) : ''}</td><td class="c pr-fill">${l ? l.qty : ''}</td><td class="c pr-fill">${l ? esc(l.unit) : ''}</td><td class="num pr-fill">${l ? n0(l.total) : ''}</td></tr>`).join('')}
        <tr class="pr-sum"><td class="r">小計</td><td colspan="3"></td><td class="num pr-fill">${n0(q.taxMode === 'excl' ? t.excl : t.incl)}</td></tr>
        <tr><td class="r">稅金</td><td colspan="3"></td><td class="num pr-fill">${q.taxMode === 'excl' ? n0(t.tax) : '已含稅'}</td></tr>
        <tr><td class="r">合計數量／總金額</td><td colspan="3" class="c pr-fill">${qty}</td><td class="num pr-fill">${n0(t.incl)}</td></tr>
      </table>
      <table class="pr-t pr-vendor">
        <colgroup><col style="width:5%"><col style="width:14%"><col style="width:36%"><col style="width:16%"><col style="width:29%"></colgroup>
        <tr><td rowspan="6" class="pr-vert">廠商資料</td><td class="lab">廠商名稱</td><td class="pr-fill">${esc(q.vendor)}</td><td class="lab">廠商聯絡人</td><td class="pr-fill">${esc(pr.contact || v.contact || q.contact || '')}</td></tr>
        <tr><td class="lab">聯絡電話</td><td class="pr-fill">${esc(v.phone || v.mobile || '')}</td><td class="lab">傳　　真</td><td class="pr-fill">${esc(v.fax || '')}</td></tr>
        <tr><td class="lab">廠商地址</td><td colspan="3" class="pr-fill">${esc(v.address || '')}</td></tr>
        <tr><td class="lab" rowspan="3">付款方式</td><td colspan="3"><span class="pr-chk">${box(pr.payMethod === '現金')}現金</span><span class="pr-chk">${box(pr.payMethod === '匯款')}匯款</span><span class="pr-chk">${box(pr.payMethod === '支票')}支票：抬頭 <u class="pr-fill pr-line-u">${esc(pr.payMethod === '支票' ? (pr.chequeTo || q.vendor) : '')}</u></span></td></tr>
        <tr><td colspan="3">匯款銀行：<span class="pr-fill">${pr.payMethod === '匯款' ? esc(v.bank || '') : ''}</span></td></tr>
        <tr><td colspan="3"><div>戶　　名：<span class="pr-fill">${pr.payMethod === '匯款' ? esc(v.accountName || '') : ''}</span></div><div class="pr-acc">帳　　號：<span class="pr-fill">${pr.payMethod === '匯款' ? esc(v.accountNo || '') : ''}</span></div></td></tr>
      </table>
      <table class="pr-t">
        <colgroup><col style="width:19%"><col style="width:81%"></colgroup>
        <tr><td class="lab c">付款單位</td><td>
          <span class="pr-chk">${box(pr.payUnit === '門市費用')}門市費用：<u class="pr-fill pr-line-u">${pr.payUnit === '門市費用' ? esc(pr.payStore || cfg.unit) : ''}</u></span>
          <span class="pr-chk">${box(pr.payUnit === '年度費用')}年度費用：<u class="pr-fill pr-line-u">${pr.payUnit === '年度費用' ? esc(pr.payStore || '') : ''}</u> 店</span>
          <span class="pr-chk">${box(pr.payUnit === '總公司')}總公司</span></td></tr>
        <tr><td class="lab c">發票抬頭</td><td><div class="pr-inv"><div>${invCol(invItems.slice(0, invHalf))}</div><div>${invCol(invItems.slice(invHalf))}</div></div></td></tr>
      </table>
      <table class="pr-t">
        <tr><td class="pr-purpose"><b>簡述請購用途：</b><span class="pr-fill">${esc(pr.purpose || '').replace(/\n/g, '<br>')}</span></td></tr>
        <tr><td><b>預計交貨日期：</b><span class="pr-fill">${esc(pr.delivery || '')}</span></td></tr>
      </table>
      <table class="pr-t">
        <tr><td class="c"><b>意見欄</b>（由簽核主管填寫）</td></tr>
        <tr><td class="pr-op"><span class="pr-chk">${box(op === '同意採購')}同意採購</span><span class="pr-chk">${box(op === '暫緩')}暫緩</span><span class="pr-chk">${box(op === '不同意')}不同意</span>
          <div>其他意見：<span class="pr-fill">${esc(pr.comment || '')}</span></div></td></tr>
      </table>
      <table class="pr-t pr-sign">
        <colgroup><col style="width:11%"><col style="width:22%"><col style="width:11%"><col style="width:22%"><col style="width:11%"><col style="width:23%"></colgroup>
        <tr><td class="lab c">申請人</td><td class="pr-fill pr-sigcell">${esc(pr.applicant || '')}${pr.applicant ? `<small>${date.m}/${date.d}</small>` : ''}</td><td class="lab c">店經理<br>覆核</td><td></td><td class="lab c">督導<br>覆核</td><td></td></tr>
        <tr><td class="lab c">經辦</td><td class="pr-fill pr-sigcell">${esc(pr.handler || '')}</td><td class="lab c">覆核</td><td></td><td class="lab c">核准</td><td></td></tr>
      </table>
      <div class="pr-foot">${cfg.version ? '版次：' + esc(cfg.version) : ''}<span>設備管家 PRO 列印</span></div>
    </div>`;
  }

  // ------------------------------------------------------------ fill-in dialog
  SG.purchaseForm = function (quoteId) {
    const q = DB.get('quotes', quoteId);
    if (!q) return;
    const cfg = SG.prSettings();
    const eq = q.equipmentId ? DB.get('equipment', q.equipmentId) : null;
    const lastRepair = eq ? DB.all('repairs').filter((r) => r.equipmentId === eq.id).sort((a, b) => b.reportedAt - a.reportedAt)[0] : null;
    const v = vendorOf(q.vendor) || {};
    const prev = q.pr || {};
    const invOpts = [...cfg.invoices.map((x, i) => ({ value: 'i' + i, label: x.name + (x.taxId ? '（' + x.taxId + '）' : '') })), { value: 'other', label: '其他（自行填寫）' }, { value: 'none', label: '無發票' }];
    const values = Object.assign({
      no: '', date: U.today(), unitName: (eq && eq.store) || Q.curStore() || cfg.unit,
      itemText: q.item + (q.note ? '\n' + q.note : ''), qty: 1, unit: '台',
      payMethod: v.accountNo ? '匯款' : '', chequeTo: q.vendor,
      payUnit: '門市費用', payStore: (eq && eq.store) || Q.curStore() || cfg.unit,
      invoice: cfg.invoices.length ? 'i0' : 'other', invoiceOther: '',
      purpose: lastRepair ? `${lastRepair.title}${lastRepair.desc ? '：' + lastRepair.desc : ''}` : (eq ? `${eq.name}更換` : ''),
      delivery: '', contact: v.contact || q.contact || '',
      applicant: Auth.current.name, handler: '', opinion: '', comment: ''
    }, SG.store.get('sg_pr_last') || {}, prev); // last used payment unit / invoice header carry over
    const fields = [
      { type: 'section', label: '表頭' },
      { name: 'no', label: '請購字號（第＿號）', placeholder: '可留空' },
      { name: 'date', label: '填寫日期', type: 'date' },
      { name: 'unitName', label: '申請單位', span: 2 },
      { type: 'section', label: '品項（帶入報價：' + q.vendor + ' ' + U.money(partsOf(q).incl) + '）' },
      { name: 'itemText', label: '請購廠牌／品名／規格', type: 'textarea', rows: 2, span: 2 },
      { name: 'qty', label: '數量', type: 'number', min: 1 },
      { name: 'unit', label: '單位', list: ['台', '組', '個', '件', '式', '批', '支', '片'] },
      { type: 'section', label: '付款' },
      { name: 'payMethod', label: '付款方式', type: 'select', options: [{ value: '', label: '（不勾選）' }, ...PAY_METHODS] },
      { name: 'chequeTo', label: '支票抬頭（付款方式為支票時）' },
      { name: 'payUnit', label: '付款單位', type: 'select', options: PAY_UNITS },
      { name: 'payStore', label: '門市／店名' },
      { name: 'invoice', label: '發票抬頭', type: 'select', options: invOpts },
      { name: 'invoiceOther', label: '其他發票抬頭（選「其他」時）' },
      { type: 'section', label: '用途與簽核' },
      { name: 'purpose', label: '簡述請購用途', type: 'textarea', rows: 2, span: 2 },
      { name: 'delivery', label: '預計交貨日期／狀態', placeholder: '例如：11 月 20 日、已完工' },
      { name: 'contact', label: '廠商聯絡人' },
      { name: 'applicant', label: '申請人' },
      { name: 'handler', label: '經辦' },
      { name: 'opinion', label: '意見欄（主管）', type: 'select', options: [{ value: '', label: '（空白，交給主管勾選）' }, '同意採購', '暫緩', '不同意'] },
      { name: 'comment', label: '其他意見' },
      { type: 'html', html: `<p class="small muted">${v.name ? '' : '⚠️ 廠商通訊錄還沒有「' + esc(q.vendor) + '」，電話、地址、匯款帳號會空白。'}設定頁可以上傳公司 Logo、設定請購字號前綴和發票抬頭清單。</p>` }
    ];
    UI.formModal({
      title: '🧾 請購單：' + q.item, fields, values, saveLabel: '🖨️ 列印／存成 PDF',
      extraActions: [{ label: '預覽', onClick: (api) => { const pr = UI.readForm(api.body, fields); preview(q, pr); return false; } }],
      onSave(pr) {
        DB.put('quotes', Object.assign({}, q, { pr }), { quiet: true });
        SG.store.set('sg_pr_last', { payUnit: pr.payUnit, payStore: pr.payStore, invoice: pr.invoice, invoiceOther: pr.invoiceOther, payMethod: pr.payMethod });
        SG.log('列印請購單', `${q.item}／${q.vendor}`);
        print(q, pr);
      }
    });
  };

  function fileTitle(q, pr) { return `請購單_${q.item}_${q.vendor}_${(pr.date || U.today()).replace(/-/g, '')}`; }
  function print(q, pr) { SG.print(fileTitle(q, pr), formHtml(q, pr), { bare: true, margin: '9mm 10mm' }); }
  function preview(q, pr) {
    const m = UI.modal({ title: '請購單預覽', wide: true, body: `<div class="pr-preview">${formHtml(q, pr)}</div>`, actions: [{ label: '關閉' }, { label: '🖨️ 列印／存成 PDF', kind: 'primary', onClick: () => { print(q, pr); } }] });
    m.el.classList.add('pr-modal');
  }
  SG.purchaseHtml = formHtml; // for tests
})();
