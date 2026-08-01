/**
 * Eurokids Tagore Nagar invoice backend.
 */
var SHEET_PREFIX_INVOICE = 'Invoices_';
var SHEET_PREFIX_PAYMENT = 'Payments_';

var INVOICE_COLS = [
  'invNumber', 'customInvNo', 'date', 'academicYear',
  'student', 'parent', 'contact', 'email', 'program',
  'gstEnabled', 'gstNumber', 'gstName',
  'fees_json',
  'transport_enabled', 'transport_desc', 'transport_amount', 'transport_period',
  'daycare_enabled', 'daycare_amount', 'daycare_period',
  'discount', 'discountReason',
  'total', 'paid', 'balance',
  'savedAt', 'updatedAt'
];

var PAYMENT_COLS = [
  'invNumber', 'paymentIdx', 'date', 'amount', 'mode', 'ref', 'updatedAt'
];

function doGet(e) {
  Logger.log('doGet params: ' + JSON.stringify(e && e.parameter));
  return handleRequest(e, e.parameter);
}

function doPost(e) {
  var params = {};
  try {
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    Logger.log('doPost JSON parse failed: ' + (err && err.stack || err));
    params = {};
  }
  Object.keys(e.parameter || {}).forEach(function(k) {
    if (!params[k]) params[k] = e.parameter[k];
  });
  Logger.log('doPost action=' + params.action + ' keys=' + JSON.stringify(Object.keys(params)));
  return handleRequest(e, params);
}

