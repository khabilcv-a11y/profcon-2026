/* Talks to the Google Apps Script backend. With no API_URL it falls back to a demo
   store in this browser's localStorage so the app can be tried without a sheet. */
(function () {
  var URL_ = (window.PROFCON_CONFIG || {}).API_URL;

  var api = {
    live: !!URL_,
    token: '',   // kept in memory only: a refresh or closing the tab logs the admin out
    setToken: function (t) { api.token = t || ''; },
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
  var KEY = 'profcon_demo3';
  var SEED = window.PROFCON_SEED || {};
  function uid() { return Math.random().toString(36).slice(2, 12); }
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch (e) {}
    var st = { key: '1234', districts: [], zones: [], receipts: [], expenses: [] };
    Object.keys(SEED).forEach(function (d) {
      st.districts.push({ id: uid(), name: d });
      SEED[d].forEach(function (z) { st.zones.push({ id: uid(), district: d, name: z }); });
    });
    return st;
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
  var CATS = window.PROFCON_CATEGORIES || [];
  function cleanExp(x, needDist) {
    var c = { date: String(x.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10), district: String(x.district || '').trim(), category: String(x.category || '').trim(), item: String(x.item || '').trim(), amount: num(x.amount), note: x.note || '' };
    if (needDist && !c.district) throw new Error('Select a district');
    if (!c.item) throw new Error('Expense item is required');
    if (CATS.indexOf(c.category) < 0) throw new Error('Select a category for "' + c.item + '"');
    if (!(c.amount > 0)) throw new Error('Amount for "' + c.item + '" must be more than 0');
    return c;
  }
  function demo(action, d) {
    return new Promise(function (resolve, reject) {
      try { resolve(run(action, d)); } catch (e) { reject(e); }
    });
  }
  function run(a, d) {
    var s = load(), now = new Date().toISOString(), i;
    if (a === 'districts') return { districts: s.districts, zones: s.zones };
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
        c.zone = String(r.zone || '');
        if (c.zone && !s.zones.some(function (z) { return z.district === dist.name && z.name === c.zone; })) throw new Error('Select a valid zone for ' + dist.name);
        if (seen[c.receiptNo]) throw new Error('Receipt ' + c.receiptNo + ' is entered twice');
        if (s.receipts.some(function (x) { return x.district === dist.name && String(x.receiptNo) === c.receiptNo; })) throw new Error('Receipt ' + c.receiptNo + ' is already recorded for ' + dist.name);
        seen[c.receiptNo] = 1; return c;
      });
      list.forEach(function (c) { c.id = uid(); c.district = dist.name; c.submittedBy = d.submittedBy || ''; c.createdAt = now; c.updatedAt = now; s.receipts.push(c); });
      save(s); return { saved: list.length };
    }
    if (a === 'addExpenses') {
      var dn = s.districts.filter(function (x) { return x.name === d.district; })[0];
      if (!dn) throw new Error('Unknown district');
      if (!d.expenses || !d.expenses.length) throw new Error('No expense items to save');
      var cl = d.expenses.map(function (x) { return cleanExp(Object.assign({}, x, { district: dn.name }), true); });
      cl.forEach(function (c) { s.expenses.push(Object.assign({ id: uid(), createdAt: now, submittedBy: d.submittedBy || '' }, c)); });
      save(s); return { saved: cl.length };
    }
    if (api.token !== 'demo') throw new Error('Session expired. Please log in again.');
    switch (a) {
      case 'all': return s;
      case 'logout':
        if (String(d.key) !== s.key) throw new Error('Wrong admin key');
        api.setToken(''); return true;
      case 'updateReceipt':
        var c = clean(d.receipt); i = s.receipts.findIndex(function (x) { return x.id === d.receipt.id; });
        if (i < 0) throw new Error('Receipt not found');
        if (s.receipts.some(function (x) { return x.id !== d.receipt.id && x.district === d.receipt.district && String(x.receiptNo) === c.receiptNo; })) throw new Error('Receipt ' + c.receiptNo + ' already exists for ' + d.receipt.district);
        if (d.receipt.zone && !s.zones.some(function (z) { return z.district === d.receipt.district && z.name === d.receipt.zone; })) throw new Error('Select a valid zone for ' + d.receipt.district);
        Object.assign(s.receipts[i], c, { district: d.receipt.district, zone: d.receipt.zone || '', updatedAt: now }); save(s); return true;
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
        s.zones.forEach(function (z) { if (z.district === dd.name) z.district = nn; });
        dd.name = nn; save(s); return true;
      case 'deleteDistrict':
        var del = s.districts.filter(function (x) { return x.id === d.id; })[0];
        if (s.receipts.some(function (r) { return del && r.district === del.name; })) throw new Error('This district has receipts. Delete or move them first.');
        s.zones = s.zones.filter(function (z) { return !del || z.district !== del.name; });
        s.districts = s.districts.filter(function (x) { return x.id !== d.id; }); save(s); return true;
      case 'addZone':
        var zn = String(d.name || '').trim();
        if (!zn) throw new Error('Zone name is required');
        if (s.zones.some(function (z) { return z.district === d.district && z.name.toLowerCase() === zn.toLowerCase(); })) throw new Error('Zone already exists in ' + d.district);
        s.zones.push({ id: uid(), district: d.district, name: zn }); save(s); return true;
      case 'renameZone':
        var zz = s.zones.filter(function (z) { return z.id === d.id; })[0], zr = String(d.name || '').trim();
        if (!zz || !zr) throw new Error('Zone name is required');
        if (s.zones.some(function (z) { return z.id !== d.id && z.district === zz.district && z.name.toLowerCase() === zr.toLowerCase(); })) throw new Error('Zone already exists in ' + zz.district);
        s.receipts.forEach(function (r) { if (r.district === zz.district && r.zone === zz.name) r.zone = zr; });
        zz.name = zr; save(s); return true;
      case 'deleteZone':
        var dz = s.zones.filter(function (z) { return z.id === d.id; })[0];
        if (s.receipts.some(function (r) { return dz && r.district === dz.district && r.zone === dz.name; })) throw new Error('This zone has receipts. Delete or move them first.');
        s.zones = s.zones.filter(function (z) { return z.id !== d.id; }); save(s); return true;
      case 'addExpense':
      case 'updateExpense':
        var xe = cleanExp(d.expense, false);
        if (a === 'addExpense') s.expenses.push(Object.assign({ id: uid(), createdAt: now, submittedBy: 'admin' }, xe));
        else Object.assign(s.expenses.filter(function (y) { return y.id === d.expense.id; })[0] || {}, xe);
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
