/**
 * PROFCON 2026 Receipts - Google Apps Script backend.
 * Bound to the Google Sheet that stores the data. Deploy as a Web app
 * (Execute as: Me, Who has access: Anyone) and paste the URL into profcon/js/config.js.
 * The sheet stays private; every read/write goes through the checks below.
 */
var DEFAULT_KEY = '1234';
var SESSION_SECONDS = 21600;   // 6 hours
var MAX_FAILS = 5;             // wrong keys before a 15 minute lock

var TABS = {
  Districts: ['id', 'name'],
  Zones:     ['id', 'district', 'name'],
  Receipts:  ['id', 'district', 'zone', 'receiptNo', 'amount', 'cash', 'gpay', 'account', 'submittedBy', 'createdAt', 'updatedAt'],
  Expenses:  ['id', 'date', 'district', 'category', 'item', 'amount', 'note', 'submittedBy', 'createdAt'],
  Settings:  ['key', 'value']
};
var CATEGORIES = ['Food', 'Travel allowance', 'Programme expense', 'Transportation cost', 'Accommodation', 'Printing & publicity', 'Other'];
var TEXT_COLS = { Receipts: ['receiptNo'], Expenses: ['date'] };   // keep as text (no auto date / number conversion)
var NUM_COLS  = { Receipts: ['amount', 'cash', 'gpay', 'account'], Expenses: ['amount'] };
var SEED = {"Trivandrum": ["Thiruvananthapuram", "Thiruvananthapuram East", "Kaniyapuram", "Attingal", "Venjaramood", "Nedumangad", "Kattakkada", "Varkala"], "Kollam": ["Kollam", "Karunagappalli", "Pathanapuram"], "Alappuzha": ["Kayamkulam", "Alappuzha", "Kuthiyathodu", "Naduvathu Nagar"], "Kottayam": ["Kottayam", "Kanjirappally", "Erattupetta"], "Idukki": ["Thodupuzha", "Adimaly", "Peerumedu"], "Ernakulam": ["Aluva", "Perumbavoor", "Kothamangalam", "Paravoor", "Ernakulam", "Thripunithura", "Kochi", "Palluruthy", "Kakkanad"], "Thrissur": ["Chavakkad", "Pavaratty", "Kunnamkulam", "Guruvayur", "Thrissur", "Kodungallur", "Kaipamangalam"], "Palakkad": ["Edathanattukara", "Alanallur", "Mannarkkad", "Thachampara", "Olavakode", "Palakkad", "Alathur", "Ottapalam", "Pattambi", "Chittur", "Koppam"], "Malappuram West": ["University", "Peruvallur", "Abdurahman Nager", "Vengara", "Tiroorangadi", "Parappanagadi", "Thanur", "Thanalur", "Kottakkal", "Valavannur", "Randathani", "Moonniyoor"], "Malappuram North": ["Areekode", "Edavannappara", "Pulikkal", "Kondoty", "Mongam", "Malappuram", "Manjeri", "Trikkalangode", "Kavanur", "Anakkayam", "Cherukavu", "Mankada", "Pulpatta", "Keezhuparamba", "Chattipparamba"], "Malappuram East": ["Perintalmanna", "Pandikkad", "Karuvarakund", "Kalikavu", "Amarambalam", "Wandoor", "Edavanna", "Othayi", "Mampad", "Nilamboor", "Chungathara", "Edakkara", "Moothedam", "Angaadipuram", "Aanamangad", "Pattikkad", "Pulamanthole"], "Calicut South": ["Farook", "Kallai", "Beypore", "City", "Mankav", "Medical College", "Karapparamb", "Nanmanda", "Narikuni East", "Atholi", "Kodiyathoor", "Thamarasseri", "Koduvalli", "Mukkam", "Ramanattukara", "Narikuni West"], "Calicut North": ["Balusserry", "Poonur", "Koyilandy", "Payyoli", "Vatakara", "Nadapuram", "Perambra"], "Wayanad": ["Kalpetta", "Bathery", "Mananthavady", "Gudalur"], "Kannur": ["Valapattanam", "Taliparamba", "Irikkoor", "Pazhayangadi", "Payyanur", "Kannur", "Kuthuparamba", "Iritty", "Panoor", "Thalassery", "Kambil", "Chakkarakkal", "Kannavam"], "Kasargode": ["Manjeshwaram", "Kumbala", "Kasaragod", "Uduma", "Kanhangad", "Trikaripur", "Badiyadka", "Cherkkalam", "Uppala", "Bekal", "Parappa"], "Malappuram South": ["Tirur", "Alathiyoor", "Marancheri", "Ponnani", "Koottanad", "Valanjeri", "Changaramkulam", "Paravanna", "Kuttippuram", "Thirunavaya"]};

