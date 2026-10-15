(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var main = $('#main'), dlg = $('#dlg');
  var S = { districts: [], receipts: [], expenses: [], tab: 'summary', view: 'entry', draft: [], dist: '', by: '', rfilter: '', rsearch: '', rpt: { dist: '', detail: true } };

  /* ---------- helpers ---------- */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inr(n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function toast(msg, err) {
    var t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, 3200);
  }
  function busy(btn, p) {
    if (btn) btn.disabled = true;
    return p.then(function (r) { if (btn) btn.disabled = false; return r; }, function (e) { if (btn) btn.disabled = false; toast(e.message, true); throw e; });
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dmy(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : s || ''; }
  function loggedIn() { return !!api.token; }

  /* ---------- totals (shared by screen + PDF) ---------- */
  function sum(list) {
    return list.reduce(function (t, r) { t.count++; t.amount += +r.amount; t.cash += +r.cash; t.gpay += +r.gpay; t.account += +r.account; return t; }, { count: 0, amount: 0, cash: 0, gpay: 0, account: 0 });
  }
  function summary() {
    var rows = S.districts.map(function (d) { return Object.assign({ name: d.name }, sum(S.receipts.filter(function (r) { return r.district === d.name; }))); });
    var total = sum(S.receipts);
    var exp = S.expenses.reduce(function (a, x) { return a + +x.amount; }, 0);
    return { rows: rows, total: total, exp: exp, balance: total.amount - exp };
  }

  /* ---------- navigation ---------- */
  function nav() {
    var n = $('#nav');
    n.innerHTML = '<button data-v="entry">Enter receipts</button><button data-v="admin">' + (loggedIn() ? 'Admin' : 'Admin login') + '</button>';
    [].forEach.call(n.children, function (b) { if ((b.dataset.v === 'entry') === (S.view === 'entry')) b.className = 'on'; b.onclick = function () { go(b.dataset.v); }; });
  }
  function go(v) {
    S.view = v;
    nav();
    if (v === 'entry') return entryView();
    if (!loggedIn()) return loginView();
    refresh().then(adminView);
  }
  function refresh() {
    return api.call('all').then(function (d) { S.districts = d.districts; S.receipts = d.receipts; S.expenses = d.expenses; })
      .catch(function (e) { toast(e.message, true); if (!loggedIn()) { nav(); loginView(); } throw e; });
  }
  function demoBanner() { return api.live ? '' : '<div class="banner">Demo mode: data is saved only in this browser. Set <b>API_URL</b> in <code>js/config.js</code> to use the Google Sheet.</div>'; }

  /* ---------- entry (public) ---------- */
  function entryView() {
    main.innerHTML = demoBanner() + '<h2>Enter receipts</h2><p class="sub">Choose your district, say how many receipts you are holding, then fill one row per receipt.</p>' +
      '<div class="card"><div class="grid">' +
      '<div><label for="dist">District</label><select id="dist"><option value="">Loading…</option></select></div>' +
      '<div><label for="cnt">Number of receipts in hand</label><input id="cnt" type="number" min="1" max="200" inputmode="numeric" placeholder="e.g. 5"></div>' +
      '<div><label for="by">Your name (optional)</label><input id="by" maxlength="80"></div>' +
      '<div><button class="primary" id="gen">Add receipt rows</button></div></div></div><div id="rows"></div>';
    api.call('districts').then(function (list) {
      S.districts = list;
      $('#dist').innerHTML = '<option value="">Select district…</option>' + list.map(function (d) { return '<option>' + esc(d.name) + '</option>'; }).join('');
      $('#dist').value = S.dist;
    }).catch(function (e) { toast(e.message, true); });
    $('#by').value = S.by;
    $('#dist').onchange = function () { S.dist = this.value; };
    $('#by').oninput = function () { S.by = this.value; };
    $('#gen').onclick = function () {
      var n = Math.floor(num($('#cnt').value));
      if (!$('#dist').value) return toast('Select a district first', true);
      if (n < 1 || n > 200) return toast('Enter a number of receipts between 1 and 200', true);
      while (S.draft.length < n) S.draft.push({ receiptNo: '', amount: '', cash: '', gpay: '', account: '' });
      S.draft.length = n;
      draftTable();
    };
    if (S.draft.length) { $('#cnt').value = S.draft.length; draftTable(); }
  }
  function draftTable() {
    $('#rows').innerHTML = '<div class="tablewrap"><table><thead><tr><th>#</th><th>Receipt no.</th><th class="n">Total amount</th><th class="n">Cash</th><th class="n">GPay</th><th class="n">Account</th><th>Check</th></tr></thead><tbody>' +
      S.draft.map(function (r, i) {
        return '<tr data-i="' + i + '"><td>' + (i + 1) + '</td><td><input class="no" data-f="receiptNo" value="' + esc(r.receiptNo) + '"></td>' +
          ['amount', 'cash', 'gpay', 'account'].map(function (f) { return '<td><input type="number" min="0" step="0.01" inputmode="decimal" data-f="' + f + '" value="' + esc(r[f]) + '"></td>'; }).join('') +
          '<td class="chk"></td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="2">Total</td><td class="n" id="t-amount"></td><td class="n" id="t-cash"></td><td class="n" id="t-gpay"></td><td class="n" id="t-account"></td><td></td></tr></tfoot></table></div>' +
      '<p class="note">Cash + GPay + Account must equal the total amount of each receipt.</p><div class="row end"><button id="clr">Clear</button><button class="primary" id="sub">Submit receipts</button></div>';
    $('#rows tbody').oninput = function (e) {
      var tr = e.target.closest('tr'); if (!tr) return;
      S.draft[tr.dataset.i][e.target.dataset.f] = e.target.value; draftCheck();
    };
    $('#clr').onclick = function () { S.draft = []; $('#rows').innerHTML = ''; $('#cnt').value = ''; };
    $('#sub').onclick = submitDraft;
    draftCheck();
  }
  function rowDiff(r) { return num(r.amount) - num(r.cash) - num(r.gpay) - num(r.account); }
  function draftCheck() {
    var all = true;
    [].forEach.call(document.querySelectorAll('#rows tbody tr'), function (tr) {
      var r = S.draft[tr.dataset.i], c = tr.querySelector('.chk'), d = rowDiff(r);
      if (!r.receiptNo.trim() && !r.amount) { c.textContent = '—'; c.className = 'chk note'; all = false; return; }
      if (!r.receiptNo.trim() || r.amount === '') { c.textContent = 'Incomplete'; c.className = 'chk bad'; all = false; }
      else if (Math.abs(d) > 0.009) { c.textContent = (d > 0 ? '₹' + inr(d) + ' short' : '₹' + inr(-d) + ' extra'); c.className = 'chk bad'; all = false; }
      else { c.textContent = '✓'; c.className = 'chk ok'; }
    });
    var t = sum(S.draft.map(function (r) { return { amount: num(r.amount), cash: num(r.cash), gpay: num(r.gpay), account: num(r.account) }; }));
    ['amount', 'cash', 'gpay', 'account'].forEach(function (f) { $('#t-' + f).textContent = '₹' + inr(t[f]); });
    return all;
  }
  function submitDraft() {
    if (!$('#dist').value) return toast('Select a district first', true);
    if (!draftCheck()) return toast('Fix the rows marked in red first', true);
    var nos = S.draft.map(function (r) { return r.receiptNo.trim(); });
    if (nos.some(function (n, i) { return nos.indexOf(n) !== i; })) return toast('A receipt number is repeated in this list', true);
    var t = sum(S.draft.map(function (r) { return { amount: num(r.amount), cash: num(r.cash), gpay: num(r.gpay), account: num(r.account) }; }));
    if (!confirm('Submit ' + S.draft.length + ' receipts for ' + $('#dist').value + '?\nTotal ₹' + inr(t.amount) + ' (Cash ₹' + inr(t.cash) + ', GPay ₹' + inr(t.gpay) + ', Account ₹' + inr(t.account) + ')')) return;
    busy($('#sub'), api.call('addReceipts', { district: $('#dist').value, submittedBy: S.by, receipts: S.draft })).then(function (r) {
      var dn = $('#dist').value; S.draft = [];
      main.innerHTML = '<div class="card"><h2 class="ok">✓ ' + r.saved + ' receipts saved</h2><p>District: <b>' + esc(dn) + '</b> · Total ₹' + inr(t.amount) + '</p><p class="note">Any correction must be made by the admin.</p><button class="primary" id="again">Enter more receipts</button></div>';
      $('#again').onclick = entryView;
    });
  }

  /* ---------- admin login ---------- */
  function loginView() {
    main.innerHTML = demoBanner() + '<div class="card" style="max-width:380px;margin:30px auto"><h2>Admin login</h2><p class="sub">Enter the admin key.</p>' +
      '<form id="lf"><label for="key">Admin key</label><input id="key" type="password" autocomplete="current-password" autofocus><div class="row end" style="margin-top:12px"><button class="primary">Log in</button></div></form></div>';
    $('#lf').onsubmit = function (e) {
      e.preventDefault();
      busy($('#lf button'), api.call('login', { key: $('#key').value })).then(function (r) { api.setToken(r.token); go('admin'); });
    };
  }

  /* ---------- admin ---------- */
  var TABS = [['summary', 'Summary'], ['receipts', 'Receipts'], ['districts', 'Districts'], ['expenses', 'PROFCON expenses'], ['report', 'Report / PDF'], ['settings', 'Settings']];
  function adminView() {
    nav();
    main.innerHTML = '<div class="tabs">' + TABS.map(function (t) { return '<button data-t="' + t[0] + '"' + (S.tab === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div><div id="pane"></div>';
    [].forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.onclick = function () { S.tab = b.dataset.t; adminView(); }; });
    var p = $('#pane');
    ({ summary: summaryTab, receipts: receiptsTab, districts: districtsTab, expenses: expensesTab, report: reportTab, settings: settingsTab })[S.tab](p);
  }
  function reload() { return refresh().then(adminView); }

  function summaryTable(sm, onlyDist) {
    var rows = sm.rows.filter(function (r) { return !onlyDist || r.name === onlyDist; });
    return '<div class="tablewrap"><table><thead><tr><th>District</th><th class="n">Receipts</th><th class="n">Collection</th><th class="n">Cash</th><th class="n">GPay</th><th class="n">Account</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td class="n">' + r.count + '</td><td class="n">' + inr(r.amount) + '</td><td class="n">' + inr(r.cash) + '</td><td class="n">' + inr(r.gpay) + '</td><td class="n">' + inr(r.account) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="n">' + sm.total.count + '</td><td class="n">' + inr(sm.total.amount) + '</td><td class="n">' + inr(sm.total.cash) + '</td><td class="n">' + inr(sm.total.gpay) + '</td><td class="n">' + inr(sm.total.account) + '</td></tr></tfoot></table></div>';
  }
  function statsHtml(sm) {
    return '<div class="stats"><div class="stat"><span>Total collection</span><b>₹' + inr(sm.total.amount) + '</b></div><div class="stat"><span>Cash</span><b>₹' + inr(sm.total.cash) + '</b></div><div class="stat"><span>GPay</span><b>₹' + inr(sm.total.gpay) + '</b></div><div class="stat"><span>Account</span><b>₹' + inr(sm.total.account) + '</b></div><div class="stat"><span>Expenses</span><b>₹' + inr(sm.exp) + '</b></div><div class="stat"><span>Balance</span><b>₹' + inr(sm.balance) + '</b></div></div>';
  }
  function summaryTab(p) {
    var sm = summary();
    p.innerHTML = '<h2>Summary</h2><p class="sub">District-wise collection received so far. Balance = collection − expenses.</p>' + statsHtml(sm) + summaryTable(sm);
  }

  function receiptsTab(p) {
    var list = S.receipts.filter(function (r) { return (!S.rfilter || r.district === S.rfilter) && (!S.rsearch || String(r.receiptNo).toLowerCase().indexOf(S.rsearch.toLowerCase()) >= 0); });
    p.innerHTML = '<h2>Receipts</h2><div class="card"><div class="grid"><div><label>District</label><select id="rf"><option value="">All districts</option>' + S.districts.map(function (d) { return '<option' + (d.name === S.rfilter ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select></div>' +
      '<div><label>Search receipt no.</label><input id="rs" value="' + esc(S.rsearch) + '"></div></div></div>' +
      '<div class="tablewrap"><table><thead><tr><th>District</th><th>Receipt no.</th><th class="n">Total</th><th class="n">Cash</th><th class="n">GPay</th><th class="n">Account</th><th>By</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (r) {
        return '<tr><td>' + esc(r.district) + '</td><td>' + esc(r.receiptNo) + '</td><td class="n">' + inr(r.amount) + '</td><td class="n">' + inr(r.cash) + '</td><td class="n">' + inr(r.gpay) + '</td><td class="n">' + inr(r.account) + '</td><td>' + esc(r.submittedBy) + '</td><td><button class="sm" data-e="' + esc(r.id) + '">Edit</button> <button class="sm danger" data-d="' + esc(r.id) + '">Delete</button></td></tr>';
      }).join('') : '<tr><td colspan="8" class="empty">No receipts yet.</td></tr>') + '</tbody>' + (list.length ? '<tfoot><tr><td colspan="2">' + list.length + ' receipts</td><td class="n">' + inr(sum(list).amount) + '</td><td class="n">' + inr(sum(list).cash) + '</td><td class="n">' + inr(sum(list).gpay) + '</td><td class="n">' + inr(sum(list).account) + '</td><td colspan="2"></td></tr></tfoot>' : '') + '</table></div>';
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
      '<div><label>District</label><select id="e-district">' + S.districts.map(function (d) { return '<option' + (d.name === r.district ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select></div>' +
      '<div><label>Receipt no.</label><input id="e-receiptNo" value="' + esc(r.receiptNo) + '"></div>' +
      ['amount', 'cash', 'gpay', 'account'].map(function (f) { return '<div><label>' + { amount: 'Total amount', cash: 'Cash', gpay: 'GPay', account: 'Account' }[f] + '</label><input type="number" min="0" step="0.01" id="e-' + f + '" value="' + r[f] + '"></div>'; }).join('') +
      '</div><p class="note" id="e-chk"></p><div class="row end"><button type="button" id="e-x">Cancel</button><button class="primary" id="e-s">Save</button></div></form>';
    dlg.showModal();
    function chk() { var d = num($('#e-amount').value) - num($('#e-cash').value) - num($('#e-gpay').value) - num($('#e-account').value); $('#e-chk').innerHTML = Math.abs(d) < 0.01 ? '<span class="ok">✓ Cash + GPay + Account match the total</span>' : '<span class="bad">Difference: ₹' + inr(d) + '</span>'; }
    dlg.oninput = chk; chk();
    $('#e-x').onclick = function () { dlg.close(); };
    $('#ef').onsubmit = function (e) {
      e.preventDefault();
      var rec = { id: r.id, district: $('#e-district').value, receiptNo: $('#e-receiptNo').value.trim() };
      ['amount', 'cash', 'gpay', 'account'].forEach(function (f) { rec[f] = num($('#e-' + f).value); });
      busy($('#e-s'), api.call('updateReceipt', { receipt: rec })).then(function () { dlg.close(); toast('Saved'); reload(); });
    };
  }

  function districtsTab(p) {
    p.innerHTML = '<h2>Districts</h2><div class="card"><form id="df" class="row"><input id="dn" placeholder="New district name" style="flex:1;min-width:200px"><button class="primary">Add district</button></form></div>' +
      '<div class="tablewrap"><table><thead><tr><th>District</th><th class="n">Receipts</th><th></th></tr></thead><tbody>' +
      S.districts.map(function (d) {
        var n = S.receipts.filter(function (r) { return r.district === d.name; }).length;
        return '<tr><td>' + esc(d.name) + '</td><td class="n">' + n + '</td><td><button class="sm" data-r="' + esc(d.id) + '">Rename</button> <button class="sm danger" data-d="' + esc(d.id) + '"' + (n ? ' disabled title="Has receipts"' : '') + '>Delete</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    $('#df').onsubmit = function (e) { e.preventDefault(); busy($('#df button'), api.call('addDistrict', { name: $('#dn').value })).then(function () { toast('District added'); reload(); }); };
    p.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var d = S.districts.filter(function (x) { return x.id === (b.dataset.r || b.dataset.d); })[0];
      if (b.dataset.r) { var nn = prompt('Rename district', d.name); if (nn && nn.trim() !== d.name) busy(b, api.call('renameDistrict', { id: d.id, name: nn })).then(function () { toast('Renamed'); reload(); }); }
      if (b.dataset.d && confirm('Delete district "' + d.name + '"?')) busy(b, api.call('deleteDistrict', { id: d.id })).then(function () { toast('Deleted'); reload(); });
    };
  }

  function expensesTab(p) {
    var list = S.expenses.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    p.innerHTML = '<h2>PROFCON expenses</h2><div class="card"><form id="xf"><div class="grid">' +
      '<div><label>Date</label><input type="date" id="x-date" value="' + today() + '" required></div><div><label>Item</label><input id="x-item" maxlength="200" required></div>' +
      '<div><label>Amount (₹)</label><input type="number" id="x-amount" min="0.01" step="0.01" required></div><div><label>Note (optional)</label><input id="x-note" maxlength="300"></div>' +
      '<div><button class="primary">Add expense</button></div></div></form></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Item</th><th class="n">Amount</th><th>Note</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (x) { return '<tr><td>' + dmy(x.date) + '</td><td>' + esc(x.item) + '</td><td class="n">' + inr(x.amount) + '</td><td>' + esc(x.note) + '</td><td><button class="sm" data-e="' + esc(x.id) + '">Edit</button> <button class="sm danger" data-d="' + esc(x.id) + '">Delete</button></td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">No expenses yet.</td></tr>') +
      '</tbody><tfoot><tr><td colspan="2">Total expenses</td><td class="n">' + inr(summary().exp) + '</td><td colspan="2"></td></tr></tfoot></table></div>';
    $('#xf').onsubmit = function (e) {
      e.preventDefault();
      busy($('#xf button'), api.call('addExpense', { expense: { date: $('#x-date').value, item: $('#x-item').value, amount: $('#x-amount').value, note: $('#x-note').value } })).then(function () { toast('Expense added'); reload(); });
    };
    p.onclick = function (e) {
      var b = e.target.closest('button'); if (!b || b.form) return;
      if (b.dataset.d && confirm('Delete this expense?')) busy(b, api.call('deleteExpense', { id: b.dataset.d })).then(function () { toast('Deleted'); reload(); });
      if (b.dataset.e) editExpense(S.expenses.filter(function (x) { return x.id === b.dataset.e; })[0]);
    };
  }
  function editExpense(x) {
    dlg.innerHTML = '<form id="ef"><h2>Edit expense</h2><div class="grid" style="margin:12px 0"><div><label>Date</label><input type="date" id="e-date" value="' + esc(x.date) + '" required></div><div><label>Item</label><input id="e-item" value="' + esc(x.item) + '" required></div>' +
      '<div><label>Amount (₹)</label><input type="number" id="e-amount" min="0.01" step="0.01" value="' + x.amount + '" required></div><div><label>Note</label><input id="e-note" value="' + esc(x.note) + '"></div></div>' +
      '<div class="row end"><button type="button" id="e-x">Cancel</button><button class="primary" id="e-s">Save</button></div></form>';
    dlg.oninput = null; dlg.showModal();
    $('#e-x').onclick = function () { dlg.close(); };
    $('#ef').onsubmit = function (e) {
      e.preventDefault();
      busy($('#e-s'), api.call('updateExpense', { expense: { id: x.id, date: $('#e-date').value, item: $('#e-item').value, amount: $('#e-amount').value, note: $('#e-note').value } })).then(function () { dlg.close(); toast('Saved'); reload(); });
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
    $('#lo').onclick = function () { api.setToken(''); S.receipts = []; S.expenses = []; go('entry'); };
  }

  /* ---------- report + PDF ---------- */
  function reportTab(p) {
    var R = S.rpt, sm = summary();
    p.innerHTML = '<h2>Report</h2><p class="sub">Download a well laid-out PDF, share it, or email it.</p><div class="card"><div class="grid">' +
      '<div><label>District</label><select id="r-d"><option value="">All districts</option>' + S.districts.map(function (d) { return '<option' + (d.name === R.dist ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select></div>' +
      '<div><label><input type="checkbox" id="r-det" style="width:auto"' + (R.detail ? ' checked' : '') + '> Include receipt-wise details</label></div></div>' +
      '<div class="row" style="margin-top:14px"><button class="primary" id="r-dl">Download PDF</button><button id="r-sh">Share PDF…</button></div>' +
      '<div class="row" style="margin-top:10px"><input id="r-em" type="email" placeholder="Email address to send the PDF to" style="flex:1;min-width:220px"><button id="r-send">Email PDF</button></div></div>' +
      statsHtml(sm) + '<h3>District-wise collection</h3>' + summaryTable(sm, R.dist);
    $('#r-d').onchange = function () { R.dist = this.value; reportTab(p); };
    $('#r-det').onchange = function () { R.detail = this.checked; };
    var fname = 'PROFCON-2026-Report-' + today() + '.pdf';
    function pdf() { if (!window.jspdf) { toast('PDF library did not load. Check your internet.', true); return null; } return buildPdf(R); }
    $('#r-dl').onclick = function () { var d = pdf(); if (d) d.save(fname); };
    $('#r-sh').onclick = function () {
      var d = pdf(); if (!d) return;
      var file = new File([d.output('blob')], fname, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: 'PROFCON 2026 Report' }).catch(function () {});
      else { d.save(fname); toast('Sharing is not supported here. PDF downloaded — attach it in WhatsApp or email.'); }
    };
    $('#r-send').onclick = function () {
      var to = $('#r-em').value.trim(); if (!to) return toast('Enter an email address', true);
      var d = pdf(); if (!d) return;
      busy($('#r-send'), api.call('emailReport', { to: to, filename: fname, pdf: d.output('datauristring').split(',')[1] })).then(function () { toast('Report emailed to ' + to); });
    };
  }

  var LOGO = null;
  (function () {
    var im = new Image();
    im.onload = function () { var c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); try { LOGO = c.toDataURL('image/png'); } catch (e) {} };
    im.src = 'assets/logo-wordmark.png';
  })();

  function buildPdf(R) {
    var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), W = doc.internal.pageSize.getWidth(), M = 36;
    var NAVY = [23, 95, 154], GOLD = [214, 33, 42], pr = function (n) { return 'Rs. ' + inr(n); };
    var sm = summary(), rows = sm.rows.filter(function (r) { return !R.dist || r.name === R.dist; });
    var total = R.dist ? rows[0] || { count: 0, amount: 0, cash: 0, gpay: 0, account: 0 } : sm.total;
    if (LOGO) doc.addImage(LOGO, 'PNG', M, 20, 150, 30);
    else { doc.setTextColor.apply(doc, NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text('PROFCON', M, 44); }
    doc.setTextColor(16, 43, 70); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('30th Edition  |  Wisdom Students', W - M, 32, { align: 'right' });
    doc.setFontSize(15); doc.text('Collection & Expense Report 2026', W - M, 50, { align: 'right' });
    doc.setFillColor.apply(doc, NAVY); doc.rect(0, 66, W, 3, 'F');
    doc.setFillColor.apply(doc, GOLD); doc.rect(0, 69, W * 0.18, 3, 'F');
    doc.setTextColor(60); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Generated: ' + dmy(today()) + '    Scope: ' + (R.dist || 'All districts'), M, 98);

    var cards = [['Total collection', total.amount], ['Cash', total.cash], ['GPay', total.gpay], ['Account', total.account]];
    if (!R.dist) cards.push(['Expenses', sm.exp], ['Balance', sm.balance]);
    var cw = (W - 2 * M - (cards.length - 1) * 8) / cards.length;
    cards.forEach(function (c, i) {
      var x = M + i * (cw + 8);
      doc.setDrawColor(210); doc.setFillColor(247, 249, 253); doc.roundedRect(x, 114, cw, 46, 5, 5, 'FD');
      doc.setFontSize(7.5); doc.setTextColor(100); doc.text(c[0].toUpperCase(), x + 8, 129);
      doc.setFontSize(10.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(20); doc.text(pr(c[1]), x + 8, 149); doc.setFont('helvetica', 'normal');
    });

    var head = { fillColor: NAVY, textColor: 255, fontSize: 9 }, foot = { fillColor: [232, 238, 247], textColor: 20, fontStyle: 'bold' };
    var right = { halign: 'right' };
    function title(t, y) { doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor.apply(doc, NAVY); doc.text(t, M, y); doc.setFont('helvetica', 'normal'); }
    title('District-wise collection', 184);
    doc.autoTable({
      startY: 192, margin: { left: M, right: M }, theme: 'grid', headStyles: head, footStyles: foot, styles: { fontSize: 9, cellPadding: 4 }, alternateRowStyles: { fillColor: [248, 249, 253] },
      head: [['District', 'Receipts', 'Collection', 'Cash', 'GPay', 'Account']],
      body: rows.map(function (r) { return [r.name, r.count, inr(r.amount), inr(r.cash), inr(r.gpay), inr(r.account)]; }),
      foot: [['Total', total.count, inr(total.amount), inr(total.cash), inr(total.gpay), inr(total.account)]], showFoot: 'lastPage',
      columnStyles: { 1: right, 2: right, 3: right, 4: right, 5: right }
    });

    if (R.detail) {
      rows.filter(function (r) { return r.count; }).forEach(function (d) {
        var list = S.receipts.filter(function (r) { return r.district === d.name; });
        var y = doc.lastAutoTable.finalY + 24;
        if (y > 740) { doc.addPage(); y = 50; }
        title(d.name + ' - receipts', y);
        doc.autoTable({
          startY: y + 8, margin: { left: M, right: M }, theme: 'grid', headStyles: head, footStyles: foot, styles: { fontSize: 9, cellPadding: 3.5 }, alternateRowStyles: { fillColor: [248, 249, 253] },
          head: [['#', 'Receipt no.', 'Total', 'Cash', 'GPay', 'Account']],
          body: list.map(function (r, i) { return [i + 1, r.receiptNo, inr(r.amount), inr(r.cash), inr(r.gpay), inr(r.account)]; }),
          foot: [['', 'Total (' + d.count + ')', inr(d.amount), inr(d.cash), inr(d.gpay), inr(d.account)]], showFoot: 'lastPage',
          columnStyles: { 0: { cellWidth: 28 }, 2: right, 3: right, 4: right, 5: right }
        });
      });
    }

    if (!R.dist) {
      var y2 = doc.lastAutoTable.finalY + 26;
      if (y2 > 680) { doc.addPage(); y2 = 50; }
      title('PROFCON expenses', y2);
      var ex = S.expenses.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      doc.autoTable({
        startY: y2 + 8, margin: { left: M, right: M }, theme: 'grid', headStyles: head, footStyles: foot, styles: { fontSize: 9, cellPadding: 3.5 }, alternateRowStyles: { fillColor: [248, 249, 253] },
        head: [['Date', 'Item', 'Note', 'Amount']],
        body: ex.length ? ex.map(function (x) { return [dmy(x.date), x.item, x.note || '', inr(x.amount)]; }) : [[{ content: 'No expenses recorded', colSpan: 4, styles: { halign: 'center', textColor: 120 } }]],
        foot: [[{ content: 'Total expenses', colSpan: 3 }, inr(sm.exp)]], showFoot: 'lastPage', columnStyles: { 3: right }
      });
      var y3 = doc.lastAutoTable.finalY + 20; if (y3 > 760) { doc.addPage(); y3 = 50; }
      doc.autoTable({
        startY: y3, margin: { left: W / 2, right: M }, theme: 'plain', styles: { fontSize: 10.5, fontStyle: 'bold', cellPadding: 4 },
        body: [['Total collection', pr(sm.total.amount)], ['Less: expenses', pr(sm.exp)], ['Balance', pr(sm.balance)]],
        columnStyles: { 1: right }, didParseCell: function (h) { if (h.row.index === 2) { h.cell.styles.fillColor = NAVY; h.cell.styles.textColor = 255; } }
      });
    }

    var pages = doc.getNumberOfPages();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(130);
      doc.text('To the Right Goal Through the Right Path  |  Wisdom Students - PROFCON 2026', M, 822); doc.text('Page ' + i + ' of ' + pages, W - M, 822, { align: 'right' });
    }
    return doc;
  }

  go('entry');
})();
