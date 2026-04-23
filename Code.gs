/**
 * Eurokids VIP Colony — Invoice Generator Backend
 * Google Apps Script bound to a Google Sheet.
 *
 * Sheet structure (auto-created on first run):
 *   "Invoices_<AY>"   — one row per invoice for that academic year
 *                       (e.g. Invoices_2026-2027, Invoices_2027-2028)
 *   "Payments_<AY>"   — all payment instalments for that academic year
 *
 * Endpoints (same URL, differentiated by action):
 *   GET  ?action=list&ay=2026-2027   → all invoices + payments for that AY
 *   GET  ?action=listAY              → list of academic years that have sheets
 *   POST { action: "save", invoice: {...} }  → insert or overwrite invoice
 *   POST { action: "delete", invNumber: "...", ay: "..." } → remove an invoice
 *   POST { action: "nextNumber", ay: "..." } → returns next auto invoice number
 */

/* ============ CONFIG ============ */
const SHEET_PREFIX_INVOICE = 'Invoices_';
const SHEET_PREFIX_PAYMENT = 'Payments_';

const INVOICE_COLS = [
  'invNumber', 'customInvNo', 'date', 'academicYear',
  'student', 'parent', 'contact', 'program',
  'gstEnabled', 'gstNumber', 'gstName',
  'fees_json',
  'transport_enabled', 'transport_desc', 'transport_amount', 'transport_period',
  'daycare_enabled', 'daycare_amount', 'daycare_period',
  'discount', 'discountReason',
  'total', 'paid', 'balance',
  'savedAt', 'updatedAt'
];

const PAYMENT_COLS = [
  'invNumber', 'paymentIdx', 'date', 'amount', 'mode', 'ref', 'updatedAt'
];

/* ============ HTTP ENTRY POINTS ============ */

function doGet(e) {
  return handleRequest(e, e.parameter);
}

function doPost(e) {
  let params = {};
  try {
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    params = {};
  }
  // Fallback to query params if present
  Object.keys(e.parameter || {}).forEach(k => {
    if (!params[k]) params[k] = e.parameter[k];
  });
  return handleRequest(e, params);
}

function handleRequest(e, params) {
  const action = params.action || 'list';
  try {
    let result;
    switch (action) {
      case 'list':       result = listInvoices(params.ay); break;
      case 'listAY':     result = listAcademicYears(); break;
      case 'save':       result = saveInvoice(params.invoice || params); break;
      case 'delete':     result = deleteInvoice(params.invNumber, params.ay); break;
      case 'nextNumber': result = getNextInvoiceNumber(params.ay); break;
      default:           result = { error: 'Unknown action: ' + action };
    }
    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ SHEET HELPERS ============ */

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sanitizeAY(ay) {
  if (!ay) throw new Error('Academic year is required');
  // Only allow digits and hyphen (e.g. 2026-2027)
  const clean = String(ay).replace(/[^0-9\-]/g, '');
  if (!/^\d{4}-\d{4}$/.test(clean)) throw new Error('Academic year must look like 2026-2027');
  return clean;
}

function getOrCreateInvoiceSheet(ay) {
  const ss = getSpreadsheet();
  const name = SHEET_PREFIX_INVOICE + sanitizeAY(ay);
  let sheet = ss.getSheetByName(name);
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
  const ss = getSpreadsheet();
  const name = SHEET_PREFIX_PAYMENT + sanitizeAY(ay);
  let sheet = ss.getSheetByName(name);
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

function readSheetAsObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = data[i][idx]);
    rows.push(obj);
  }
  return rows;
}

/* ============ BUSINESS LOGIC ============ */

function listAcademicYears() {
  const ss = getSpreadsheet();
  const years = ss.getSheets()
    .map(s => s.getName())
    .filter(n => n.indexOf(SHEET_PREFIX_INVOICE) === 0)
    .map(n => n.substring(SHEET_PREFIX_INVOICE.length))
    .sort()
    .reverse();
  return { academicYears: years };
}

