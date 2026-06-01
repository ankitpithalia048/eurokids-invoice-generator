/**
 * Eurokids VIP Colony caretaker onboarding backend.
 */
var CARETAKER_SHEET_NAME = 'Caretakers';
var CARETAKER_COLS = [
  'candidateId', 'name', 'mobile', 'alternateMobile', 'email', 'dob', 'gender', 'maritalStatus', 'caste',
  'address', 'pin', 'education', 'experienceYears', 'emergencyContact', 'notes',
  'aadharUrl', 'certificateUrl', 'consentUrl', 'driveFolderUrl', 'savedAt', 'updatedAt'
];

function doGet(e) {
  return handleRequest(e, e.parameter);
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
  Object.keys(e.parameter || {}).forEach(function(k) {
    if (!params[k]) params[k] = e.parameter[k];
  });
  return handleRequest(e, params);
}

function handleRequest(e, params) {
  var action = params.action || 'listCaretakers';
  try {
    var result;
    switch (action) {
      case 'listCaretakers': result = listCaretakers(params.query); break;
      case 'saveCaretaker': result = saveCaretaker(params.caretaker || params); break;
        case 'ping': result = ping(params); break;
      case 'uploadFile': result = uploadFile(params); break;
      default: result = { error: 'Unknown action: ' + action };
    }
    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Active spreadsheet not available. This app must be deployed as a container-bound script attached to the caretaker sheet.');
  }
  return ss;
}

function ping(params) {
  var info = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    info.canActive = !!ss;
    if (ss) {
      info.activeSpreadsheetId = ss.getId();
      info.activeSpreadsheetName = ss.getName();
    }
  } catch (e) {
    info.canActive = false;
    info.activeError = String(e && e.message || e);
  }
  info.serverTime = (new Date()).toISOString();
  return info;
}

function extractSpreadsheetId(url) {
  var match = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  match = String(url).match(/[-_A-Za-z0-9]{25,}/);
  if (match) return match[0];
  throw new Error('Invalid caretaker sheet URL');
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

function getOrCreateCaretakerSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(CARETAKER_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CARETAKER_SHEET_NAME);
    sheet.appendRow(CARETAKER_COLS);
    sheet.getRange(1, 1, 1, CARETAKER_COLS.length)
      .setFontWeight('bold')
      .setBackground('#0f172a')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function listCaretakers(query) {
  var sheet = getOrCreateCaretakerSheet();
  var caretakers = readSheetAsObjects(sheet).map(function(row) {
    return {
      candidateId: row.candidateId,
      name: row.name,
      mobile: row.mobile,
      alternateMobile: row.alternateMobile,
      email: row.email,
      dob: row.dob,
      gender: row.gender,
      maritalStatus: row.maritalStatus,
      caste: row.caste,
      address: row.address,
      pin: row.pin,
      education: row.education,
      experienceYears: row.experienceYears,
      emergencyContact: row.emergencyContact,
      notes: row.notes,
      aadharUrl: row.aadharUrl,
      certificateUrl: row.certificateUrl,
      consentUrl: row.consentUrl,
      driveFolderUrl: row.driveFolderUrl,
      savedAt: row.savedAt,
      updatedAt: row.updatedAt
    };
  });

  if (query) {
    var q = String(query).toLowerCase();
    var filtered = caretakers.filter(function(c) {
      return String(c.name || '').toLowerCase().indexOf(q) >= 0 ||
             String(c.mobile || '').toLowerCase().indexOf(q) >= 0 ||
             String(c.alternateMobile || '').toLowerCase().indexOf(q) >= 0 ||
             String(c.email || '').toLowerCase().indexOf(q) >= 0 ||
             String(c.caste || '').toLowerCase().indexOf(q) >= 0;
    });
    return { candidates: filtered, count: filtered.length };
  }
  return { candidates: caretakers, count: caretakers.length };
}

function saveCaretaker(caretaker) {
  if (!caretaker || !caretaker.name) throw new Error('Candidate name is required');
  if (!caretaker.mobile) throw new Error('Mobile number is required');

  var sheet = getOrCreateCaretakerSheet();
  var now = new Date();
  var row = findCaretakerRow(sheet, caretaker.candidateId, caretaker.name, caretaker.mobile);
  var candidateId = caretaker.candidateId || 'CAND-' + Date.now();

  var rowValues = CARETAKER_COLS.map(function(col) {
    switch (col) {
      case 'candidateId': return candidateId;
      case 'aadharUrl': return caretaker.aadharUrl || '';
      case 'certificateUrl': return caretaker.certificateUrl || '';
      case 'consentUrl': return caretaker.consentUrl || '';
      case 'driveFolderUrl': return caretaker.driveFolderUrl || '';
      case 'savedAt': return caretaker.savedAt || now.toISOString();
      case 'updatedAt': return now.toISOString();
      default: return caretaker[col] != null ? caretaker[col] : '';
    }
  });

  if (row > 0) {
    sheet.getRange(row, 1, 1, CARETAKER_COLS.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return { candidateId: candidateId, action: row > 0 ? 'updated' : 'created' };
}

function findCaretakerRow(sheet, candidateId, name, mobile) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  var headers = data[0];
  var idCol = headers.indexOf('candidateId');
  var nameCol = headers.indexOf('name');
  var mobileCol = headers.indexOf('mobile');

  for (var i = 1; i < data.length; i++) {
    var rowId = String(data[i][idCol] || '');
    var rowName = String(data[i][nameCol] || '');
    var rowMobile = String(data[i][mobileCol] || '');
    if (candidateId && rowId && rowId === String(candidateId)) return i + 1;
    if (!candidateId && rowName && rowMobile && rowName === String(name) && rowMobile === String(mobile)) return i + 1;
  }
  return 0;
}

function uploadFile(params) {
  var folderUrl = params.folderUrl || params.driveFolderUrl;
  var candidateName = params.candidateName || params.name || 'candidate';
  var fileName = params.fileName || 'document.pdf';
  var base64 = params.contentBase64;
  if (!folderUrl) throw new Error('Drive folder URL is required');
  if (!base64) throw new Error('No file content provided');

  var folderId = extractDriveFolderId(folderUrl);
  var folder = DriveApp.getFolderById(folderId);
  var content = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(content, 'application/pdf', sanitizeFileName(fileName));
  var file = folder.createFile(blob);
  return { fileUrl: file.getUrl(), fileId: file.getId() };
}

function extractDriveFolderId(url) {
  var match = String(url).match(/[-\w]{25,}/);
  if (!match) throw new Error('Invalid Drive folder URL');
  return match[0];
}

function sanitizeFileName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]/g, '').trim();
}
