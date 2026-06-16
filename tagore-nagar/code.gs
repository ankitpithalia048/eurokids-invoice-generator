/**
 * Tagore Nagar Receipt backend for Google Apps Script.
 *
 * Save this file in a container-bound Apps Script project attached to a Google Sheet.
 * Deploy as a Web App with access set to Anyone.
 */

var RECEIPT_SHEET_NAME = 'Receipts';
var RECEIPT_COLS = [
  'receiptId', 'receiptType', 'receiptNumber', 'date',
  'name', 'firmName', 'firmRegId', 'studentClass', 'parentName', 'candidateAge', 'program', 'academicYear',
  'contact',
  'gstEnabled', 'gstNumber', 'gstName', 'fees_json',
  'payments_json', 'paymentReceipt',
  'transport_json', 'daycare_json',
  'discount', 'discountReason', 'paid', 'balance',
  'footer', 'customInvNo', 'savedAt', 'updatedAt'
];

function doGet(e) {
  return handleRequest(e.parameter || {});
}

function doPost(e) {
  var params = {};
  try {
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    params = {};
  }
  Object.keys(e.parameter || {}).forEach(function(key) {
    if (!params[key]) params[key] = e.parameter[key];
  });
  return handleRequest(params);
}

function handleRequest(params) {
  var action = params.action || 'list';
  try {
    var result;
    switch (action) {
      case 'list': result = listReceipts(params || {}); break;
      case 'save': result = saveReceipt(params.invoice || params.receipt || params); break;
      case 'delete': result = deleteReceipt(params.receiptId || params.receiptNumber || params.invNumber || params.invNo); break;
      case 'nextNumber': result = { nextInvoiceNumber: getNextReceiptNumber() }; break;
      default: result = { error: 'Unknown action: ' + action };
    }
    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('This app must be attached to a Google Sheet.');
  }
  return ss;
}

function ensureReceiptSheetHeaders(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var missing = RECEIPT_COLS.filter(function(col) { return headers.indexOf(col) < 0; });
  if (missing.length > 0) {
    var newHeaders = headers.slice();
    missing.forEach(function(col) { newHeaders.push(col); });
    sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  }
}

function getOrCreateReceiptSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(RECEIPT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(RECEIPT_SHEET_NAME);
    sheet.appendRow(RECEIPT_COLS);
    sheet.getRange(1, 1, 1, RECEIPT_COLS.length)
      .setFontWeight('bold')
      .setBackground('#1e3a8a')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  } else {
    ensureReceiptSheetHeaders(sheet);
  }
  return sheet;
}

function getHeaderPositions(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var positions = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) positions[headers[i]] = i + 1;
  }
  return { positions: positions, count: headers.length };
}

function readSheetAsObjects(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  return rows;
}

function safeNumber(value) {
  var n = Number(value);
  return isFinite(n) ? n : 0;
}

function isLikelyPhone(val) {
  if (val == null) return false;
  var s = String(val).replace(/[^0-9]/g, '');
  return s.length >= 7 && s.length <= 15;
}

function extractAgeFromRow(row) {
  // Look for a plausible age (1-99) in several columns that may have been mis-shifted
  var candidates = ['candidateAge', 'studentClass', 'firmRegId', 'gstNumber', 'paymentReceipt', 'savedAt', 'updatedAt', 'name'];
  for (var i = 0; i < candidates.length; i++) {
    var k = candidates[i];
    var v = row[k];
    if (v == null) continue;
    var txt = String(v);
    // Search for standalone numbers between 1 and 99
    var m = txt.match(/\b(\d{1,2})\b/);
    if (m) {
      var n = Number(m[1]);
      if (n >= 1 && n <= 99) return String(n);
    }
  }
  return '';
}