/* Run this once from the editor: creates the tabs, districts and the default key. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = TABS[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#e8eef7');
    sh.setFrozenRows(1);
    (TEXT_COLS[name] || []).forEach(function (c) { sh.getRange(2, cols.indexOf(c) + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@'); });
  });
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  // Fresh start (or upgrading from the old district-only list): load districts + zones.
  // Never touches the data once any receipts exist.
  if (!rows_('Zones').length && !rows_('Receipts').length) {
    var dsh = sheet_('Districts');
    if (dsh.getLastRow() > 1) dsh.deleteRows(2, dsh.getLastRow() - 1);
    Object.keys(SEED).forEach(function (d) {
    append_('Districts', { id: uid_(), name: d });
    SEED[d].forEach(function (z) { append_('Zones', { id: uid_(), district: d, name: z }); });
  });
  }
  if (!getSetting_('keyHash')) setKey_(DEFAULT_KEY);
}

function doGet() { return json_({ ok: true, service: 'PROFCON Receipts API' }); }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var req = JSON.parse(e.postData.contents);
    return json_({ ok: true, data: route_(req) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ------------------------------------------------------------------ */
function route_(req) {
  var a = req.action;
  // Open to everyone with the link
  if (a === 'districts') return { districts: rows_('Districts'), zones: rows_('Zones') };
  if (a === 'addReceipts') return addReceipts_(req);
  if (a === 'addExpenses') return addExpenses_(req);
  if (a === 'login') return login_(req.key);
  // Everything below needs an admin session
  requireAdmin_(req.token);
  switch (a) {
    case 'all':           return { districts: rows_('Districts'), zones: rows_('Zones'), receipts: rows_('Receipts'), expenses: rows_('Expenses') };
    case 'updateReceipt': return updateReceipt_(req.receipt);
    case 'deleteReceipt': remove_('Receipts', req.id); return true;
    case 'addDistrict':   return addDistrict_(req.name);
    case 'renameDistrict': return renameDistrict_(req.id, req.name);
    case 'deleteDistrict': return deleteDistrict_(req.id);
    case 'addZone':       return addZone_(req.district, req.name);
    case 'renameZone':    return renameZone_(req.id, req.name);
    case 'deleteZone':    return deleteZone_(req.id);
    case 'addExpense':    return saveExpense_(req.expense, true);
    case 'updateExpense': return saveExpense_(req.expense, false);
    case 'deleteExpense': remove_('Expenses', req.id); return true;
    case 'changeKey':     return changeKey_(req.current, req.next);
    case 'emailReport':   return emailReport_(req);
  }
  throw new Error('Unknown action');
}

/* ---------- auth ---------- */
function login_(key) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) throw new Error('Too many wrong attempts. Try again in 15 minutes.');
  if (!checkKey_(String(key || ''))) {
    cache.put('fails', String(fails + 1), 900);
    throw new Error('Wrong admin key');
  }
  cache.remove('fails');
  var token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('s_' + token, '1', SESSION_SECONDS);
  return { token: token };
}
function requireAdmin_(token) {
  if (!token || !CacheService.getScriptCache().get('s_' + token)) throw new Error('Session expired. Please log in again.');
}
function hash_(key, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + key);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function setKey_(key) {
  var salt = Utilities.getUuid();
  setSetting_('salt', salt);
  setSetting_('keyHash', hash_(key, salt));
}
function checkKey_(key) { return hash_(key, getSetting_('salt')) === getSetting_('keyHash'); }
function changeKey_(current, next) {
  if (!checkKey_(String(current || ''))) throw new Error('Current key is wrong');
  next = String(next || '');
  if (next.length < 4) throw new Error('New key must be at least 4 characters');
  setKey_(next);
  return true;
}

