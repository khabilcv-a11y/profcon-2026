(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var main = $('#main'), dlg = $('#dlg');
  var CATS = window.PROFCON_CATEGORIES || ['Other'];
  var S = {
    districts: [], zones: [], receipts: [], expenses: [], tab: 'summary', view: 'entry', openD: '',
    draft: [], dist: '', by: '', xdraft: [{ item: '', category: '', amount: '' }], xdist: '', xby: '',
    rfilter: '', rsearch: '', xfilter: '', rpt: { dist: '', detail: true }
  };

  /* ---------- helpers ---------- */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inr(n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function toast(msg, err) {
    var t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, 3600);
  }
  function busy(btn, p) {
    if (btn) btn.disabled = true;
    return p.then(function (r) { if (btn) btn.disabled = false; return r; }, function (e) { if (btn) btn.disabled = false; toast(e.message, true); throw e; });
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dmy(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : s || ''; }
  function loggedIn() { return !!api.token; }
  function zonesOf(dist) { return S.zones.filter(function (z) { return z.district === dist; }); }
  function zoneOptions(dist, sel) { return zonesOf(dist).map(function (z) { return '<option' + (z.name === sel ? ' selected' : '') + '>' + esc(z.name) + '</option>'; }).join(''); }
  function catOptions(sel) { return CATS.map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join(''); }
  function distOptions(sel, blank) { return '<option value="">' + blank + '</option>' + S.districts.map(function (d) { return '<option' + (d.name === sel ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join(''); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- totals (shared by screen + PDF) ---------- */
  function sum(list) {
    return list.reduce(function (t, r) { t.count++; t.amount += +r.amount; t.cash += +r.cash; t.gpay += +r.gpay; t.account += +r.account; return t; }, { count: 0, amount: 0, cash: 0, gpay: 0, account: 0 });
  }
  function summary() {
    var rows = S.districts.map(function (d) {
      var r = Object.assign({ name: d.name }, sum(S.receipts.filter(function (x) { return x.district === d.name; })));
      r.exp = S.expenses.filter(function (x) { return x.district === d.name; }).reduce(function (a, x) { return a + +x.amount; }, 0);
      r.balance = r.amount - r.exp;
      return r;
    });
    var total = sum(S.receipts);
    var exp = S.expenses.reduce(function (a, x) { return a + +x.amount; }, 0);
    return { rows: rows, total: total, exp: exp, balance: total.amount - exp };
  }
  function scope(sm, dist) {
    if (!dist) return { total: sm.total, exp: sm.exp, balance: sm.balance };
    var r = sm.rows.filter(function (x) { return x.name === dist; })[0] || { count: 0, amount: 0, cash: 0, gpay: 0, account: 0, exp: 0, balance: 0 };
    return { total: r, exp: r.exp, balance: r.balance };
  }
  function byCategory(list) {
    var m = {};
    list.forEach(function (x) { m[x.category || 'Other'] = (m[x.category || 'Other'] || 0) + +x.amount; });
    return Object.keys(m).sort().map(function (k) { return [k, m[k]]; });
  }

  /* ---------- navigation ---------- */
  function nav() {
    var n = $('#nav');
    n.innerHTML = '<button data-v="entry">Enter receipts</button><button data-v="xentry">Enter expenses</button><button data-v="admin">' + (loggedIn() ? 'Admin' : 'Admin login') + '</button><button data-v="tour" title="Quick tour" aria-label="Quick tour">?</button>';
    [].forEach.call(n.children, function (b) {
      if (b.dataset.v === S.view) b.className = 'on';
      b.onclick = function () { if (b.dataset.v === 'tour') tour(0); else go(b.dataset.v); };
    });
  }
  function go(v) {
    S.view = v;
    nav();
    if (v === 'entry') return entryView();
    if (v === 'xentry') return xentryView();
    if (!loggedIn()) return loginView();
    main.innerHTML = '<p class="note" style="padding:30px 0;text-align:center">Loading…</p>';
    refresh().then(adminView);
  }
  function refresh() {
    return api.call('all').then(function (d) { S.districts = d.districts; S.zones = d.zones; S.receipts = d.receipts; S.expenses = d.expenses; })
      .catch(function (e) { toast(e.message, true); if (!loggedIn()) { nav(); loginView(); } throw e; });
  }
  /* District/zone lists: show instantly from memory, last visit's cache or the built-in list, then refresh quietly. */
  var LKEY = 'profcon_lists_v1', lastFetch = 0, inflight = null;
  function sig() { return S.districts.map(function (d) { return d.name; }).join('|') + '#' + S.zones.map(function (z) { return z.district + '/' + z.name; }).join('|'); }
  function setLists(d) {
    S.districts = d.districts; S.zones = d.zones;
    if (S.dist && !S.districts.some(function (x) { return x.name === S.dist; })) S.dist = '';
    if (S.xdist && !S.districts.some(function (x) { return x.name === S.xdist; })) S.xdist = '';
    lsSet(LKEY, JSON.stringify(d));
  }
  function seedLists() {
    var seed = window.PROFCON_SEED || {}, ds = [], zs = [];
    Object.keys(seed).forEach(function (d) { ds.push({ id: d, name: d }); seed[d].forEach(function (z) { zs.push({ id: d + '/' + z, district: d, name: z }); }); });
    return { districts: ds, zones: zs };
  }
  function fetchLists() {
    if (!inflight) inflight = api.call('districts').then(function (d) { setLists(d); lastFetch = Date.now(); inflight = null; }, function (e) { inflight = null; throw e; });
    return inflight;
  }
  function loadLists(done) {
    var v = S.view, fresh = S.districts.length && Date.now() - lastFetch < 60000;
    if (!S.districts.length) {
      var c = null; try { c = JSON.parse(lsGet(LKEY)); } catch (e) {}
      var d0 = c && c.districts && c.zones ? c : seedLists(); S.districts = d0.districts; S.zones = d0.zones;
    }
    done();
    if (fresh) return;
    var before = sig();
    fetchLists().then(function () { if (S.view === v && sig() !== before) done(); }).catch(function (e) { toast(e.message, true); });
  }
  function demoBanner() { return api.live ? '' : '<div class="banner">Demo mode: data is saved only in this browser. Set <b>API_URL</b> in <code>js/config.js</code> to use the Google Sheet.</div>'; }

  /* ---------- quick tour ---------- */
  var STEPS = [
    ['Welcome to PROFCON 2026', 'This takes about 30 seconds. You will use this site to hand in the <b>receipts</b> you are holding and the <b>expenses</b> your district has spent.'],
    ['1 · Enter receipts', 'Pick your <b>district</b>, type how many receipts you have, and press <b>Add receipt rows</b>. For each receipt fill the receipt number, the total, and how it was handed over: <b>Cash + UPI + Account must equal the total</b>. Choose the <b>zone</b> on each row.'],
    ['2 · Enter expenses', 'Open <b>Enter expenses</b>, pick your district, then add each item with a <b>category</b> (food, travel allowance, programme expense, transportation cost…) and the <b>amount</b>. Press <b>Add item</b> for more rows.'],
    ['3 · Download and share', 'After you submit, a <b>PDF report</b> of what you entered appears. Download it or press <b>Share PDF</b> to send it to us on WhatsApp or email.'],
    ['4 · Admin only', 'The organisers log in under <b>Admin login</b> to correct entries, manage districts and zones, add central expenses and get the full report.']
  ];
  function tour(i) {
    var last = i === STEPS.length - 1;
    dlg.oninput = null;
    dlg.innerHTML = '<div class="tour"><div class="dots">' + STEPS.map(function (_, k) { return '<i' + (k === i ? ' class="on"' : '') + '></i>'; }).join('') + '</div>' +
      '<h2>' + STEPS[i][0] + '</h2><p>' + STEPS[i][1] + '</p><div class="row end">' +
      (i ? '<button id="t-b">Back</button>' : '<button id="t-s">Skip</button>') + '<button class="primary" id="t-n">' + (last ? 'Start' : 'Next') + '</button></div></div>';
    if (!dlg.open) dlg.showModal();
    function finish() { lsSet('profcon_tour_done', '1'); dlg.close(); }
    $('#t-n').onclick = function () { if (last) finish(); else tour(i + 1); };
    if (i) $('#t-b').onclick = function () { tour(i - 1); };
    else $('#t-s').onclick = finish;
    dlg.onclose = function () { lsSet('profcon_tour_done', '1'); dlg.onclose = null; };
  }

  /* ---------- PDF building blocks ---------- */
  var LOGO = null, LOGO2 = null;
  function loadLogo(src, set) {
    var im = new Image();
    im.onload = function () { var k = Math.min(1, 500 / im.width), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); try { set(c.toDataURL('image/png')); } catch (e) {} };
    im.src = src;
  }
  loadLogo('assets/logo-wordmark.png', function (d) { LOGO = d; });
  loadLogo('assets/logo-wisdom.png', function (d) { LOGO2 = d; });
  var NAVY = [23, 95, 154], RED = [214, 33, 42], HEAD = { fillColor: NAVY, textColor: 255, fontSize: 9 }, FOOT = { fillColor: [232, 238, 247], textColor: 20, fontStyle: 'bold' }, ALT = { fillColor: [248, 249, 253] }, RIGHT = { halign: 'right' };
  function pr(n) { return 'Rs. ' + inr(n); }
  function pdfStart(title, subline) {
    if (!window.jspdf) { toast('PDF library did not load. Check your internet.', true); return null; }
    var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), W = doc.internal.pageSize.getWidth(), M = 36;
    if (LOGO) doc.addImage(LOGO, 'PNG', M, 20, 150, 30);
    else { doc.setTextColor.apply(doc, NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text('PROFCON', M, 44); }
    doc.setTextColor(16, 43, 70); doc.setFont('helvetica', 'bold');
    if (LOGO2) doc.addImage(LOGO2, 'PNG', W - M - 118, 16, 118, 14.3);
    else { doc.setFontSize(10); doc.text('WISDOM STUDENTS', W - M, 28, { align: 'right' }); }
    doc.setFontSize(7.5); doc.setTextColor(214, 33, 42); doc.text('FINANCE & WELFARE WING  |  30TH EDITION', W - M, 41, { align: 'right' });
    doc.setTextColor(16, 43, 70); doc.setFontSize(14); doc.text(title, W - M, 58, { align: 'right' });
    doc.setFillColor.apply(doc, NAVY); doc.rect(0, 66, W, 3, 'F');
    doc.setFillColor.apply(doc, RED); doc.rect(0, 69, W * 0.18, 3, 'F');
    doc.setTextColor(60); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(subline, M, 98);
    doc.W = W; doc.M = M;
    return doc;
  }
  function pdfHeading(doc, t, y) { doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor.apply(doc, NAVY); doc.text(t, doc.M, y); doc.setFont('helvetica', 'normal'); }
  function pdfTable(doc, o) {
    doc.autoTable({
      startY: o.y, margin: { left: o.left || doc.M, right: doc.M }, theme: 'grid', headStyles: HEAD, footStyles: FOOT, alternateRowStyles: ALT,
      styles: { fontSize: o.font || 9, cellPadding: o.pad || 4 }, head: [o.head], body: o.body, foot: o.foot ? [o.foot] : undefined, showFoot: 'lastPage', columnStyles: o.cols || {}
    });
    return doc.lastAutoTable.finalY;
  }
  function pdfFinish(doc) {
    var pages = doc.getNumberOfPages();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(130);
      doc.text('WISDOM Students - Finance & Welfare Wing  |  PROFCON 2026  |  To the Right Goal Through the Right Path', doc.M, 822); doc.text('Page ' + i + ' of ' + pages, doc.W - doc.M, 822, { align: 'right' });
    }
    return doc;
  }
  function pdfCards(doc, cards, y) {
    var cw = (doc.W - 2 * doc.M - (cards.length - 1) * 8) / cards.length;
    cards.forEach(function (c, i) {
      var x = doc.M + i * (cw + 8);
      doc.setDrawColor(210); doc.setFillColor(247, 249, 253); doc.roundedRect(x, y, cw, 46, 5, 5, 'FD');
      doc.setFontSize(7.5); doc.setTextColor(100); doc.text(c[0].toUpperCase(), x + 8, y + 15);
      doc.setFontSize(10.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(20); doc.text(pr(c[1]), x + 8, y + 35); doc.setFont('helvetica', 'normal');
    });
  }
  function fileDoc(doc, fname, title) {
    var file = new File([doc.output('blob')], fname, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: title }).catch(function () {});
    else { doc.save(fname); toast('Sharing is not supported on this device. PDF downloaded: attach it in WhatsApp or email.'); }
  }
  function pdfButtons(makeDoc, fname, title) {
    return '<div class="row" style="margin:12px 0"><button class="primary" id="pd-dl">Download PDF report</button><button id="pd-sh">Share PDF…</button></div>';
  }
  function wirePdf(makeDoc, fname, title) {
    $('#pd-dl').onclick = function () { var d = makeDoc(); if (d) d.save(fname); };
    $('#pd-sh').onclick = function () { var d = makeDoc(); if (d) fileDoc(d, fname, title); };
  }

  /* ---------- public: receipts ---------- */
  function entryView() {
    main.innerHTML = demoBanner() + '<h2>Enter receipts</h2><p class="sub">Choose your district, say how many receipts you are holding, then fill one row per receipt.</p>' +
      '<div class="card"><div class="grid">' +
      '<div><label for="dist">District</label><select id="dist"><option value="">Loading…</option></select></div>' +
      '<div><label for="cnt">Number of receipts in hand</label><input id="cnt" type="number" min="1" max="200" inputmode="numeric" placeholder="e.g. 5"></div>' +
      '<div><label for="by">Your name (optional)</label><input id="by" maxlength="80"></div>' +
      '<div><button class="primary" id="gen">Add receipt rows</button></div></div></div><div id="rows"></div>';
    loadLists(function () { $('#dist').innerHTML = distOptions(S.dist, 'Select district…'); if (S.draft.length) { $('#cnt').value = S.draft.length; draftTable(); } });
    $('#by').value = S.by;
    $('#dist').onchange = function () { S.dist = this.value; S.draft.forEach(function (r) { r.zone = ''; }); if (S.draft.length) draftTable(); };
    $('#by').oninput = function () { S.by = this.value; };
    $('#gen').onclick = function () {
      var n = Math.floor(num($('#cnt').value));
      if (!$('#dist').value) return toast('Select a district first', true);
      if (n < 1 || n > 200) return toast('Enter a number of receipts between 1 and 200', true);
      while (S.draft.length < n) S.draft.push({ zone: '', receiptNo: '', amount: '', cash: '', gpay: '', account: '' });
      S.draft.length = n;
      draftTable();
    };
  }
  function draftTable() {
    $('#rows').innerHTML = '<div class="tablewrap"><table><thead><tr><th>#</th><th>Zone</th><th>Receipt no.</th><th class="n">Total amount</th><th class="n">Cash</th><th class="n">UPI</th><th class="n">Account</th><th>Check</th></tr></thead><tbody>' +
      S.draft.map(function (r, i) {
        return '<tr data-i="' + i + '"><td>' + (i + 1) + '</td><td><select data-f="zone"><option value="">—</option>' + zoneOptions(S.dist, r.zone) + '</select></td>' +
          '<td><input class="no" data-f="receiptNo" value="' + esc(r.receiptNo) + '"></td>' +
          ['amount', 'cash', 'gpay', 'account'].map(function (f) { return '<td><input type="number" min="0" step="0.01" inputmode="decimal" data-f="' + f + '" value="' + esc(r[f]) + '"></td>'; }).join('') +
          '<td class="chk"></td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="3">Total</td><td class="n" id="t-amount"></td><td class="n" id="t-cash"></td><td class="n" id="t-gpay"></td><td class="n" id="t-account"></td><td></td></tr></tfoot></table></div>' +
      '<p class="note">Cash + UPI + Account must equal the total amount of each receipt. Zone is optional.</p><div class="row end"><button id="clr">Clear</button><button class="primary" id="sub">Submit receipts</button></div>';
    $('#rows tbody').oninput = function (e) {
      var tr = e.target.closest('tr'); if (!tr || !e.target.dataset.f) return;
      S.draft[tr.dataset.i][e.target.dataset.f] = e.target.value; draftCheck();
    };
    $('#clr').onclick = function () { S.draft = []; $('#rows').innerHTML = ''; $('#cnt').value = ''; };
    $('#sub').onclick = submitDraft;
    draftCheck();
  }
  function rowDiff(r) { return num(r.amount) - num(r.cash) - num(r.gpay) - num(r.account); }
  function numRow(r) { return { amount: num(r.amount), cash: num(r.cash), gpay: num(r.gpay), account: num(r.account) }; }
  function draftCheck() {
    var all = true;
    [].forEach.call(document.querySelectorAll('#rows tbody tr'), function (tr) {
      var r = S.draft[tr.dataset.i], c = tr.querySelector('.chk'), d = rowDiff(r);
      if (!r.receiptNo.trim() && !r.amount) { c.textContent = '—'; c.className = 'chk note'; all = false; return; }
      if (!r.receiptNo.trim() || r.amount === '') { c.textContent = 'Incomplete'; c.className = 'chk bad'; all = false; }
      else if (Math.abs(d) > 0.009) { c.textContent = (d > 0 ? '₹' + inr(d) + ' short' : '₹' + inr(-d) + ' extra'); c.className = 'chk bad'; all = false; }
      else { c.textContent = '✓'; c.className = 'chk ok'; }
    });
    var t = sum(S.draft.map(numRow));
    ['amount', 'cash', 'gpay', 'account'].forEach(function (f) { $('#t-' + f).textContent = '₹' + inr(t[f]); });
    return all;
  }
  function submitDraft() {
    if (!$('#dist').value) return toast('Select a district first', true);
    if (!draftCheck()) return toast('Fix the rows marked in red first', true);
    var nos = S.draft.map(function (r) { return r.receiptNo.trim(); });
    if (nos.some(function (n, i) { return nos.indexOf(n) !== i; })) return toast('A receipt number is repeated in this list', true);
    var t = sum(S.draft.map(numRow)), dist = $('#dist').value, sent = S.draft.map(function (r) { return Object.assign({}, r); });
    if (!confirm('Submit ' + sent.length + ' receipts for ' + dist + '?\nTotal ₹' + inr(t.amount) + ' (Cash ₹' + inr(t.cash) + ', UPI ₹' + inr(t.gpay) + ', Account ₹' + inr(t.account) + ')')) return;
    busy($('#sub'), api.call('addReceipts', { district: dist, submittedBy: S.by, receipts: sent })).then(function (r) {
      S.draft = [];
      var fname = 'PROFCON-2026-Receipts-' + dist.replace(/\s+/g, '-') + '-' + today() + '.pdf';
      function make() {
        var doc = pdfStart('Receipts Submission Report', 'District: ' + dist + '    Date: ' + dmy(today()) + (S.by ? '    Submitted by: ' + S.by : '')); if (!doc) return null;
        pdfCards(doc, [['Total collection', t.amount], ['Cash', t.cash], ['UPI', t.gpay], ['Account', t.account]], 114);
        pdfTable(doc, {
          y: 176, head: ['#', 'Zone', 'Receipt no.', 'Total', 'Cash', 'UPI', 'Account'],
          body: sent.map(function (x, i) { return [i + 1, x.zone || '', x.receiptNo, inr(x.amount), inr(x.cash), inr(x.gpay), inr(x.account)]; }),
          foot: ['', '', 'Total (' + sent.length + ')', inr(t.amount), inr(t.cash), inr(t.gpay), inr(t.account)],
          cols: { 0: { cellWidth: 28 }, 3: RIGHT, 4: RIGHT, 5: RIGHT, 6: RIGHT }
        });
        return pdfFinish(doc);
      }
      main.innerHTML = '<div class="card"><h2 class="ok">✓ ' + r.saved + ' receipts saved</h2><p>District: <b>' + esc(dist) + '</b> · Total ₹' + inr(t.amount) + '</p>' +
        '<p class="note">Download the PDF report below and share it with us. Any correction must be made by the admin.</p>' + pdfButtons() + '<button id="again">Enter more receipts</button></div>';
      wirePdf(make, fname, 'PROFCON 2026 Receipts');
      $('#again').onclick = entryView;
    });
  }

  /* ---------- public: expenses ---------- */
  function xentryView() {
    main.innerHTML = demoBanner() + '<h2>Enter PROFCON expenses</h2><p class="sub">Choose your district and add each expense item with its category and amount.</p>' +
      '<div class="card"><div class="grid"><div><label for="xdist">District</label><select id="xdist"><option value="">Loading…</option></select></div>' +
      '<div><label for="xby">Your name (optional)</label><input id="xby" maxlength="80"></div></div></div><div id="xrows"></div>';
    loadLists(function () { $('#xdist').innerHTML = distOptions(S.xdist, 'Select district…'); });
    $('#xby').value = S.xby;
    $('#xdist').onchange = function () { S.xdist = this.value; };
    $('#xby').oninput = function () { S.xby = this.value; };
    xTable();
  }
  function xTable() {
    $('#xrows').innerHTML = '<div class="tablewrap"><table><thead><tr><th>#</th><th>Expense item</th><th>Category</th><th class="n">Amount (₹)</th><th></th></tr></thead><tbody>' +
      S.xdraft.map(function (r, i) {
        return '<tr data-i="' + i + '"><td>' + (i + 1) + '</td><td><input data-f="item" maxlength="200" style="min-width:180px" value="' + esc(r.item) + '"></td>' +
          '<td><select data-f="category"><option value="">Select…</option>' + catOptions(r.category) + '</select></td>' +
          '<td><input type="number" min="0" step="0.01" inputmode="decimal" data-f="amount" value="' + esc(r.amount) + '"></td>' +
          '<td>' + (S.xdraft.length > 1 ? '<button class="sm danger" data-rm="' + i + '" aria-label="Remove row">✕</button>' : '') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="3">Total</td><td class="n" id="x-total"></td><td></td></tr></tfoot></table></div>' +
      '<div class="row" style="margin-top:12px"><button id="x-add">+ Add item</button><span style="flex:1"></span><button class="primary" id="x-sub">Submit expenses</button></div>';
    var tb = $('#xrows tbody');
    tb.oninput = function (e) {
      var tr = e.target.closest('tr'); if (!tr || !e.target.dataset.f) return;
      S.xdraft[tr.dataset.i][e.target.dataset.f] = e.target.value; xTotal();
    };
    tb.onclick = function (e) { var b = e.target.closest('[data-rm]'); if (b) { S.xdraft.splice(+b.dataset.rm, 1); xTable(); } };
    $('#x-add').onclick = function () { S.xdraft.push({ item: '', category: '', amount: '' }); xTable(); var ins = $('#xrows tbody tr:last-child input'); if (ins) ins.focus(); };
    $('#x-sub').onclick = submitExpenses;
    xTotal();
  }
  function xTotal() { $('#x-total').textContent = '₹' + inr(S.xdraft.reduce(function (a, r) { return a + num(r.amount); }, 0)); }
  function submitExpenses() {
    var dist = $('#xdist').value;
    if (!dist) return toast('Select a district first', true);
    var rows = S.xdraft.filter(function (r) { return r.item.trim() || r.category || r.amount !== ''; });
    if (!rows.length) return toast('Add at least one expense item', true);
    if (rows.some(function (r) { return !r.item.trim() || !r.category || !(num(r.amount) > 0); })) return toast('Each item needs a name, a category and an amount above 0', true);
    var total = rows.reduce(function (a, r) { return a + num(r.amount); }, 0), sent = rows.map(function (r) { return { item: r.item.trim(), category: r.category, amount: num(r.amount) }; });
    if (!confirm('Submit ' + sent.length + ' expense items for ' + dist + '?\nTotal ₹' + inr(total))) return;
    busy($('#x-sub'), api.call('addExpenses', { district: dist, submittedBy: S.xby, expenses: sent })).then(function (r) {
      S.xdraft = [{ item: '', category: '', amount: '' }];
      var fname = 'PROFCON-2026-Expenses-' + dist.replace(/\s+/g, '-') + '-' + today() + '.pdf';
      function make() {
        var doc = pdfStart('Expense Report', 'District: ' + dist + '    Date: ' + dmy(today()) + (S.xby ? '    Submitted by: ' + S.xby : '')); if (!doc) return null;
        pdfCards(doc, [['Total expenses', total]].concat(byCategory(sent).slice(0, 3)), 114);
        var y = pdfTable(doc, {
          y: 176, head: ['#', 'Category', 'Expense item', 'Amount'],
          body: sent.map(function (x, i) { return [i + 1, x.category, x.item, inr(x.amount)]; }),
          foot: ['', '', 'Total (' + sent.length + ' items)', inr(total)], cols: { 0: { cellWidth: 28 }, 3: RIGHT }
        });
        pdfHeading(doc, 'Category-wise total', y + 28);
        pdfTable(doc, { y: y + 36, head: ['Category', 'Amount'], body: byCategory(sent).map(function (c) { return [c[0], inr(c[1])]; }), foot: ['Total', inr(total)], cols: { 1: RIGHT } });
        return pdfFinish(doc);
      }
      main.innerHTML = '<div class="card"><h2 class="ok">✓ ' + r.saved + ' expense items saved</h2><p>District: <b>' + esc(dist) + '</b> · Total ₹' + inr(total) + '</p>' +
        '<p class="note">Download the PDF report below and share it with us. Any correction must be made by the admin.</p>' + pdfButtons() + '<button id="again">Enter more expenses</button></div>';
      wirePdf(make, fname, 'PROFCON 2026 Expenses');
      $('#again').onclick = xentryView;
    });
  }

  /* ---------- admin login ---------- */
  function loginView() {
    main.innerHTML = demoBanner() + '<div class="card" style="max-width:380px;margin:30px auto"><h2>Admin login</h2><p class="sub">Enter the admin PIN. You will be asked again every time you log in.</p>' +
      '<form id="lf"><label for="key">Admin PIN</label><input id="key" type="password" autocomplete="current-password" autofocus><div class="row end" style="margin-top:12px"><button class="primary">Log in</button></div></form></div>';
    $('#lf').onsubmit = function (e) {
      e.preventDefault();
      busy($('#lf button'), api.call('login', { key: $('#key').value })).then(function (r) { api.setToken(r.token); go('admin'); });
    };
  }

  /* ---------- admin ---------- */
  var TABS = [['summary', 'Summary'], ['receipts', 'Receipts'], ['districts', 'Districts & zones'], ['expenses', 'PROFCON expenses'], ['report', 'Report / PDF'], ['settings', 'Settings']];
  function adminView() {
    nav();
    main.innerHTML = '<div class="tabs">' + TABS.map(function (t) { return '<button data-t="' + t[0] + '"' + (S.tab === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div><div id="pane"></div>';
    [].forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.onclick = function () { S.tab = b.dataset.t; adminView(); }; });
    var p = $('#pane');
    ({ summary: summaryTab, receipts: receiptsTab, districts: districtsTab, expenses: expensesTab, report: reportTab, settings: settingsTab })[S.tab](p);
  }
  function reload() { return refresh().then(adminView); }

  function summaryTable(sm, onlyDist) {
    var rows = sm.rows.filter(function (r) { return !onlyDist || r.name === onlyDist; }), sc = scope(sm, onlyDist);
    return '<div class="tablewrap"><table><thead><tr><th>District</th><th class="n">Receipts</th><th class="n">Collection</th><th class="n">Cash</th><th class="n">UPI</th><th class="n">Account</th><th class="n">Expenses</th><th class="n">Balance</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td class="n">' + r.count + '</td><td class="n">' + inr(r.amount) + '</td><td class="n">' + inr(r.cash) + '</td><td class="n">' + inr(r.gpay) + '</td><td class="n">' + inr(r.account) + '</td><td class="n">' + inr(r.exp) + '</td><td class="n">' + inr(r.balance) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Total' + (onlyDist ? '' : ' (incl. central expenses)') + '</td><td class="n">' + sc.total.count + '</td><td class="n">' + inr(sc.total.amount) + '</td><td class="n">' + inr(sc.total.cash) + '</td><td class="n">' + inr(sc.total.gpay) + '</td><td class="n">' + inr(sc.total.account) + '</td><td class="n">' + inr(sc.exp) + '</td><td class="n">' + inr(sc.balance) + '</td></tr></tfoot></table></div>';
  }
  function statsHtml(sm, dist) {
    var sc = scope(sm, dist);
    function st(l, v) { return '<div class="stat"><span>' + l + '</span><b>₹' + inr(v) + '</b></div>'; }
    return '<div class="stats">' + st('Total collection', sc.total.amount) + st('Cash', sc.total.cash) + st('UPI', sc.total.gpay) + st('Account', sc.total.account) + st('Expenses', sc.exp) + st('Balance', sc.balance) + '</div>';
  }
  function summaryTab(p) {
    var sm = summary();
    p.innerHTML = '<h2>Summary</h2><p class="sub">District-wise collection and expenses. Balance = collection − expenses. Central (non-district) expenses count only in the total.</p>' + statsHtml(sm) + summaryTable(sm) +
      '<h3>Expenses by category</h3><div class="tablewrap"><table><thead><tr><th>Category</th><th class="n">Amount</th></tr></thead><tbody>' +
      (S.expenses.length ? byCategory(S.expenses).map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td class="n">' + inr(c[1]) + '</td></tr>'; }).join('') : '<tr><td colspan="2" class="empty">No expenses yet.</td></tr>') + '</tbody></table></div>';
  }

  function receiptsTab(p) {
    var list = S.receipts.filter(function (r) { return (!S.rfilter || r.district === S.rfilter) && (!S.rsearch || String(r.receiptNo).toLowerCase().indexOf(S.rsearch.toLowerCase()) >= 0); });
    var t = sum(list);
    p.innerHTML = '<h2>Receipts</h2><div class="card"><div class="grid"><div><label>District</label><select id="rf">' + distOptions(S.rfilter, 'All districts') + '</select></div>' +
      '<div><label>Search receipt no.</label><input id="rs" value="' + esc(S.rsearch) + '"></div></div></div>' +
      '<div class="tablewrap"><table><thead><tr><th>District</th><th>Zone</th><th>Receipt no.</th><th class="n">Total</th><th class="n">Cash</th><th class="n">UPI</th><th class="n">Account</th><th>By</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (r) {
        return '<tr><td>' + esc(r.district) + '</td><td>' + esc(r.zone) + '</td><td>' + esc(r.receiptNo) + '</td><td class="n">' + inr(r.amount) + '</td><td class="n">' + inr(r.cash) + '</td><td class="n">' + inr(r.gpay) + '</td><td class="n">' + inr(r.account) + '</td><td>' + esc(r.submittedBy) + '</td><td><button class="sm" data-e="' + esc(r.id) + '">Edit</button> <button class="sm danger" data-d="' + esc(r.id) + '">Delete</button></td></tr>';
      }).join('') : '<tr><td colspan="9" class="empty">No receipts yet.</td></tr>') + '</tbody>' + (list.length ? '<tfoot><tr><td colspan="3">' + list.length + ' receipts</td><td class="n">' + inr(t.amount) + '</td><td class="n">' + inr(t.cash) + '</td><td class="n">' + inr(t.gpay) + '</td><td class="n">' + inr(t.account) + '</td><td colspan="2"></td></tr></tfoot>' : '') + '</table></div>';
    $('#rf').onchange = function () { S.rfilter = this.value; receiptsTab(p); };
    $('#rs').oninput = function () { S.rsearch = this.value; var pos = this.selectionStart; receiptsTab(p); var el = $('#rs'); el.focus(); el.setSelectionRange(pos, pos); };
    p.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.e) editReceipt(S.receipts.filter(function (r) { return r.id === b.dataset.e; })[0]);
      if (b.dataset.d && confirm('Delete this receipt? This cannot be undone.')) busy(b, api.call('deleteReceipt', { id: b.dataset.d })).then(function () { toast('Deleted'); reload(); });
    };
  }
  function editReceipt(r) {
    dlg.innerHTML = '<form method="dialog" id="ef"><h2>Edit receipt</h2><div class="grid" style="margin:12px 0">' +
      '<div><label>District</label><select id="e-district">' + distOptions(r.district, 'Select…') + '</select></div>' +
      '<div><label>Zone</label><select id="e-zone"><option value="">No zone</option>' + zoneOptions(r.district, r.zone) + '</select></div>' +
      '<div><label>Receipt no.</label><input id="e-receiptNo" value="' + esc(r.receiptNo) + '"></div>' +
      ['amount', 'cash', 'gpay', 'account'].map(function (f) { return '<div><label>' + { amount: 'Total amount', cash: 'Cash', gpay: 'UPI', account: 'Account' }[f] + '</label><input type="number" min="0" step="0.01" id="e-' + f + '" value="' + r[f] + '"></div>'; }).join('') +
      '</div><p class="note" id="e-chk"></p><div class="row end"><button type="button" id="e-x">Cancel</button><button class="primary" id="e-s">Save</button></div></form>';
    dlg.showModal();
    function chk() { var d = num($('#e-amount').value) - num($('#e-cash').value) - num($('#e-gpay').value) - num($('#e-account').value); $('#e-chk').innerHTML = Math.abs(d) < 0.01 ? '<span class="ok">✓ Cash + UPI + Account match the total</span>' : '<span class="bad">Difference: ₹' + inr(d) + '</span>'; }
    dlg.oninput = chk; chk();
    $('#e-district').onchange = function () { $('#e-zone').innerHTML = '<option value="">No zone</option>' + zoneOptions(this.value, ''); };
    $('#e-x').onclick = function () { dlg.close(); };
    $('#ef').onsubmit = function (e) {
      e.preventDefault();
      var rec = { id: r.id, district: $('#e-district').value, zone: $('#e-zone').value, receiptNo: $('#e-receiptNo').value.trim() };
      ['amount', 'cash', 'gpay', 'account'].forEach(function (f) { rec[f] = num($('#e-' + f).value); });
      busy($('#e-s'), api.call('updateReceipt', { receipt: rec })).then(function () { dlg.close(); toast('Saved'); reload(); });
    };
  }

  function districtsTab(p) {
    p.innerHTML = '<h2>Districts &amp; zones</h2><div class="card"><form id="df" class="row"><input id="dn" placeholder="New district name" style="flex:1;min-width:200px"><button class="primary">Add district</button></form></div>' +
      S.districts.map(function (d) {
        var zs = zonesOf(d.name), n = S.receipts.filter(function (r) { return r.district === d.name; }).length;
        return '<details class="card dist" data-n="' + esc(d.name) + '"' + (S.openD === d.name ? ' open' : '') + '><summary><b>' + esc(d.name) + '</b> <span class="note">' + zs.length + ' zones · ' + n + ' receipts</span></summary>' +
          '<div class="row" style="margin:10px 0"><button class="sm" data-r="' + esc(d.id) + '">Rename district</button><button class="sm danger" data-d="' + esc(d.id) + '"' + (n ? ' disabled title="Has receipts"' : '') + '>Delete district</button></div>' +
          '<div class="tablewrap"><table><tbody>' + (zs.length ? zs.map(function (z) {
            var zn = S.receipts.filter(function (r) { return r.district === d.name && r.zone === z.name; }).length;
            return '<tr><td>' + esc(z.name) + '</td><td class="n note">' + zn + ' receipts</td><td class="n"><button class="sm" data-zr="' + esc(z.id) + '">Rename</button> <button class="sm danger" data-zd="' + esc(z.id) + '"' + (zn ? ' disabled title="Has receipts"' : '') + '>Delete</button></td></tr>';
          }).join('') : '<tr><td class="empty">No zones yet.</td></tr>') + '</tbody></table></div>' +
          '<form class="row zf" data-dist="' + esc(d.name) + '" style="margin-top:10px"><input placeholder="New zone in ' + esc(d.name) + '" style="flex:1;min-width:200px"><button class="sm primary">Add zone</button></form></details>';
      }).join('');
    $('#df').onsubmit = function (e) { e.preventDefault(); busy($('#df button'), api.call('addDistrict', { name: $('#dn').value })).then(function () { toast('District added'); reload(); }); };
    [].forEach.call(p.querySelectorAll('.zf'), function (f) {
      f.onsubmit = function (e) {
        e.preventDefault(); S.openD = f.dataset.dist;
        busy(f.querySelector('button'), api.call('addZone', { district: f.dataset.dist, name: f.querySelector('input').value })).then(function () { toast('Zone added'); reload(); });
      };
    });
    p.onclick = function (e) {
      var b = e.target.closest('button'); if (!b || b.form) return;
      var host = b.closest('details'); if (host) S.openD = host.dataset.n;
      var d = S.districts.filter(function (x) { return x.id === (b.dataset.r || b.dataset.d); })[0];
      var z = S.zones.filter(function (x) { return x.id === (b.dataset.zr || b.dataset.zd); })[0];
      if (b.dataset.r) { var nn = prompt('Rename district', d.name); if (nn && nn.trim() !== d.name) { S.openD = nn.trim(); busy(b, api.call('renameDistrict', { id: d.id, name: nn })).then(function () { toast('Renamed'); reload(); }); } }
      if (b.dataset.d && confirm('Delete district "' + d.name + '" and its zones?')) busy(b, api.call('deleteDistrict', { id: d.id })).then(function () { toast('Deleted'); reload(); });
      if (b.dataset.zr) { var zn = prompt('Rename zone', z.name); if (zn && zn.trim() !== z.name) busy(b, api.call('renameZone', { id: z.id, name: zn })).then(function () { toast('Renamed'); reload(); }); }
      if (b.dataset.zd && confirm('Delete zone "' + z.name + '"?')) busy(b, api.call('deleteZone', { id: z.id })).then(function () { toast('Deleted'); reload(); });
    };
  }

  function expensesTab(p) {
    var list = S.expenses.filter(function (x) { return !S.xfilter || (S.xfilter === '__general' ? !x.district : x.district === S.xfilter); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var total = list.reduce(function (a, x) { return a + +x.amount; }, 0);
    p.innerHTML = '<h2>PROFCON expenses</h2><div class="card"><form id="xf"><div class="grid">' +
      '<div><label>Date</label><input type="date" id="x-date" value="' + today() + '" required></div>' +
      '<div><label>District</label><select id="x-dist">' + distOptions('', 'General / central') + '</select></div>' +
      '<div><label>Category</label><select id="x-cat" required><option value="">Select…</option>' + catOptions('') + '</select></div>' +
      '<div><label>Item</label><input id="x-item" maxlength="200" required></div>' +
      '<div><label>Amount (₹)</label><input type="number" id="x-amount" min="0.01" step="0.01" required></div><div><label>Note (optional)</label><input id="x-note" maxlength="300"></div>' +
      '<div><button class="primary">Add expense</button></div></div></form></div>' +
      '<div class="card"><label>Show</label><select id="x-f"><option value="">All expenses</option><option value="__general"' + (S.xfilter === '__general' ? ' selected' : '') + '>General / central only</option>' + S.districts.map(function (d) { return '<option' + (d.name === S.xfilter ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Date</th><th>District</th><th>Category</th><th>Item</th><th class="n">Amount</th><th>Note</th><th>By</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (x) { return '<tr><td>' + dmy(x.date) + '</td><td>' + (esc(x.district) || '<span class="note">General</span>') + '</td><td>' + esc(x.category) + '</td><td>' + esc(x.item) + '</td><td class="n">' + inr(x.amount) + '</td><td>' + esc(x.note) + '</td><td>' + esc(x.submittedBy) + '</td><td><button class="sm" data-e="' + esc(x.id) + '">Edit</button> <button class="sm danger" data-d="' + esc(x.id) + '">Delete</button></td></tr>'; }).join('') : '<tr><td colspan="8" class="empty">No expenses yet.</td></tr>') +
      '</tbody><tfoot><tr><td colspan="4">Total expenses</td><td class="n">' + inr(total) + '</td><td colspan="3"></td></tr></tfoot></table></div>';
    $('#x-f').onchange = function () { S.xfilter = this.value; expensesTab(p); };
    $('#xf').onsubmit = function (e) {
      e.preventDefault();
      busy($('#xf button'), api.call('addExpense', { expense: { date: $('#x-date').value, district: $('#x-dist').value, category: $('#x-cat').value, item: $('#x-item').value, amount: $('#x-amount').value, note: $('#x-note').value } })).then(function () { toast('Expense added'); reload(); });
    };
    p.onclick = function (e) {
      var b = e.target.closest('button'); if (!b || b.form) return;
      if (b.dataset.d && confirm('Delete this expense?')) busy(b, api.call('deleteExpense', { id: b.dataset.d })).then(function () { toast('Deleted'); reload(); });
      if (b.dataset.e) editExpense(S.expenses.filter(function (x) { return x.id === b.dataset.e; })[0]);
    };
  }
  function editExpense(x) {
    dlg.innerHTML = '<form id="ef"><h2>Edit expense</h2><div class="grid" style="margin:12px 0"><div><label>Date</label><input type="date" id="e-date" value="' + esc(x.date) + '" required></div>' +
      '<div><label>District</label><select id="e-dist">' + distOptions(x.district, 'General / central') + '</select></div>' +
      '<div><label>Category</label><select id="e-cat">' + catOptions(x.category) + '</select></div>' +
      '<div><label>Item</label><input id="e-item" value="' + esc(x.item) + '" required></div>' +
      '<div><label>Amount (₹)</label><input type="number" id="e-amount" min="0.01" step="0.01" value="' + x.amount + '" required></div><div><label>Note</label><input id="e-note" value="' + esc(x.note) + '"></div></div>' +
      '<div class="row end"><button type="button" id="e-x">Cancel</button><button class="primary" id="e-s">Save</button></div></form>';
    dlg.oninput = null; dlg.showModal();
    $('#e-x').onclick = function () { dlg.close(); };
    $('#ef').onsubmit = function (e) {
      e.preventDefault();
      busy($('#e-s'), api.call('updateExpense', { expense: { id: x.id, date: $('#e-date').value, district: $('#e-dist').value, category: $('#e-cat').value, item: $('#e-item').value, amount: $('#e-amount').value, note: $('#e-note').value } })).then(function () { dlg.close(); toast('Saved'); reload(); });
    };
  }

  function settingsTab(p) {
    p.innerHTML = '<h2>Settings</h2><div class="card" style="max-width:420px"><h3 style="margin-top:0">Change admin key</h3><form id="kf">' +
      '<label>Current key</label><input type="password" id="k-cur" autocomplete="current-password" required><label style="margin-top:10px">New key (min 4 characters)</label><input type="password" id="k-new" autocomplete="new-password" minlength="4" required>' +
      '<label style="margin-top:10px">Repeat new key</label><input type="password" id="k-rep" autocomplete="new-password" required><div class="row end" style="margin-top:12px"><button class="primary">Change key</button></div></form></div>' +
      '<button id="lo">Log out</button>';
    $('#kf').onsubmit = function (e) {
      e.preventDefault();
      if ($('#k-new').value !== $('#k-rep').value) return toast('New keys do not match', true);
      busy($('#kf button'), api.call('changeKey', { current: $('#k-cur').value, next: $('#k-new').value })).then(function () { toast('Admin key changed'); $('#kf').reset(); });
    };
    $('#lo').onclick = askLogout;
  }

  function askLogout() {
    dlg.oninput = null;
    dlg.innerHTML = '<form id="lof"><h2>Log out</h2><p class="note">Enter the admin PIN to log out.</p><label for="lo-k">Admin PIN</label>' +
      '<input id="lo-k" type="password" autocomplete="current-password" required><div class="row end" style="margin-top:14px"><button type="button" id="lo-x">Cancel</button><button class="primary" id="lo-s">Log out</button></div></form>';
    dlg.showModal(); $('#lo-k').focus();
    $('#lo-x').onclick = function () { dlg.close(); };
    $('#lof').onsubmit = function (e) {
      e.preventDefault();
      busy($('#lo-s'), api.call('logout', { key: $('#lo-k').value })).then(function () {
        dlg.close(); api.setToken(''); S.receipts = []; S.expenses = []; toast('Logged out'); go('entry');
      });
    };
  }

  /* ---------- admin report ---------- */
  function reportTab(p) {
    var R = S.rpt, sm = summary();
    p.innerHTML = '<h2>Report</h2><p class="sub">Download a well laid-out PDF, share it, or email it.</p><div class="card"><div class="grid">' +
      '<div><label>District</label><select id="r-d">' + distOptions(R.dist, 'All districts') + '</select></div>' +
      '<div><label><input type="checkbox" id="r-det" style="width:auto"' + (R.detail ? ' checked' : '') + '> Include receipt-wise details</label></div></div>' +
      '<div class="row" style="margin-top:14px"><button class="primary" id="r-dl">Download PDF</button><button id="r-sh">Share PDF…</button></div>' +
      '<div class="row" style="margin-top:10px"><input id="r-em" type="email" placeholder="Email address to send the PDF to" style="flex:1;min-width:220px"><button id="r-send">Email PDF</button></div></div>' +
      statsHtml(sm, R.dist) + '<h3>District-wise collection &amp; expenses</h3>' + summaryTable(sm, R.dist);
    $('#r-d').onchange = function () { R.dist = this.value; reportTab(p); };
    $('#r-det').onchange = function () { R.detail = this.checked; };
    var fname = 'PROFCON-2026-Report' + (R.dist ? '-' + R.dist.replace(/\s+/g, '-') : '') + '-' + today() + '.pdf';
    $('#r-dl').onclick = function () { var d = buildPdf(R); if (d) d.save(fname); };
    $('#r-sh').onclick = function () { var d = buildPdf(R); if (d) fileDoc(d, fname, 'PROFCON 2026 Report'); };
    $('#r-send').onclick = function () {
      var to = $('#r-em').value.trim(); if (!to) return toast('Enter an email address', true);
      var d = buildPdf(R); if (!d) return;
      busy($('#r-send'), api.call('emailReport', { to: to, filename: fname, pdf: d.output('datauristring').split(',')[1] })).then(function () { toast('Report emailed to ' + to); });
    };
  }

  function buildPdf(R) {
    var sm = summary(), sc = scope(sm, R.dist), rows = sm.rows.filter(function (r) { return !R.dist || r.name === R.dist; });
    var doc = pdfStart('Collection & Expense Report 2026', 'Generated: ' + dmy(today()) + '    Scope: ' + (R.dist || 'All districts')); if (!doc) return null;
    pdfCards(doc, [['Collection', sc.total.amount], ['Cash', sc.total.cash], ['UPI', sc.total.gpay], ['Account', sc.total.account], ['Expenses', sc.exp], ['Balance', sc.balance]], 114);
    pdfHeading(doc, 'District-wise collection & expenses', 184);
    var y = pdfTable(doc, {
      y: 192, font: 8.5, head: ['District', 'Receipts', 'Collection', 'Cash', 'UPI', 'Account', 'Expenses', 'Balance'],
      body: rows.map(function (r) { return [r.name, r.count, inr(r.amount), inr(r.cash), inr(r.gpay), inr(r.account), inr(r.exp), inr(r.balance)]; }),
      foot: ['Total', sc.total.count, inr(sc.total.amount), inr(sc.total.cash), inr(sc.total.gpay), inr(sc.total.account), inr(sc.exp), inr(sc.balance)],
      cols: { 1: RIGHT, 2: RIGHT, 3: RIGHT, 4: RIGHT, 5: RIGHT, 6: RIGHT, 7: RIGHT }
    });

    if (R.detail) {
      rows.filter(function (r) { return r.count; }).forEach(function (d) {
        var list = S.receipts.filter(function (r) { return r.district === d.name; });
        var yy = y + 24;
        if (yy > 740) { doc.addPage(); yy = 50; }
        pdfHeading(doc, d.name + ' - receipts', yy);
        y = pdfTable(doc, {
          y: yy + 8, pad: 3.5, head: ['#', 'Zone', 'Receipt no.', 'Total', 'Cash', 'UPI', 'Account'],
          body: list.map(function (r, i) { return [i + 1, r.zone || '', r.receiptNo, inr(r.amount), inr(r.cash), inr(r.gpay), inr(r.account)]; }),
          foot: ['', '', 'Total (' + d.count + ')', inr(d.amount), inr(d.cash), inr(d.gpay), inr(d.account)],
          cols: { 0: { cellWidth: 28 }, 3: RIGHT, 4: RIGHT, 5: RIGHT, 6: RIGHT }
        });
      });
    }

    var ex = S.expenses.filter(function (x) { return !R.dist || x.district === R.dist; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var y2 = y + 26;
    if (y2 > 660) { doc.addPage(); y2 = 50; }
    pdfHeading(doc, R.dist ? R.dist + ' - expenses' : 'PROFCON expenses', y2);
    var etotal = ex.reduce(function (a, x) { return a + +x.amount; }, 0);
    y = pdfTable(doc, {
      y: y2 + 8, pad: 3.5, head: ['Date', 'District', 'Category', 'Item', 'Amount'],
      body: ex.length ? ex.map(function (x) { return [dmy(x.date), x.district || 'General', x.category || '', x.item + (x.note ? ' (' + x.note + ')' : ''), inr(x.amount)]; }) : [[{ content: 'No expenses recorded', colSpan: 5, styles: { halign: 'center', textColor: 120 } }]],
      foot: [{ content: 'Total expenses', colSpan: 4 }, inr(etotal)], cols: { 4: RIGHT }
    });
    if (ex.length) {
      var y3 = y + 24; if (y3 > 700) { doc.addPage(); y3 = 50; }
      pdfHeading(doc, 'Category-wise expenses', y3);
      y = pdfTable(doc, { y: y3 + 8, head: ['Category', 'Amount'], body: byCategory(ex).map(function (c) { return [c[0], inr(c[1])]; }), foot: ['Total', inr(etotal)], cols: { 1: RIGHT } });
    }
    var y4 = y + 20; if (y4 > 760) { doc.addPage(); y4 = 50; }
    doc.autoTable({
      startY: y4, margin: { left: doc.W / 2, right: doc.M }, theme: 'plain', styles: { fontSize: 10.5, fontStyle: 'bold', cellPadding: 4 },
      body: [['Total collection', pr(sc.total.amount)], ['Less: expenses', pr(sc.exp)], ['Balance', pr(sc.balance)]],
      columnStyles: { 1: RIGHT }, didParseCell: function (h) { if (h.row.index === 2) { h.cell.styles.fillColor = NAVY; h.cell.styles.textColor = 255; } }
    });
    return pdfFinish(doc);
  }

  if (api.live) fetchLists().catch(function () {});   // start loading the lists before the page is even drawn
  go('entry');
  if (!lsGet('profcon_tour_done')) tour(0);
})();