function listReceipts(params) {
  params = params || {};
  var filterAY = params.ay || params.academicYear || null;
  var sheet = getOrCreateReceiptSheet();
  var receipts = readSheetAsObjects(sheet).map(function(row) {
    var fees = [];
    try { 
      var parsed = JSON.parse(row.fees_json || '[]');
      fees = Array.isArray(parsed) ? parsed : [];
    } catch (e) { fees = []; }
    var payments = [];
    try { 
      var parsed = JSON.parse(row.payments_json || '[]');
      payments = Array.isArray(parsed) ? parsed : [];
    } catch (e) { payments = []; }
    if (payments.length === 0 && row.paymentReceipt) {
      try {
        var parsed = JSON.parse(row.paymentReceipt || '[]');
        payments = Array.isArray(parsed) ? parsed : payments;
      } catch (e) {
        // ignore
      }
    }
    var transport = {};
    try { 
      var parsed = JSON.parse(row.transport_json || '{}');
      transport = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) { transport = {}; }
    if ((!transport || Object.keys(transport).length === 0) && typeof row.savedAt === 'string') {
      try {
        var parsed = JSON.parse(row.savedAt || '{}');
        transport = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : transport;
      } catch (e) {
        // ignore
      }
    }
    var daycare = {};
    try { 
      var parsed = JSON.parse(row.daycare_json || '{}');
      daycare = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) { daycare = {}; }
    if ((!daycare || Object.keys(daycare).length === 0) && typeof row.updatedAt === 'string') {
      try {
        var parsed = JSON.parse(row.updatedAt || '{}');
        daycare = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : daycare;
      } catch (e) {
        // ignore
      }
    }
    var subtotal = fees.reduce(function(s, it){ return s + Number(it.amount || 0); }, 0);
    var discount = safeNumber(row.discount);
    var total = Math.max(0, subtotal - discount);
    var program = row.program;
    if (typeof program !== 'string') {
      program = String(row.receiptType || '').toLowerCase() === 'training' ? 'training' : 'student';
    }
    var academicYear = String(row.academicYear || '').trim();
    if (!/^[0-9]{4}-[0-9]{4}$/.test(academicYear) && typeof row.gstNumber === 'string') {
      var candidateYear = row.gstNumber.trim();
      if (/^[0-9]{4}-[0-9]{4}$/.test(candidateYear)) {
        academicYear = candidateYear;
      }
    }
    // Normalize candidate age and contact with fallbacks to recover from malformed rows
    var candidateAgeVal = (row.candidateAge || '').toString().trim();
    if (!candidateAgeVal) candidateAgeVal = extractAgeFromRow(row);
    var contactVal = '';
    var contactCandidates = ['contact', 'firmRegId', 'gstNumber', 'paymentReceipt', 'savedAt', 'updatedAt', 'parentName'];
    for (var ci = 0; ci < contactCandidates.length; ci++) {
      var key = contactCandidates[ci];
      var v = row[key];
      if (v == null) continue;
      if (isLikelyPhone(v)) { contactVal = String(v).replace(/[^0-9]/g, ''); break; }
    }

    return {
      receiptId: row.receiptId,
      receiptType: row.receiptType,
      receiptNumber: row.receiptNumber,
      invNumber: row.receiptNumber,
      date: row.date,
      name: row.name,
      student: row.name,
      firmName: row.firmName,
      firmRegId: row.firmRegId,
      candidateAge: candidateAgeVal || '',
      contact: contactVal || '',
      parent: row.parentName,
      studentClass: row.studentClass,
      parentName: row.parentName,
      program: program,
      academicYear: academicYear,
      gstEnabled: row.gstEnabled === true || row.gstEnabled === 'TRUE',
      gstNumber: row.gstNumber,
      gstName: row.gstName || '',
      fees: fees,
      payments: payments,
      transport: transport,
      daycare: daycare,
      subtotal: subtotal,
      discount: discount,
      total: total,
      paid: safeNumber(row.paid),
      balance: safeNumber(row.balance),
      paymentReceipt: row.paymentReceipt,
      footer: row.footer,
      customInvNo: row.customInvNo === true || String(row.customInvNo).toLowerCase() === 'true',
      savedAt: row.savedAt,
      updatedAt: row.updatedAt
    };
  });
  // Optionally filter by academic year
  if (filterAY) {
    // Keep rows that either match the requested academic year or have no academicYear set
    receipts = receipts.filter(function(r){
      var ay = String(r.academicYear || '').trim();
      return ay === '' || ay === String(filterAY);
    });
  }
  return { invoices: receipts, count: receipts.length };
}