/* ---------- receipts ---------- */
function cleanReceipt_(r) {
  var out = {
    receiptNo: String(r.receiptNo == null ? '' : r.receiptNo).trim(),
    amount: num_(r.amount), cash: num_(r.cash), gpay: num_(r.gpay), account: num_(r.account)
  };
  if (!out.receiptNo) throw new Error('Receipt number is required');
  if (out.amount < 0 || out.cash < 0 || out.gpay < 0 || out.account < 0) throw new Error('Receipt ' + out.receiptNo + ': amounts cannot be negative');
  if (Math.abs(out.cash + out.gpay + out.account - out.amount) > 0.009)
    throw new Error('Receipt ' + out.receiptNo + ': Cash + GPay + Account must equal the total amount');
  return out;
}
function districtName_(name) {
  var d = rows_('Districts').filter(function (x) { return x.name === name; })[0];
  if (!d) throw new Error('Unknown district');
  return d.name;
}
function zoneName_(district, zone) {
  if (!zone) return '';   // zone is optional
  var z = rows_('Zones').filter(function (x) { return x.district === district && x.name === zone; })[0];
  if (!z) throw new Error('Select a valid zone for ' + district);
  return z.name;
}
function addReceipts_(req) {
  var district = districtName_(req.district);
  var list = req.receipts;
  if (!list || !list.length) throw new Error('No receipts to save');
  if (list.length > 500) throw new Error('Too many receipts in one go');
  var existing = rows_('Receipts').filter(function (r) { return r.district === district; }).map(function (r) { return String(r.receiptNo); });
  var seen = {};
  var clean = list.map(function (r) {
    var c = cleanReceipt_(r);
    c.zone = zoneName_(district, r.zone);
    if (seen[c.receiptNo]) throw new Error('Receipt ' + c.receiptNo + ' is entered twice');
    if (existing.indexOf(c.receiptNo) >= 0) throw new Error('Receipt ' + c.receiptNo + ' is already recorded for ' + district);
    seen[c.receiptNo] = true;
    return c;
  });
  var now = new Date().toISOString();
  var by = String(req.submittedBy || '').slice(0, 80);
  clean.forEach(function (c) {
    c.id = uid_(); c.district = district; c.submittedBy = by; c.createdAt = now; c.updatedAt = now;
    append_('Receipts', c);
  });
  return { saved: clean.length };
}
function updateReceipt_(r) {
  var all = rows_('Receipts');
  var old = all.filter(function (x) { return x.id === r.id; })[0];
  if (!old) throw new Error('Receipt not found');
  var district = districtName_(r.district);
  var zone = zoneName_(district, r.zone);
  var c = cleanReceipt_(r);
  if (all.some(function (x) { return x.id !== r.id && x.district === district && String(x.receiptNo) === c.receiptNo; }))
    throw new Error('Receipt ' + c.receiptNo + ' already exists for ' + district);
  c.district = district; c.zone = zone; c.updatedAt = new Date().toISOString();
  update_('Receipts', r.id, c);
  return true;
}

/* ---------- districts ---------- */
function addDistrict_(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('District name is required');
  if (rows_('Districts').some(function (d) { return d.name.toLowerCase() === name.toLowerCase(); })) throw new Error('District already exists');
  var d = { id: uid_(), name: name };
  append_('Districts', d);
  return d;
}
function renameDistrict_(id, name) {
  name = String(name || '').trim();
  var all = rows_('Districts');
  var d = all.filter(function (x) { return x.id === id; })[0];
  if (!d) throw new Error('District not found');
  if (!name) throw new Error('District name is required');
  if (all.some(function (x) { return x.id !== id && x.name.toLowerCase() === name.toLowerCase(); })) throw new Error('District already exists');
  update_('Districts', id, { name: name });
  rows_('Receipts').forEach(function (r) { if (r.district === d.name) update_('Receipts', r.id, { district: name }); });
  rows_('Zones').forEach(function (z) { if (z.district === d.name) update_('Zones', z.id, { district: name }); });
  return true;
}
function deleteDistrict_(id) {
  var d = rows_('Districts').filter(function (x) { return x.id === id; })[0];
  if (!d) throw new Error('District not found');
  if (rows_('Receipts').some(function (r) { return r.district === d.name; })) throw new Error('This district has receipts. Delete or move them first.');
  rows_('Zones').filter(function (z) { return z.district === d.name; }).forEach(function (z) { remove_('Zones', z.id); });
  remove_('Districts', id);
  return true;
}

/* ---------- zones ---------- */
function addZone_(district, name) {
  district = districtName_(district);
  name = String(name || '').trim();
  if (!name) throw new Error('Zone name is required');
  if (rows_('Zones').some(function (z) { return z.district === district && z.name.toLowerCase() === name.toLowerCase(); })) throw new Error('Zone already exists in ' + district);
  append_('Zones', { id: uid_(), district: district, name: name });
  return true;
}
function renameZone_(id, name) {
  name = String(name || '').trim();
  var all = rows_('Zones');
  var z = all.filter(function (x) { return x.id === id; })[0];
  if (!z) throw new Error('Zone not found');
  if (!name) throw new Error('Zone name is required');
  if (all.some(function (x) { return x.id !== id && x.district === z.district && x.name.toLowerCase() === name.toLowerCase(); })) throw new Error('Zone already exists in ' + z.district);
  update_('Zones', id, { name: name });
  rows_('Receipts').forEach(function (r) { if (r.district === z.district && r.zone === z.name) update_('Receipts', r.id, { zone: name }); });
  return true;
}
function deleteZone_(id) {
  var z = rows_('Zones').filter(function (x) { return x.id === id; })[0];
  if (!z) throw new Error('Zone not found');
  if (rows_('Receipts').some(function (r) { return r.district === z.district && r.zone === z.name; })) throw new Error('This zone has receipts. Delete or move them first.');
  remove_('Zones', id);
  return true;
}

