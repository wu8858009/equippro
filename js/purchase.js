/* 設備管家 — quotes entered on a 請購單 (purchase requisition) laid out exactly
   like the company's paper form. The same data prints (or saves as PDF) in
   that layout. A quote = one vendor's offer; quotes with the same 報價項目
   are compared on the 報價比價 page. */
(function () {
  'use strict';
  const SG = window.SG;
  const { util: U, db: DB, ui: UI, auth: Auth, q: Q, forms: F } = SG;
  const esc = U.esc;
  const LINES = 6;

  // Invoice headers printed on the company's paper form (left column first three, right column the rest).
  const DEFAULT_INVOICES = [
    { name: '水灣企業(股)公司', taxId: '80424629' },
    { name: '榕堤水灣餐廳', taxId: '09878206' },
    { name: '水灣企業(股)公司新店分公司', taxId: '54736598' },
    { name: '榕堤水灣店', taxId: '87477121' },
    { name: '峇里水灣有限公司', taxId: '53690481' }
  ];

  // Settings for the form; until someone saves their own, the paper form's defaults are used.
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
  const fromRoc = (y, m, d) => {
    const yy = U.num(y) + 1911, mm = U.num(m), dd = U.num(d);
    if (!U.num(y) || !mm || !dd) return U.today();
    return `${yy}-${U.pad(mm)}-${U.pad(dd)}`;
  };
  const n0 = (v) => (v === '' || v == null ? '' : Math.round(U.num(v)).toLocaleString('zh-TW'));
  const box = (on) => `<span class="pr-box ${on ? 'on' : ''}"></span>`;
  const vendorOf = (name) => DB.all('vendors').find((v) => v.name === name) || null;

  // ------------------------------------------------------------ data
  // Everything the form shows, from a quote (old quotes without form data still work).
  function normalize(q, preset = {}) {
    q = q || {};
    const pr = Object.assign({}, q.pr || {});
    const v = vendorOf(q.vendor) || {};
    const cfg = SG.prSettings();
    let lines = Array.isArray(pr.lines) && pr.lines.length ? pr.lines.map((l) => Object.assign({}, l)) : null;
    if (!lines) {
      const qty = U.num(pr.qty) || 1;
      lines = q.item || q.amount ? [{ text: pr.itemText || ((q.item || '') + (q.note ? '\n' + q.note : '')), price: q.amount !== '' && q.amount != null ? U.num(q.amount) / qty : '', qty, unit: pr.unit || '台' }] : [];
    }
    while (lines.length < LINES) lines.push({ text: '', price: '', qty: '', unit: '' });
    const sign = Object.assign({ applicant: pr.applicant || '', handler: pr.handler || '' }, pr.sign || {});
    return Object.assign({
      no: '', date: pr.formDate || pr.date || q.date || U.today(), unitName: cfg.unit,
      taxMode: q.taxMode || 'incl', taxRate: q.taxRate == null || q.taxRate === '' ? 5 : q.taxRate,
      vendor: q.vendor || '', contact: q.contact || v.contact || '', phone: v.phone || v.mobile || '', fax: v.fax || '', address: v.address || '',
      payMethod: '', chequeTo: '', bank: v.bank || '', accountName: v.accountName || '', accountNo: v.accountNo || '',
      payUnit: '門市費用', payStore: Q.curStore() || cfg.unit, annualStore: '',
      invoice: 'i0', invoiceOther: '', purpose: '', delivery: '', opinion: '', comment: ''
    }, SG.store.get('sg_pr_last') || {}, preset, pr, { lines, sign });
  }
  function totals(d) {
    let sum = 0, qty = 0;
    d.lines.forEach((l) => {
      const p = U.num(l.price), n = l.qty === '' || l.qty == null ? (p ? 1 : 0) : U.num(l.qty);
      if (p || n) { sum += p * n; qty += n; }
    });
    const rate = U.num(d.taxRate);
    const tax = d.taxMode === 'excl' ? Math.round(sum * rate / 100) : 0;
    return { sum, qty, tax, total: sum + tax };
  }
  const lineTotal = (l) => (U.num(l.price) ? U.num(l.price) * (l.qty === '' || l.qty == null ? 1 : U.num(l.qty)) : '');

  // ------------------------------------------------------------ printed form
  function formHtml(d) {
    const cfg = SG.prSettings();
    const t = totals(d);
    const date = roc(d.date);
    const invs = cfg.invoices;
    const half = invs.length ? Math.ceil(invs.length / 2) : 1;
    const invItems = [...invs.map((x, i) => ({ key: 'i' + i, label: esc(x.name) + (x.taxId ? '：' + esc(x.taxId) : '') })),
      { key: 'other', label: '其他：' + (d.invoice === 'other' ? `<span class="pr-fill">${esc(d.invoiceOther || '')}</span>` : '') }, { key: 'none', label: '無發票' }];
    const invCol = (arr) => arr.map((x) => `<div class="pr-chk">${box(d.invoice === x.key)}${x.label}</div>`).join('');
    const s = d.sign || {};
    const sig = (k) => `<td class="pr-fill pr-sigcell">${esc(s[k] || '')}${k === 'applicant' && s[k] ? `<small>${date.m}/${date.d}</small>` : ''}</td>`;
    return `<div class="pr-doc">
      <div class="pr-top">${cfg.logo ? `<img class="pr-logo" src="${cfg.logo}" alt="">` : ''}<div class="pr-title">請購單</div></div>
      <div class="pr-sub">
        <div>${esc(cfg.prefix)}請購字第 <u class="pr-no">${esc(d.no || '')}</u> 號</div>
        <div>填寫日期：<u>${date.y}</u> 年 <u>${date.m}</u> 月 <u>${date.d}</u> 日</div>
      </div>
      <table class="pr-t"><tr><td class="pr-unit"><b>申請單位：</b><span class="pr-fill">${esc(d.unitName || '')}</span></td></tr></table>
      <table class="pr-t pr-items">
        <colgroup><col style="width:52%"><col style="width:13%"><col style="width:9%"><col style="width:9%"><col style="width:17%"></colgroup>
        <tr class="pr-h"><th>請購廠牌／品名／規格</th><th>單價</th><th>數量</th><th>單位</th><th>總價</th></tr>
        ${d.lines.map((l) => `<tr class="pr-line"><td class="pr-fill">${esc(l.text || '').replace(/\n/g, '<br>')}</td><td class="num pr-fill">${n0(l.price)}</td><td class="c pr-fill">${l.price || l.text ? esc(l.qty === '' || l.qty == null ? (l.price ? 1 : '') : l.qty) : ''}</td><td class="c pr-fill">${esc(l.unit || '')}</td><td class="num pr-fill">${n0(lineTotal(l))}</td></tr>`).join('')}
        <tr class="pr-sum"><td class="r">小計</td><td colspan="3"></td><td class="num pr-fill">${n0(t.sum)}</td></tr>
        <tr><td class="r">稅金</td><td colspan="3"></td><td class="num pr-fill">${d.taxMode === 'excl' ? n0(t.tax) : '已含稅'}</td></tr>
        <tr><td class="r">合計數量／總金額</td><td colspan="3" class="c pr-fill">${t.qty || ''}</td><td class="num pr-fill">${n0(t.total)}</td></tr>
      </table>
      <table class="pr-t pr-vendor">
        <colgroup><col style="width:5%"><col style="width:14%"><col style="width:36%"><col style="width:16%"><col style="width:29%"></colgroup>
        <tr><td rowspan="6" class="pr-vert">廠商資料</td><td class="lab">廠商名稱</td><td class="pr-fill">${esc(d.vendor)}</td><td class="lab">廠商聯絡人</td><td class="pr-fill">${esc(d.contact)}</td></tr>
        <tr><td class="lab">聯絡電話</td><td class="pr-fill">${esc(d.phone)}</td><td class="lab">傳　　真</td><td class="pr-fill">${esc(d.fax)}</td></tr>
        <tr><td class="lab">廠商地址</td><td colspan="3" class="pr-fill">${esc(d.address)}</td></tr>
        <tr><td class="lab" rowspan="3">付款方式</td><td colspan="3"><span class="pr-chk">${box(d.payMethod === '現金')}現金</span><span class="pr-chk">${box(d.payMethod === '匯款')}匯款</span><span class="pr-chk">${box(d.payMethod === '支票')}支票：抬頭 <u class="pr-fill pr-line-u">${esc(d.chequeTo || '')}</u></span></td></tr>
        <tr><td colspan="3">匯款銀行：<span class="pr-fill">${esc(d.bank)}</span></td></tr>
        <tr><td colspan="3"><div>戶　　名：<span class="pr-fill">${esc(d.accountName)}</span></div><div class="pr-acc">帳　　號：<span class="pr-fill">${esc(d.accountNo)}</span></div></td></tr>
      </table>
      <table class="pr-t">
        <colgroup><col style="width:19%"><col style="width:81%"></colgroup>
        <tr><td class="lab c">付款單位</td><td>
          <span class="pr-chk">${box(d.payUnit === '門市費用')}門市費用：<u class="pr-fill pr-line-u">${d.payUnit === '門市費用' ? esc(d.payStore || '') : ''}</u></span>
          <span class="pr-chk">${box(d.payUnit === '年度費用')}年度費用：<u class="pr-fill pr-line-u">${d.payUnit === '年度費用' ? esc(d.annualStore || '') : ''}</u> 店</span>
          <span class="pr-chk">${box(d.payUnit === '總公司')}總公司</span></td></tr>
        <tr><td class="lab c">發票抬頭</td><td><div class="pr-inv"><div>${invCol(invItems.slice(0, half))}</div><div>${invCol(invItems.slice(half))}</div></div></td></tr>
      </table>
      <table class="pr-t">
        <tr><td class="pr-purpose"><b>簡述請購用途：</b><span class="pr-fill">${esc(d.purpose || '').replace(/\n/g, '<br>')}</span></td></tr>
        <tr><td><b>預計交貨日期：</b><span class="pr-fill">${esc(d.delivery || '')}</span></td></tr>
      </table>
      <table class="pr-t">
        <tr><td class="c"><b>意見欄</b>（由簽核主管填寫）</td></tr>
        <tr><td class="pr-op"><span class="pr-chk">${box(d.opinion === '同意採購')}同意採購</span><span class="pr-chk">${box(d.opinion === '暫緩')}暫緩</span><span class="pr-chk">${box(d.opinion === '不同意')}不同意</span>
          <div>其他意見：<span class="pr-fill">${esc(d.comment || '')}</span></div></td></tr>
      </table>
      <table class="pr-t pr-sign">
        <colgroup><col style="width:11%"><col style="width:22%"><col style="width:11%"><col style="width:22%"><col style="width:11%"><col style="width:23%"></colgroup>
        <tr><td class="lab c">申請人</td>${sig('applicant')}<td class="lab c">店經理<br>覆核</td>${sig('manager')}<td class="lab c">督導<br>覆核</td>${sig('supervisor')}</tr>
        <tr><td class="lab c">經辦</td>${sig('handler')}<td class="lab c">覆核</td>${sig('review')}<td class="lab c">核准</td>${sig('approve')}</tr>
      </table>
      <div class="pr-foot">${cfg.version ? '版次：' + esc(cfg.version) : ''}<span>設備管家 PRO 列印</span></div>
    </div>`;
  }

  // ------------------------------------------------------------ the form you type into
  function editorHtml(d) {
    const cfg = SG.prSettings();
    const date = roc(d.date);
    const inp = (k, ph = '', cls = '') => `<input class="pe-in ${cls}" data-k="${k}" value="${esc(d[k] == null ? '' : d[k])}" placeholder="${esc(ph)}" autocomplete="off">`;
    const radio = (k, val, label) => `<label class="pr-chk pe-r"><input type="radio" name="pe-${k}" data-k="${k}" value="${esc(val)}" ${d[k] === val ? 'checked' : ''}>${label}</label>`;
    const invs = cfg.invoices;
    const half = invs.length ? Math.ceil(invs.length / 2) : 1;
    const invItems = [...invs.map((x, i) => radio('invoice', 'i' + i, esc(x.name) + (x.taxId ? '：' + esc(x.taxId) : ''))),
      `<label class="pr-chk pe-r"><input type="radio" name="pe-invoice" data-k="invoice" value="other" ${d.invoice === 'other' ? 'checked' : ''}>其他：${inp('invoiceOther', '', 'pe-short')}</label>`,
      radio('invoice', 'none', '無發票')];
    const sigIn = (k) => `<td class="pe-sig"><input class="pe-in pe-c" data-s="${k}" value="${esc((d.sign || {})[k] || '')}" placeholder="簽名"></td>`;
    const vendors = DB.all('vendors').map((v) => v.name).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    return `<div class="pr-doc pr-edit">
      <div class="pr-top">${cfg.logo ? `<img class="pr-logo" src="${cfg.logo}" alt="">` : ''}<div class="pr-title">請購單</div></div>
      <div class="pr-sub">
        <div>${esc(cfg.prefix)}請購字第 ${inp('no', '', 'pe-no')} 號</div>
        <div>填寫日期：<input class="pe-in pe-d" data-date="y" value="${date.y}" inputmode="numeric"> 年 <input class="pe-in pe-d2" data-date="m" value="${date.m}" inputmode="numeric"> 月 <input class="pe-in pe-d2" data-date="d" value="${date.d}" inputmode="numeric"> 日</div>
      </div>
      <table class="pr-t"><tr><td class="pr-unit"><b>申請單位：</b>${inp('unitName', '例如：碧水堂', 'pe-wide')}</td></tr></table>
      <table class="pr-t pr-items">
        <colgroup><col style="width:52%"><col style="width:13%"><col style="width:9%"><col style="width:9%"><col style="width:17%"></colgroup>
        <tr class="pr-h"><th>請購廠牌／品名／規格</th><th>單價</th><th>數量</th><th>單位</th><th>總價</th></tr>
        ${d.lines.map((l, i) => `<tr class="pr-line pe-line">
          <td data-lab="品名 ${i + 1}"><textarea class="pe-in pe-text" data-l="${i}.text" rows="1" placeholder="${i === 0 ? '例如：櫻花牌熱水器16公升強制排氣' : ''}">${esc(l.text || '')}</textarea></td>
          <td data-lab="單價"><input class="pe-in pe-n" data-l="${i}.price" value="${esc(l.price === '' || l.price == null ? '' : Math.round(U.num(l.price) * 100) / 100)}" inputmode="decimal"></td>
          <td data-lab="數量"><input class="pe-in pe-c" data-l="${i}.qty" value="${esc(l.qty == null ? '' : l.qty)}" inputmode="decimal"></td>
          <td data-lab="單位"><input class="pe-in pe-c" data-l="${i}.unit" value="${esc(l.unit || '')}" list="pe-units"></td>
          <td class="num pr-fill pe-total" data-lt="${i}" data-lab="總價"></td></tr>`).join('')}
        <tr class="pr-sum"><td class="r">小計</td><td colspan="3"></td><td class="num pr-fill" id="pe-sum"></td></tr>
        <tr><td class="r">稅金</td><td colspan="3" class="pe-taxcell"><select class="pe-in pe-sel" data-k="taxMode"><option value="incl" ${d.taxMode !== 'excl' ? 'selected' : ''}>已含稅</option><option value="excl" ${d.taxMode === 'excl' ? 'selected' : ''}>未稅，外加稅</option></select>
          <span class="pe-rate" ${d.taxMode === 'excl' ? '' : 'hidden'}><input class="pe-in pe-c pe-short2" data-k="taxRate" value="${esc(d.taxRate)}" inputmode="decimal">%</span></td><td class="num pr-fill" id="pe-tax"></td></tr>
        <tr><td class="r">合計數量／總金額</td><td colspan="3" class="c pr-fill" id="pe-qty"></td><td class="num pr-fill" id="pe-total"></td></tr>
      </table>
      <datalist id="pe-units">${['台', '組', '個', '件', '式', '批', '支', '片', '套', '條'].map((u) => `<option value="${u}">`).join('')}</datalist>
      <datalist id="pe-vendors">${vendors.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      <table class="pr-t pr-vendor">
        <colgroup><col style="width:5%"><col style="width:14%"><col style="width:36%"><col style="width:16%"><col style="width:29%"></colgroup>
        <tr><td rowspan="6" class="pr-vert">廠商資料</td><td class="lab">廠商名稱</td><td><input class="pe-in" data-k="vendor" value="${esc(d.vendor)}" list="pe-vendors" placeholder="必填，可從廠商通訊錄選"></td><td class="lab">廠商聯絡人</td><td>${inp('contact')}</td></tr>
        <tr><td class="lab">聯絡電話</td><td>${inp('phone')}</td><td class="lab">傳　　真</td><td>${inp('fax')}</td></tr>
        <tr><td class="lab">廠商地址</td><td colspan="3">${inp('address')}</td></tr>
        <tr><td class="lab" rowspan="3">付款方式</td><td colspan="3">${radio('payMethod', '現金', '現金')}${radio('payMethod', '匯款', '匯款')}${radio('payMethod', '支票', '支票：抬頭')}${inp('chequeTo', '', 'pe-mid')}</td></tr>
        <tr><td colspan="3">匯款銀行：${inp('bank', '', 'pe-mid')}</td></tr>
        <tr><td colspan="3"><div>戶　　名：${inp('accountName', '', 'pe-mid')}</div><div class="pr-acc">帳　　號：${inp('accountNo', '', 'pe-mid')}</div></td></tr>
      </table>
      <table class="pr-t">
        <colgroup><col style="width:19%"><col style="width:81%"></colgroup>
        <tr><td class="lab c">付款單位</td><td class="pe-payunit">${radio('payUnit', '門市費用', '門市費用：')}${inp('payStore', '', 'pe-mid')}
          ${radio('payUnit', '年度費用', '年度費用：')}${inp('annualStore', '', 'pe-short')} 店　${radio('payUnit', '總公司', '總公司')}</td></tr>
        <tr><td class="lab c">發票抬頭</td><td><div class="pr-inv"><div>${invItems.slice(0, half).join('')}</div><div>${invItems.slice(half).join('')}</div></div></td></tr>
      </table>
      <table class="pr-t">
        <tr><td class="pr-purpose"><b>簡述請購用途：</b><textarea class="pe-in pe-text" data-k="purpose" rows="2">${esc(d.purpose || '')}</textarea></td></tr>
        <tr><td><b>預計交貨日期：</b>${inp('delivery', '例如：11 月 20 日、已完工', 'pe-wide')}</td></tr>
      </table>
      <table class="pr-t">
        <tr><td class="c"><b>意見欄</b>（由簽核主管填寫）</td></tr>
        <tr><td class="pr-op">${radio('opinion', '同意採購', '同意採購')}${radio('opinion', '暫緩', '暫緩')}${radio('opinion', '不同意', '不同意')}
          <div>其他意見：${inp('comment', '', 'pe-wide')}</div></td></tr>
      </table>
      <table class="pr-t pr-sign">
        <colgroup><col style="width:11%"><col style="width:22%"><col style="width:11%"><col style="width:22%"><col style="width:11%"><col style="width:23%"></colgroup>
        <tr><td class="lab c">申請人</td>${sigIn('applicant')}<td class="lab c">店經理<br>覆核</td>${sigIn('manager')}<td class="lab c">督導<br>覆核</td>${sigIn('supervisor')}</tr>
        <tr><td class="lab c">經辦</td>${sigIn('handler')}<td class="lab c">覆核</td>${sigIn('review')}<td class="lab c">核准</td>${sigIn('approve')}</tr>
      </table>
      <div class="pr-foot">${cfg.version ? '版次：' + esc(cfg.version) : ''}<span></span></div>
    </div>`;
  }

  // Read the typed-in form back into the data object.
  function readEditor(root, d) {
    const out = Object.assign({}, d, { lines: d.lines.map((l) => Object.assign({}, l)), sign: Object.assign({}, d.sign) });
    UI.$$('[data-k]', root).forEach((el) => {
      if (el.type === 'radio') { if (el.checked) out[el.dataset.k] = el.value; return; }
      out[el.dataset.k] = el.value.trim();
    });
    ['payMethod', 'payUnit', 'invoice', 'opinion'].forEach((k) => { if (!UI.$(`[data-k="${k}"]:checked`, root)) out[k] = ''; });
    UI.$$('[data-l]', root).forEach((el) => {
      const [i, f] = el.dataset.l.split('.');
      out.lines[+i][f] = f === 'text' || f === 'unit' ? el.value.trim() : (el.value.trim() === '' ? '' : U.num(el.value));
    });
    UI.$$('[data-s]', root).forEach((el) => (out.sign[el.dataset.s] = el.value.trim()));
    const ds = {}; UI.$$('[data-date]', root).forEach((el) => (ds[el.dataset.date] = el.value));
    out.date = fromRoc(ds.y, ds.m, ds.d);
    return out;
  }

  // ------------------------------------------------------------ quote editor (replaces the plain form)
  F.quote = function (existing, preset = {}) {
    const isNew = !existing;
    const eq = (existing && existing.equipmentId) || preset.equipmentId ? DB.get('equipment', (existing && existing.equipmentId) || preset.equipmentId) : null;
    const lastRepair = eq ? DB.all('repairs').filter((r) => r.equipmentId === eq.id).sort((a, b) => b.reportedAt - a.reportedAt)[0] : null;
    const base = existing || { item: preset.item || '', vendor: preset.vendor || '', taxMode: 'incl', taxRate: 5, date: U.today() };
    let d = normalize(base, isNew ? {
      unitName: (eq && eq.store) || Q.curStore() || SG.prSettings().unit,
      purpose: lastRepair ? `${lastRepair.title}${lastRepair.desc ? '：' + lastRepair.desc : ''}` : '',
      sign: { applicant: Auth.current.name }
    } : {});
    if (isNew && !d.sign.applicant) d.sign.applicant = Auth.current.name;
    if (isNew && preset.item && !d.lines[0].text) d.lines[0].text = preset.item;
    const items = [...new Set(DB.all('quotes').map((x) => x.item))].sort();
    const eqOpts = F.eqOptions((existing && existing.equipmentId) || preset.equipmentId || '', '（不指定）');
    const meta = Object.assign({ item: base.item || preset.item || '', date: base.date || U.today(), validUntil: base.validUntil || '', equipmentId: base.equipmentId || preset.equipmentId || '', adopted: !!base.adopted }, {});
    const m = UI.modal({
      title: isNew ? '新增報價（請購單）' : '編輯報價（請購單）', wide: true,
      body: `<div class="pe-wrap">${editorHtml(d)}</div>
        <div class="pe-meta card">
          <div class="card-head"><h2>比價設定</h2><span class="small muted">同一個「報價項目」的各家報價會放在一起比價</span></div>
          <div class="form-grid">
            <div class="field"><label>報價項目 <b class="req">*</b></label><input id="pm-item" value="${esc(meta.item)}" list="pm-items" placeholder="留空就用第一個品名"><datalist id="pm-items">${items.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
            <div class="field"><label>相關設備（可不選）</label><select id="pm-eq">${eqOpts.map((o) => `<option value="${esc(o.value)}" ${o.value === meta.equipmentId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
            <div class="field"><label>報價日期</label><input id="pm-date" type="date" value="${esc(meta.date)}"></div>
            <div class="field"><label>報價有效期限</label><input id="pm-valid" type="date" value="${esc(meta.validUntil)}"></div>
            <div class="field span-2"><label class="check"><input type="checkbox" id="pm-adopted" ${meta.adopted ? 'checked' : ''}> <span>已採用這家報價</span></label></div>
          </div>
        </div>`,
      actions: [
        { label: '取消' },
        { label: '預覽', onClick: () => { preview(readEditor(m.body, d)); return false; } },
        { label: '儲存', kind: '', onClick: () => save(false) },
        { label: '🖨️ 儲存並列印', kind: 'primary', onClick: () => save(true) }
      ]
    });
    m.el.classList.add('pe-modal');
    const root = m.body;

    // live totals
    const recalc = () => {
      const cur = readEditor(root, d);
      const t = totals(cur);
      cur.lines.forEach((l, i) => (UI.$(`[data-lt="${i}"]`, root).textContent = n0(lineTotal(l))));
      UI.$('#pe-sum', root).textContent = n0(t.sum);
      UI.$('#pe-tax', root).textContent = cur.taxMode === 'excl' ? n0(t.tax) : '已含稅';
      UI.$('#pe-qty', root).textContent = t.qty || '';
      UI.$('#pe-total', root).textContent = n0(t.total);
      UI.$('.pe-rate', root).hidden = cur.taxMode !== 'excl';
    };
    root.addEventListener('input', recalc);
    root.addEventListener('change', recalc);
    // auto-grow the item text areas
    UI.$$('textarea.pe-text', root).forEach((ta) => { const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; ta.addEventListener('input', fit); setTimeout(fit, 0); });
    // radios can be cleared by clicking the checked one again
    UI.$$('input[type=radio]', root).forEach((r) => {
      r.addEventListener('mousedown', () => (r._was = r.checked));
      r.addEventListener('click', () => { if (r._was) { r.checked = false; r._was = false; recalc(); } });
    });
    // picking a vendor from the directory fills in its details
    const vIn = UI.$('[data-k="vendor"]', root);
    vIn.addEventListener('change', () => {
      const v = vendorOf(vIn.value.trim());
      if (!v) return;
      [['contact', v.contact], ['phone', v.phone || v.mobile], ['fax', v.fax], ['address', v.address], ['bank', v.bank], ['accountName', v.accountName], ['accountNo', v.accountNo]].forEach(([k, val]) => {
        const el = UI.$(`[data-k="${k}"]`, root);
        if (el && !el.value.trim() && val) el.value = val;
      });
      const ct = UI.$('[data-k="chequeTo"]', root);
      if (ct && !ct.value.trim()) ct.value = v.name;
    });
    recalc();
    setTimeout(() => { const first = UI.$(isNew ? '[data-l="0.text"]' : '[data-k="vendor"]', root); if (first && window.matchMedia('(pointer:fine)').matches) first.focus(); }, 80);

    function save(andPrint) {
      const cur = readEditor(root, d);
      const filled = cur.lines.filter((l) => l.text || U.num(l.price));
      if (!filled.length) throw new Error('請至少填一個品名和單價');
      if (!cur.vendor) throw new Error('請填寫「廠商名稱」');
      const t = totals(cur);
      if (!t.sum) throw new Error('請填寫單價');
      const item = UI.$('#pm-item', root).value.trim() || (filled[0].text || '').split('\n')[0].trim();
      if (!item) throw new Error('請填寫「報價項目」');
      const tax = U.tax(t.sum, cur.taxMode, cur.taxRate);
      const pr = Object.assign({}, cur);
      ['vendor', 'taxMode', 'taxRate'].forEach((k) => delete pr[k]);
      pr.formDate = cur.date; delete pr.date;
      const rec = DB.put('quotes', Object.assign({}, existing || {}, {
        item, vendor: cur.vendor, amount: t.sum, taxMode: cur.taxMode, taxRate: U.num(cur.taxRate) || (cur.taxMode === 'excl' ? 5 : 5),
        priceIncl: tax.incl, priceExcl: tax.excl, contact: cur.contact,
        note: filled.length > 1 ? filled.map((l) => l.text).join('、') : (filled[0].text.split('\n').slice(1).join(' ') || (existing && existing.note) || ''),
        date: UI.$('#pm-date', root).value || U.today(), validUntil: UI.$('#pm-valid', root).value, equipmentId: UI.$('#pm-eq', root).value,
        adopted: UI.$('#pm-adopted', root).checked, pr
      }));
      // keep the vendor directory up to date with what was typed
      const v = vendorOf(cur.vendor);
      const vPatch = { contact: cur.contact, phone: cur.phone, fax: cur.fax, address: cur.address, bank: cur.bank, accountName: cur.accountName, accountNo: cur.accountNo };
      Object.keys(vPatch).forEach((k) => { if (!vPatch[k]) delete vPatch[k]; });
      if (!v) DB.put('vendors', Object.assign({ name: cur.vendor }, vPatch));
      else if (Object.keys(vPatch).some((k) => v[k] !== vPatch[k])) DB.put('vendors', Object.assign({}, v, vPatch));
      SG.store.set('sg_pr_last', { payUnit: cur.payUnit, payStore: cur.payStore, invoice: cur.invoice, invoiceOther: cur.invoiceOther, unitName: cur.unitName });
      SG.log(isNew ? '新增報價' : '修改報價', `${rec.item}／${rec.vendor} ${U.money(tax.incl)}`);
      UI.toast('已儲存');
      UI.render();
      if (andPrint) setTimeout(() => print(normalize(rec), rec), 200);
    }
  };

  // ------------------------------------------------------------ print / preview
  const fileTitle = (q, d) => `請購單_${(q && q.item) || '報價'}_${d.vendor || ''}_${(d.date || U.today()).replace(/-/g, '')}`;
  function print(d, q) { SG.print(fileTitle(q, d), formHtml(d), { bare: true, margin: '9mm 10mm' }); }
  function preview(d, q) {
    const m = UI.modal({
      title: '請購單預覽', wide: true, body: `<div class="pr-preview">${formHtml(d)}</div>`,
      actions: [{ label: '關閉' }, ...(q && Auth.can('edit') ? [{ label: '✏️ 編輯', onClick: () => { setTimeout(() => F.quote(DB.get('quotes', q.id)), 200); } }] : []),
        { label: '🖨️ 列印／存成 PDF', kind: 'primary', onClick: () => { print(d, q); } }]
    });
    m.el.classList.add('pr-modal');
  }
  // 🧾 button on a quote: show it on the form, ready to print.
  SG.purchaseForm = function (quoteId) {
    const q = DB.get('quotes', quoteId);
    if (q) preview(normalize(q), q);
  };
  SG.purchaseEditorHtml = (q) => editorHtml(normalize(q)); // for tests
  SG.purchaseHtml = (q, pr) => formHtml(normalize(Object.assign({}, q, pr ? { pr: Object.assign({}, q.pr || {}, pr) } : {})));
})();