function handleRequest(e, params) {
  var action = params.action || 'list';
  try {
    var result;
    switch (action) {
      case 'list':       result = listInvoices(params.ay); break;
      case 'listAY':     result = listAcademicYears(); break;
      case 'save':       result = saveInvoice(params.invoice || params); break;
      case 'delete':     result = deleteInvoice(params.invNumber, params.ay); break;
      case 'nextNumber': result = getNextInvoiceNumber(params.ay); break;
      default:           result = { error: 'Unknown action: ' + action };
    }
    Logger.log('OK action=' + action);
    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    var detail = String(err && err.message || err);
    var stack = err && err.stack ? String(err.stack) : '';
    Logger.log('ERROR action=' + action + ' : ' + detail + (stack ? '\n' + stack : ''));
    // Include the stack (truncated) in the response so it shows up directly
    // in the app's alert() popup - no need to open Apps Script > Executions.
    return jsonResponse({ ok: false, error: detail + (stack ? ' | ' + stack.split('\n').slice(0, 3).join(' » ') : '') });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function readSheetAsObjects(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    rows.push(obj);
  }
  return rows;
}

function sanitizeAY(ay) {
  if (!ay) throw new Error('Academic year is required');
  var clean = String(ay).replace(/[^0-9\-]/g, '');
  if (!/^\d{4}-\d{4}$/.test(clean)) throw new Error('Academic year must look like 2026-2027');
  return clean;
}

function getOrCreateInvoiceSheet(ay) {
  var ss = getSpreadsheet();
  var name = SHEET_PREFIX_INVOICE + sanitizeAY(ay);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(INVOICE_COLS);
    sheet.getRange(1, 1, 1, INVOICE_COLS.length)
      .setFontWeight('bold')
      .setBackground('#0369a1')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreatePaymentSheet(ay) {
  var ss = getSpreadsheet();
  var name = SHEET_PREFIX_PAYMENT + sanitizeAY(ay);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(PAYMENT_COLS);
    sheet.getRange(1, 1, 1, PAYMENT_COLS.length)
      .setFontWeight('bold')
      .setBackground('#ea580c')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function listAcademicYears() {
  var ss = getSpreadsheet();
  var years = ss.getSheets()
    .map(function(sheet) { return sheet.getName(); })
    .filter(function(name) { return name.indexOf(SHEET_PREFIX_INVOICE) === 0; })
    .map(function(name) { return name.substring(SHEET_PREFIX_INVOICE.length); })
    .sort()
    .reverse();
  return { academicYears: years };
}

function listInvoices(ay) {
  ay = sanitizeAY(ay);
  Logger.log('listInvoices ay=' + ay);
  var invSheet = getOrCreateInvoiceSheet(ay);
  var paySheet = getOrCreatePaymentSheet(ay);

  var invoices = readSheetAsObjects(invSheet).map(function(row) {
    var fees = [];
    try { fees = JSON.parse(row.fees_json || '[]'); } catch (e) { fees = []; }
    return {
      invNumber: row.invNumber,
      customInvNo: row.customInvNo === true || row.customInvNo === 'TRUE',
      date: formatDate(row.date),
      academicYear: row.academicYear,
      student: row.student,
      parent: row.parent,
      contact: row.contact,
      email: row.email,
      program: row.program,
      gstEnabled: row.gstEnabled === true || row.gstEnabled === 'TRUE',
      gstNumber: row.gstNumber,
      gstName: row.gstName,
      fees: fees,
      transport: {
        enabled: row.transport_enabled === true || row.transport_enabled === 'TRUE',
        desc: row.transport_desc,
        amount: row.transport_amount,
        period: row.transport_period
      },
      daycare: {
        enabled: row.daycare_enabled === true || row.daycare_enabled === 'TRUE',
        amount: row.daycare_amount,
        period: row.daycare_period
      },
      discount: row.discount,
      discountReason: row.discountReason,
      total: row.total,
      paid: row.paid,
      balance: row.balance,
      savedAt: row.savedAt,
      updatedAt: row.updatedAt,
      payments: []
    };
  });

  var payments = readSheetAsObjects(paySheet);
  var byInv = {};
  invoices.forEach(function(inv) { byInv[inv.invNumber] = inv; });
  payments.forEach(function(p) {
    if (byInv[p.invNumber]) {
      byInv[p.invNumber].payments.push({
        date: formatDate(p.date),
        amount: p.amount,
        mode: p.mode,
        ref: p.ref
      });
    }
  });

  return { invoices: invoices, count: invoices.length };
}

function saveInvoice(inv) {
  Logger.log('saveInvoice called for invNumber=' + (inv && inv.invNumber) + ' ay=' + (inv && inv.academicYear));
  if (!inv || !inv.invNumber) throw new Error('Invoice number is required');
  if (!inv.academicYear) throw new Error('Academic year is required');

  var ay = sanitizeAY(inv.academicYear);
  var invSheet = getOrCreateInvoiceSheet(ay);
  var paySheet = getOrCreatePaymentSheet(ay);
  var now = new Date();
  var existingRow = findInvoiceRow(invSheet, inv.invNumber);
  Logger.log('saveInvoice existingRow=' + existingRow + ' sheet=' + invSheet.getName());

  var rowValues = INVOICE_COLS.map(function(col) {
    switch (col) {
      case 'fees_json': return JSON.stringify(inv.fees || []);
      case 'transport_enabled': return !!(inv.transport && inv.transport.enabled);
      case 'transport_desc':    return inv.transport ? (inv.transport.desc || '') : '';
      case 'transport_amount':  return inv.transport ? (parseFloat(inv.transport.amount) || 0) : 0;
      case 'transport_period':  return inv.transport ? (inv.transport.period || '') : '';
      case 'daycare_enabled':   return !!(inv.daycare && inv.daycare.enabled);
      case 'daycare_amount':    return inv.daycare ? (parseFloat(inv.daycare.amount) || 0) : 0;
      case 'daycare_period':    return inv.daycare ? (inv.daycare.period || '') : '';
      case 'gstEnabled':        return !!inv.gstEnabled;
      case 'customInvNo':       return !!inv.customInvNo;
      case 'discount':          return parseFloat(inv.discount) || 0;
      case 'savedAt':           return inv.savedAt || now.toISOString();
      case 'updatedAt':         return now.toISOString();
      default:                  return inv[col] != null ? inv[col] : '';
    }
  });

  if (existingRow > 0) {
    invSheet.getRange(existingRow, 1, 1, INVOICE_COLS.length).setValues([rowValues]);
  } else {
    invSheet.appendRow(rowValues);
  }

  removePaymentsForInvoice(paySheet, inv.invNumber);
  var payments = inv.payments || [];
  if (payments.length > 0) {
    var payRows = payments.map(function(p, idx) {
      return PAYMENT_COLS.map(function(col) {
        switch (col) {
          case 'invNumber':  return inv.invNumber;
          case 'paymentIdx': return idx + 1;
          case 'amount':     return parseFloat(p.amount) || 0;
          case 'updatedAt':  return now.toISOString();
          default:           return p[col] != null ? p[col] : '';
        }
      });
    });
    paySheet.getRange(paySheet.getLastRow() + 1, 1, payRows.length, PAYMENT_COLS.length)
      .setValues(payRows);
  }

  return { invNumber: inv.invNumber, academicYear: ay, action: existingRow > 0 ? 'updated' : 'created' };
}

function deleteInvoice(invNumber, ay) {
  if (!invNumber) throw new Error('Invoice number is required');
  ay = sanitizeAY(ay);
  var invSheet = getOrCreateInvoiceSheet(ay);
  var paySheet = getOrCreatePaymentSheet(ay);
  var row = findInvoiceRow(invSheet, invNumber);
  if (row > 0) invSheet.deleteRow(row);
  removePaymentsForInvoice(paySheet, invNumber);
  return { invNumber: invNumber, deleted: row > 0 };
}

function findInvoiceRow(sheet, invNumber) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  var col = data[0].indexOf('invNumber');
  if (col < 0) return 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][col]) === String(invNumber)) return i + 1;
  }
  return 0;
}

function removePaymentsForInvoice(sheet, invNumber) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  var col = data[0].indexOf('invNumber');
  if (col < 0) return;
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col]) === String(invNumber)) sheet.deleteRow(i + 1);
  }
}

function getNextInvoiceNumber(ay) {
  ay = sanitizeAY(ay);
  var sheet = getOrCreateInvoiceSheet(ay);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    var year = new Date().getFullYear();
    return { nextInvoiceNumber: 'EK/TGN/' + year + '/0001' };
  }
  var invCol = data[0].indexOf('invNumber');
  var customCol = data[0].indexOf('customInvNo');
  var maxNum = 0;
  for (var i = 1; i < data.length; i++) {
    var isCustom = data[i][customCol] === true || data[i][customCol] === 'TRUE';
    if (isCustom) continue;
    var match = String(data[i][invCol]).match(/(\d+)$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  var year = new Date().getFullYear();
  var nextNum = maxNum + 1;
  var padded = ('000' + nextNum).slice(-4);
  return { nextInvoiceNumber: 'EK/TGN/' + year + '/' + padded };
}

function formatDate(d) {
  if (!d) return '';
  if (d instanceof Date) {
    var yyyy = d.getFullYear();
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return yyyy + '-' + mm + '-' + dd;
  }
  return String(d);
}
