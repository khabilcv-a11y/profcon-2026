/* Talks to the Google Apps Script backend. With no API_URL it falls back to a demo
   store in this browser's localStorage so the app can be tried without a sheet. */
(function () {
  var URL_ = (window.PROFCON_CONFIG || {}).API_URL;
  var TOKEN_KEY = 'profcon_token';

  var api = {
    live: !!URL_,
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    setToken: function (t) {
      api.token = t || '';
      if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY);
    },
    call: function (action, data) {
      data = data || {};
      if (!URL_) return demo(action, data);
      var body = Object.assign({ action: action, token: api.token }, data);
      // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight
      return fetch(URL_, { method: 'POST', body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) {
            if (/Session expired/.test(j.error)) api.setToken('');
            throw new Error(j.error);
          }
          return j.data;
        }, function () { throw new Error('Could not reach the server. Check your internet and the API_URL.'); });
    }
  };
  window.api = api;

  /* ---------------- demo store ---------------- */
  var KEY = 'profcon_demo';
  var SEED = ['Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam', 'Idukki', 'Ernakulam',
    'Thrissur', 'Palakkad', 'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod'];
  function uid() { return Math.random().toString(36).slice(2, 12); }
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch (e) {}
    return { key: '1234', districts: SEED.map(function (n) { return { id: uid(), name: n }; }), receipts: [], expenses: [] };
  }
  function save(s) { localStorage.setItem(KEY, JSON.stringify(s)); }
  function num(v) { var n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0; }
  function clean(r) {
    var o = { receiptNo: String(r.receiptNo == null ? '' : r.receiptNo).trim(), amount: num(r.amount), cash: num(r.cash), gpay: num(r.gpay), account: num(r.account) };
    if (!o.receiptNo) throw new Error('Receipt number is required');
    if (o.amount < 0 || o.cash < 0 || o.gpay < 0 || o.account < 0) throw new Error('Receipt ' + o.receiptNo + ': amounts cannot be negative');
    if (Math.abs(o.cash + o.gpay + o.account - o.amount) > 0.009) throw new Error('Receipt ' + o.receiptNo + ': Cash + GPay + Account must equal the total amount');
    return o;
  }
  function demo(action, d) {
    return new Promise(function (resolve, reject) {
      try { resolve(run(action, d)); } catch (e) { reject(e); }
    });
  }
  function run(a, d) {
    var s = load(), now = new Date().toISOString(), i;
    if (a === 'districts') return s.districts;
    if (a === 'login') {
      if (String(d.key) !== s.key) throw new Error('Wrong admin key');
      api.setToken('demo'); return { token: 'demo' };
    }
    if (a === 'addReceipts') {
      var dist = s.districts.filter(function (x) { return x.name === d.district; })[0];
      if (!dist) throw new Error('Unknown district');
      var seen = {};
      var list = d.receipts.map(function (r) {
        var c = clean(r);
        if (seen[c.receiptNo]) throw new Error('Receipt ' + c.receiptNo + ' is entered twice');
        if (s.receipts.some(function (x) { return x.district === dist.name && String(x.receiptNo) === c.receiptNo; })) throw new Error('Receipt ' + c.receiptNo + ' is already recorded for ' + dist.name);
        seen[c.receiptNo] = 1; return c;
      });
      list.forEach(function (c) { c.id = uid(); c.district = dist.name; c.submittedBy = d.submittedBy || ''; c.createdAt = now; c.updatedAt = now; s.receipts.push(c); });
      save(s); return { saved: list.length };
    }
    if (api.token !== 'demo') throw new Error('Session expired. Please log in again.');
    switch (a) {
      case 'all': return s;
      case 'updateReceipt':
        var c = clean(d.receipt); i = s.receipts.findIndex(function (x) { return x.id === d.receipt.id; });
        if (i < 0) throw new Error('Receipt not found');
        if (s.receipts.some(function (x) { return x.id !== d.receipt.id && x.district === d.receipt.district && String(x.receiptNo) === c.receiptNo; })) throw new Error('Receipt ' + c.receiptNo + ' already exists for ' + d.receipt.district);
        Object.assign(s.receipts[i], c, { district: d.receipt.district, updatedAt: now }); save(s); return true;
      case 'deleteReceipt': s.receipts = s.receipts.filter(function (x) { return x.id !== d.id; }); save(s); return true;
      case 'addDistrict':
        var n = String(d.name || '').trim();
        if (!n) throw new Error('District name is required');
        if (s.districts.some(function (x) { return x.name.toLowerCase() === n.toLowerCase(); })) throw new Error('District already exists');
        s.districts.push({ id: uid(), name: n }); save(s); return true;
      case 'renameDistrict':
        var nn = String(d.name || '').trim(), dd = s.districts.filter(function (x) { return x.id === d.id; })[0];
        if (!dd || !nn) throw new Error('District name is required');
        if (s.districts.some(function (x) { return x.id !== d.id && x.name.toLowerCase() === nn.toLowerCase(); })) throw new Error('District already exists');
        s.receipts.forEach(function (r) { if (r.district === dd.name) r.district = nn; });
        dd.name = nn; save(s); return true;
      case 'deleteDistrict':
        var del = s.districts.filter(function (x) { return x.id === d.id; })[0];
        if (s.receipts.some(function (r) { return del && r.district === del.name; })) throw new Error('This district has receipts. Delete or move them first.');
        s.districts = s.districts.filter(function (x) { return x.id !== d.id; }); save(s); return true;
      case 'addExpense':
      case 'updateExpense':
        var x = d.expense;
        if (!x.date) throw new Error('Date is required');
        if (!String(x.item || '').trim()) throw new Error('Expense item is required');
        if (!(num(x.amount) > 0)) throw new Error('Amount must be more than 0');
        var e = { date: x.date, item: String(x.item).trim(), amount: num(x.amount), note: x.note || '' };
        if (a === 'addExpense') s.expenses.push(Object.assign({ id: uid(), createdAt: now }, e));
        else Object.assign(s.expenses.filter(function (y) { return y.id === x.id; })[0] || {}, e);
        save(s); return true;
      case 'deleteExpense': s.expenses = s.expenses.filter(function (y) { return y.id !== d.id; }); save(s); return true;
      case 'changeKey':
        if (String(d.current) !== s.key) throw new Error('Current key is wrong');
        if (String(d.next || '').length < 4) throw new Error('New key must be at least 4 characters');
        s.key = String(d.next); save(s); return true;
      case 'emailReport': throw new Error('Email needs the Google Sheet backend. Use Download or Share in demo mode.');
    }
    throw new Error('Unknown action');
  }
})();