/* ---------- expenses ---------- */
function cleanExpense_(x, needDistrict) {
  var district = String(x.district || '').trim();
  if (district) district = districtName_(district);
  else if (needDistrict) throw new Error('Select a district');
  var c = {
    date: String(x.date || '').slice(0, 10), district: district, category: String(x.category || '').trim(),
    item: String(x.item || '').trim().slice(0, 200), amount: num_(x.amount), note: String(x.note || '').slice(0, 300)
  };
  if (!c.date) c.date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) throw new Error('Date is not valid');
  if (!c.item) throw new Error('Expense item is required');
  if (CATEGORIES.indexOf(c.category) < 0) throw new Error('Select a category for "' + c.item + '"');
  if (!(c.amount > 0)) throw new Error('Amount for "' + c.item + '" must be more than 0');
  return c;
}
function addExpenses_(req) {
  var district = districtName_(req.district);
  var list = req.expenses;
  if (!list || !list.length) throw new Error('No expense items to save');
  if (list.length > 100) throw new Error('Too many items in one go');
  var clean = list.map(function (x) { x.district = district; x.date = ''; return cleanExpense_(x, true); });
  var now = new Date().toISOString(), by = String(req.submittedBy || '').slice(0, 80);
  clean.forEach(function (c) { c.id = uid_(); c.submittedBy = by; c.createdAt = now; append_('Expenses', c); });
  return { saved: clean.length };
}
function saveExpense_(x, isNew) {
  var c = cleanExpense_(x, false);
  if (isNew) { c.id = uid_(); c.createdAt = new Date().toISOString(); c.submittedBy = 'admin'; append_('Expenses', c); return c; }
  update_('Expenses', x.id, c);
  return true;
}

/* ---------- email the PDF ---------- */
function emailReport_(req) {
  var to = String(req.to || '').trim();
  if (!/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(to)) throw new Error('Enter a valid email address');
  var name = String(req.filename || 'PROFCON-2026-Report.pdf').replace(/[^\w.\- ]/g, '');
  var blob = Utilities.newBlob(Utilities.base64Decode(req.pdf), 'application/pdf', name);
  MailApp.sendEmail({ to: to, subject: 'PROFCON 2026 - Collection & Expense Report', body: 'Please find the PROFCON 2026 report attached.\n\nWisdom Students', attachments: [blob] });
  return true;
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */
function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Run setup() first');
  return sh;
}
function rows_(name) {
  var sh = sheet_(name), cols = TABS[name], n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var nums = NUM_COLS[name] || [], texts = TEXT_COLS[name] || [];
  return sh.getRange(2, 1, n, cols.length).getValues().filter(function (r) { return r[0] !== ''; }).map(function (r) {
    var o = {};
    cols.forEach(function (c, i) {
      var v = r[i];
      if (nums.indexOf(c) >= 0) v = Number(v) || 0;
      else if (texts.indexOf(c) >= 0 && v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      else if (v instanceof Date) v = v.toISOString();
      o[c] = v;
    });
    return o;
  });
}
function append_(name, obj) {
  var sh = sheet_(name);
  sh.appendRow(TABS[name].map(function (c) { return obj[c] == null ? '' : obj[c]; }));
}
function findRow_(name, id) {
  var sh = sheet_(name), n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}
function update_(name, id, patch) {
  var row = findRow_(name, id);
  if (!row) throw new Error('Record not found');
  var sh = sheet_(name), cols = TABS[name];
  Object.keys(patch).forEach(function (k) {
    var i = cols.indexOf(k);
    if (i > 0) sh.getRange(row, i + 1).setValue(patch[k]);
  });
}
function remove_(name, id) {
  var row = findRow_(name, id);
  if (!row) throw new Error('Record not found');
  sheet_(name).deleteRow(row);
}
function getSetting_(key) {
  var r = rows_('Settings').filter(function (x) { return x.key === key; })[0];
  return r ? r.value : '';
}
function setSetting_(key, value) {
  var sh = sheet_('Settings'), n = sh.getLastRow() - 1;
  if (n > 0) {
    var keys = sh.getRange(2, 1, n, 1).getValues();
    for (var i = 0; i < keys.length; i++) if (keys[i][0] === key) { sh.getRange(i + 2, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function num_(v) { var n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