function listInvoices(ay) {
  ay = sanitizeAY(ay);
  const invSheet = getOrCreateInvoiceSheet(ay);
  const paySheet = getOrCreatePaymentSheet(ay);

  const invoices = readSheetAsObjects(invSheet).map(row => {
    let fees = [];
    try { fees = JSON.parse(row.fees_json || '[]'); } catch (e) { fees = []; }
    return {
      invNumber: row.invNumber,
      customInvNo: row.customInvNo === true || row.customInvNo === 'TRUE',
      date: formatDate(row.date),
      academicYear: row.academicYear,
      student: row.student,
      parent: row.parent,
      contact: row.contact,
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

  // Attach payments
  const payments = readSheetAsObjects(paySheet);
  const byInv = {};
  invoices.forEach(inv => { byInv[inv.invNumber] = inv; });
  payments.forEach(p => {
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
  if (!inv || !inv.invNumber) throw new Error('Invoice number is required');
  if (!inv.academicYear) throw new Error('Academic year is required');

  const ay = sanitizeAY(inv.academicYear);
  const invSheet = getOrCreateInvoiceSheet(ay);
  const paySheet = getOrCreatePaymentSheet(ay);

  const now = new Date();
  const existingRow = findInvoiceRow(invSheet, inv.invNumber);

  const rowValues = INVOICE_COLS.map(col => {
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

  // Replace all payments for this invoice (simple + reliable)
  removePaymentsForInvoice(paySheet, inv.invNumber);
  const payments = inv.payments || [];
  if (payments.length > 0) {
    const payRows = payments.map((p, idx) => PAYMENT_COLS.map(col => {
      switch (col) {
        case 'invNumber':  return inv.invNumber;
        case 'paymentIdx': return idx + 1;
        case 'amount':     return parseFloat(p.amount) || 0;
        case 'updatedAt':  return now.toISOString();
        default:           return p[col] != null ? p[col] : '';
      }
    }));
    paySheet.getRange(paySheet.getLastRow() + 1, 1, payRows.length, PAYMENT_COLS.length)
      .setValues(payRows);
  }

  return { invNumber: inv.invNumber, academicYear: ay, action: existingRow > 0 ? 'updated' : 'created' };
}

function deleteInvoice(invNumber, ay) {
  if (!invNumber) throw new Error('Invoice number is required');
  ay = sanitizeAY(ay);
  const invSheet = getOrCreateInvoiceSheet(ay);
  const paySheet = getOrCreatePaymentSheet(ay);

  const row = findInvoiceRow(invSheet, invNumber);
  if (row > 0) invSheet.deleteRow(row);
  removePaymentsForInvoice(paySheet, invNumber);

  return { invNumber: invNumber, deleted: row > 0 };
}

function findInvoiceRow(sheet, invNumber) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  const col = data[0].indexOf('invNumber');
  if (col < 0) return 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col]) === String(invNumber)) return i + 1;
  }
  return 0;
}

function removePaymentsForInvoice(sheet, invNumber) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const col = data[0].indexOf('invNumber');
  if (col < 0) return;
  // Delete from bottom up so row indices stay valid
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col]) === String(invNumber)) sheet.deleteRow(i + 1);
  }
}

function getNextInvoiceNumber(ay) {
  ay = sanitizeAY(ay);
  const sheet = getOrCreateInvoiceSheet(ay);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    const year = new Date().getFullYear();
    return { nextInvoiceNumber: 'EK/VIP/' + year + '/0001' };
  }
  const invCol = data[0].indexOf('invNumber');
  const customCol = data[0].indexOf('customInvNo');
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const isCustom = data[i][customCol] === true || data[i][customCol] === 'TRUE';
    if (isCustom) continue;
    const match = String(data[i][invCol]).match(/(\d+)$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
  }
  const year = new Date().getFullYear();
  const nextNum = maxNum + 1;
  const padded = ('000' + nextNum).slice(-4);
  return { nextInvoiceNumber: 'EK/VIP/' + year + '/' + padded };
}

/* ============ UTILS ============ */

function formatDate(d) {
  if (!d) return '';
  if (d instanceof Date) {
    const yyyy = d.getFullYear();
    const mm = ('0' + (d.getMonth() + 1)).slice(-2);
    const dd = ('0' + d.getDate()).slice(-2);
    return yyyy + '-' + mm + '-' + dd;
  }
  return String(d);
}