function saveReceipt(receipt) {
  receipt = receipt || {};
  if (receipt.invoice) receipt = receipt.invoice;
  if (receipt.receipt) receipt = receipt.receipt;
  receipt.name = receipt.name || receipt.student || receipt.firmName || '';
  receipt.parentName = receipt.parentName || receipt.parent || '';
  receipt.firmName = receipt.firmName || receipt.firm || '';
  receipt.firmRegId = receipt.firmRegId || receipt.registrationId || receipt.regId || receipt.registrationNo || '';
  receipt.receiptType = receipt.receiptType || (receipt.program === 'training' ? 'training' : 'student');
  if (!receipt.receiptType) throw new Error('Receipt type is required.');
  if (!receipt.name) throw new Error('Name is required.');
  if (!receipt.program) throw new Error('Program is required.');
  if (!Array.isArray(receipt.fees) || !receipt.fees.length) throw new Error('At least one fee component is required.');
  // The current invoice app does not require student class or teacher receipt fields.
  receipt.receiptType = receipt.receiptType || (receipt.program === 'training' ? 'training' : 'student');

  var now = new Date();
  var sheet = getOrCreateReceiptSheet();
  // Normalize common aliases
  receipt.receiptNumber = receipt.receiptNumber || receipt.invNumber || receipt.invNo || receipt.inv || receipt.number || '';
  receipt.academicYear = receipt.academicYear || receipt.ay || '';
  var rowIndex = findReceiptRow(sheet, receipt.receiptId, receipt.receiptNumber);
  var receiptId = receipt.receiptId || Utilities.getUuid();
  
  // Validate and normalize arrays/objects
  var fees = Array.isArray(receipt.fees) ? receipt.fees : [];
  var payments = Array.isArray(receipt.payments) ? receipt.payments : [];
  var transport = (receipt.transport && typeof receipt.transport === 'object' && !Array.isArray(receipt.transport)) ? receipt.transport : {};
  var daycare = (receipt.daycare && typeof receipt.daycare === 'object' && !Array.isArray(receipt.daycare)) ? receipt.daycare : {};
  
  var feeJson = JSON.stringify(fees);
  var paymentsJson = JSON.stringify(payments);
  var transportJson = JSON.stringify(transport);
  var daycareJson = JSON.stringify(daycare);
  var subtotal = fees.reduce(function(sum, item) {
    return sum + Number(item.amount || 0);
  }, 0);
  var discount = Number(receipt.discount || 0);
  var total = Math.max(0, subtotal - discount);
  var paid = Number(receipt.paid || (payments.length > 0 ? payments.reduce(function(sum, item) { return sum + Number(item.amount || 0); }, 0) : 0));
  var balance = Math.max(0, total - paid);

  function safeNum(v){ var n = Number(v); return (isFinite(n) ? n : 0); }
  ensureReceiptSheetHeaders(sheet);
  var headerInfo = getHeaderPositions(sheet);
  var rowValues = new Array(headerInfo.count);
  for (var i = 0; i < rowValues.length; i++) {
    rowValues[i] = '';
  }
  RECEIPT_COLS.forEach(function(col) {
    var idx = headerInfo.positions[col];
    if (!idx) return;
    switch (col) {
      case 'receiptId': rowValues[idx - 1] = receiptId; break;
      case 'receiptType': rowValues[idx - 1] = receipt.receiptType; break;
      case 'receiptNumber': rowValues[idx - 1] = receipt.receiptNumber || ''; break;
      case 'date': rowValues[idx - 1] = receipt.date || Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'); break;
      case 'name': rowValues[idx - 1] = receipt.name; break;
      case 'contact': rowValues[idx - 1] = receipt.contact || ''; break;
      case 'firmName': rowValues[idx - 1] = receipt.firmName || ''; break;
      case 'firmRegId': rowValues[idx - 1] = receipt.firmRegId || ''; break;
      case 'studentClass': rowValues[idx - 1] = receipt.studentClass || ''; break;
      case 'parentName': rowValues[idx - 1] = receipt.parentName || ''; break;
      case 'candidateAge': rowValues[idx - 1] = receipt.candidateAge || ''; break;
      case 'program': rowValues[idx - 1] = receipt.program; break;
      case 'academicYear': rowValues[idx - 1] = receipt.academicYear || ''; break;
      case 'gstEnabled': rowValues[idx - 1] = receipt.gstEnabled ? 'TRUE' : 'FALSE'; break;
      case 'gstNumber': rowValues[idx - 1] = receipt.gstNumber || ''; break;
      case 'gstName': rowValues[idx - 1] = receipt.gstName || ''; break;
      case 'fees_json': rowValues[idx - 1] = feeJson; break;
      case 'payments_json': rowValues[idx - 1] = paymentsJson; break;
      case 'paymentReceipt': rowValues[idx - 1] = receipt.paymentReceipt || ''; break;
      case 'transport_json': rowValues[idx - 1] = transportJson; break;
      case 'daycare_json': rowValues[idx - 1] = daycareJson; break;
      case 'discount': rowValues[idx - 1] = discount; break;
      case 'discountReason': rowValues[idx - 1] = receipt.discountReason || ''; break;
      case 'paid': rowValues[idx - 1] = safeNum(paid); break;
      case 'balance': rowValues[idx - 1] = safeNum(balance); break;
      case 'footer': rowValues[idx - 1] = receipt.footer || ''; break;
      case 'customInvNo': rowValues[idx - 1] = receipt.customInvNo ? 'TRUE' : 'FALSE'; break;
      case 'savedAt': rowValues[idx - 1] = receipt.savedAt || Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); break;
      case 'updatedAt': rowValues[idx - 1] = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); break;
      default: rowValues[idx - 1] = ''; break;
    }
  });

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return { receiptId: receiptId, receiptNumber: receipt.receiptNumber || '', action: rowIndex > 0 ? 'updated' : 'created' };
}

function deleteReceipt(receiptIdOrNumber) {
  if (!receiptIdOrNumber) throw new Error('receiptId or receiptNumber is required for delete.');
  var sheet = getOrCreateReceiptSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { deleted: 0 };
  var headers = data[0];
  var idCol = headers.indexOf('receiptId');
  var numberCol = headers.indexOf('receiptNumber');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(receiptIdOrNumber) || String(data[i][numberCol]) === String(receiptIdOrNumber)) {
      sheet.deleteRow(i + 1);
      return { deleted: 1 };
    }
  }
  return { deleted: 0 };
}

function findReceiptRow(sheet, receiptId, receiptNumber) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  var headers = data[0];
  var idCol = headers.indexOf('receiptId');
  var numberCol = headers.indexOf('receiptNumber');
  for (var i = 1; i < data.length; i++) {
    if (receiptId && String(data[i][idCol]) === String(receiptId)) return i + 1;
    if (!receiptId && receiptNumber && String(data[i][numberCol]) === String(receiptNumber)) return i + 1;
  }
  return 0;
}

function getNextReceiptNumber() {
  var sheet = getOrCreateReceiptSheet();
  var year = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
  var prefix = 'TG/' + year + '/';
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return prefix + '0001';
  }
  var headers = data[0];
  var numCol = headers.indexOf('receiptNumber');
  var maxSeq = 0;
  for (var i = 1; i < data.length; i++) {
    var value = String(data[i][numCol] || '');
    var match = value.match(/^TG\/\d{4}\/(\d+)$/);
    if (match) {
      maxSeq = Math.max(maxSeq, Number(match[1]));
    }
  }
  return prefix + String(maxSeq + 1).padStart(4, '0');
}
