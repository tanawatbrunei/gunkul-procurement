/**
 * Gunkul Procurement — Tracking Sheet sync (Google Sheets -> Firestore)
 *
 * Paste this whole file into Extensions > Apps Script of the master
 * tracking spreadsheet. See ../google-apps-script/SETUP.md for the
 * full step-by-step setup (project ID, triggers, permissions).
 *
 * Every sheet tab EXCEPT "_Config" is treated as one person's tracking
 * subsheet (the Firestore "tabs"). Row 1 of every subsheet must be the
 * locked header row defined in HEADERS below, in this exact order.
 */

var FIREBASE_PROJECT_ID = "gunkul-internship";
var CONFIG_SHEET_NAME = "_Config";
var ROWID_COL_NAME = "_RowID"; // hidden helper column, last column

// HEADERS order MUST match the physical column order (left->right) of every
// subsheet, because rows are read by position. FIELD_MAP (keyed by name) maps
// each header to its Firestore field, so the web/dashboard are unaffected by
// the order — only the sheet column layout has to match this list.
var HEADERS = [
  "No.", "Company", "Dept",
  "Urgent", "Status",
  "PR No.", "Date PR",
  "PA No.", "Date PA Submitted", "Date PA Approved",
  "PO No.", "Date PO Submitted", "Date PO Approved",
  "Project", "Description",
  "Vendor", "Vendor ID",
  "Qty", "Unit", "ราคา/หน่วย", "Dis.", "Budget", "รวม Save Cost",
  "Payment", "วันต้องการสินค้า", "ทำรับ",
  "Supplier 1", "Supplier 2", "Supplier 3",
  "Remark",
];

var FIELD_MAP = {
  "No.": { key: "no", type: "number" },
  "Company": { key: "company", type: "string" },
  "Dept": { key: "dept", type: "string" },
  "Project": { key: "project", type: "string" },
  "Description": { key: "description", type: "string" },
  "PR No.": { key: "prNo", type: "string" },
  "Date PR": { key: "prDate", type: "date" },
  "PA No.": { key: "paNo", type: "string" },
  "Date PA Submitted": { key: "paSubmittedDate", type: "date" },
  "Date PA Approved": { key: "paApprovedDate", type: "date" },
  "PO No.": { key: "poNo", type: "string" },
  "Date PO Submitted": { key: "poSubmittedDate", type: "date" },
  "Date PO Approved": { key: "poApprovedDate", type: "date" },
  "Vendor": { key: "vendor", type: "string" },
  "Vendor ID": { key: "vendorId", type: "string" },
  "Qty": { key: "qty", type: "number" },
  "Unit": { key: "unit", type: "string" },
  "ราคา/หน่วย": { key: "unitPrice", type: "number" },
  "Dis.": { key: "discount", type: "number" },
  "Budget": { key: "budget", type: "number" },
  "รวม Save Cost": { key: "saveCost", type: "number" },
  "Payment": { key: "payment", type: "string" },
  "วันต้องการสินค้า": { key: "neededDate", type: "date" },
  "ทำรับ": { key: "deliveredDate", type: "date" },
  "Status": { key: "status", type: "string" },
  "Urgent": { key: "urgent", type: "boolean" },
  "Remark": { key: "remark", type: "string" },
};
var SUPPLIER_COLS = ["Supplier 1", "Supplier 2", "Supplier 3"];

// "Note3" — a per-row overdue/on-time flag some tabs compute with their own
// formula (e.g. "🟢 ทันกำหนด", "🔴 เกินกำหนด PR-PO (>5 วัน)", "⚪ ยกเลิก"). It sits
// 3 columns after the hidden _Hash column (_RowID, _Hash, Note1, Note2, Note3),
// so it's read by a fixed offset from HEADERS.length rather than by name — it
// is NOT part of HEADERS/FIELD_MAP. Note1/Note2 (the two columns before it)
// are that formula's own day-count workings, not synced: they change with
// today's date on every open row, which would turn every 6-hourly fullResync
// into a write storm across the whole sheet. Guarded by getMaxColumns() so a
// tab/sheet without these columns (e.g. an older sheet) is unaffected.
var TRACKING_STATUS_COL = HEADERS.length + 5;

/* ============================================================
   Triggers — install once via setupTriggers()
   ============================================================ */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger("onEditInstallable").forSpreadsheet(ss).onEdit().create();
  // Safety-net resync runs a few times a day instead of every 5 minutes —
  // real-time edits already sync via onEdit, and syncRow now skips unchanged
  // rows, so a frequent full sweep just burned Firestore quota for nothing.
  ScriptApp.newTrigger("fullResync").timeBased().everyHours(6).create();
  Logger.log("Triggers installed.");
}

/* Guards every subsheet's header row against accidental template edits.
   Uses WARNING-ONLY protection (not hard restriction): a hard lock blocks
   the whole team from using the basic filter/sort on those columns, so
   instead we just show a dismissible warning if someone edits a header
   cell. The template can still be reset any time via setupProtection(). */
function setupProtection() {
  var ss = SpreadsheetApp.getActive();
  ss.getSheets().forEach(function (sheet) {
    if (sheet.getName() === CONFIG_SHEET_NAME) return;
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setValues([HEADERS]);
    // Remove any previous protections on this header range so re-running
    // doesn't stack a hard lock on top of the warning-only one.
    sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
      if (p.getRange() && p.getRange().getRow() === 1) p.remove();
    });
    headerRange.protect()
      .setDescription("Header — please don't edit (warning only)")
      .setWarningOnly(true);
  });
  Logger.log("Header rows protected (warning-only).");
}

/* ============================================================
   onEdit — real-time push of whatever rows were just changed
   ============================================================ */
function onEditInstallable(e) {
  try {
    var sheet = e.range.getSheet();
    var name = sheet.getName();
    if (name === CONFIG_SHEET_NAME) return;
    if (e.range.getRow() === 1) return; // header edits are not data

    var firstRow = Math.max(2, e.range.getRow());
    var lastRow = e.range.getLastRow();
    var tabId = getOrCreateTabId(name);

    for (var r = firstRow; r <= lastRow; r++) {
      syncRow(sheet, tabId, r);
    }
    writeSlimTabSafe(sheet, tabId);
    writeLastSyncedAt();
  } catch (err) {
    Logger.log("onEditInstallable error: " + err);
  }
}

/* ============================================================
   Time-based safety net — catches paste/delete operations that
   onEdit might not fully cover, and removes Firestore rows whose
   sheet row was deleted.

   PERFORMANCE: this used to call syncRow() per row, which makes
   several Spreadsheet round-trips PER ROW — with a few hundred rows
   across many tabs it blew past Apps Script's 6-minute execution
   limit and failed every run. It now reads each whole sheet in ONE
   getValues(), computes hashes in memory, writes only changed rows,
   and fires all Firestore writes/deletes for a sheet in a single
   parallel UrlFetchApp.fetchAll() batch. Helper columns (_RowID,
   _Hash) are written back in one setValues() per sheet.
   ============================================================ */
function fullResync() {
  var ss = SpreadsheetApp.getActive();
  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (name === CONFIG_SHEET_NAME) return;
    var tabId = getOrCreateTabId(name);
    syncSheetBatched(sheet, tabId);
    writeSlimTabSafe(sheet, tabId);
  });
  pruneDeletedTabs();
  writeLastSyncedAt();
}

/* Batched equivalent of looping syncRow() over one sheet. Reads the
   whole data block once, decides per row what to do in memory, then
   issues all Firestore calls in parallel and all helper-cell updates
   in one write. Behaviour matches syncRow row-for-row (same hash
   skip, same blank-row delete, same _RowID assignment). */
function syncSheetBatched(sheet, tabId) {
  var rowIdCol = HEADERS.length + 1;   // hidden _RowID
  var hashCol = HEADERS.length + 2;    // hidden _Hash
  var hasTrackingStatus = sheet.getMaxColumns() >= TRACKING_STATUS_COL;
  var lastRow = sheet.getLastRow();
  var seenRowIds = {};
  if (lastRow < 2) { pruneDeletedRows(tabId, seenRowIds); return; }

  var numRows = lastRow - 1;
  // One read for data + helper columns (+ Note3 when this sheet has it).
  var block = sheet.getRange(2, 1, numRows, hasTrackingStatus ? TRACKING_STATUS_COL : hashCol).getValues();
  var helpers = [];        // [ [rowId, hash], ... ] written back once at the end
  var requests = [];       // Firestore write/delete requests for fetchAll
  var helpersDirty = false;

  for (var i = 0; i < numRows; i++) {
    var values = block[i];
    var rowId = block[i][HEADERS.length];
    var oldHash = block[i][HEADERS.length + 1];

    var isBlank = true;
    for (var c = 0; c < HEADERS.length; c++) {
      if (values[c] !== "" && values[c] !== null) { isBlank = false; break; }
    }

    if (isBlank) {
      if (rowId) {
        requests.push(buildDeleteRequest(tabId, rowId));
        helpers.push(["", ""]);
        helpersDirty = true;
      } else {
        helpers.push([rowId, oldHash]);
      }
      continue;
    }

    if (!rowId) { rowId = "row-" + Utilities.getUuid(); helpersDirty = true; }
    seenRowIds[rowId] = true;

    var data = {};
    for (var h = 0; h < HEADERS.length; h++) {
      if (FIELD_MAP[HEADERS[h]]) {
        data[FIELD_MAP[HEADERS[h]].key] = coerce(values[h], FIELD_MAP[HEADERS[h]].type);
      }
    }
    var suppliers = SUPPLIER_COLS.map(function (label) {
      var idx = HEADERS.indexOf(label);
      return idx >= 0 ? values[idx] : "";
    }).filter(function (v) { return v !== "" && v !== null; });
    if (suppliers.length) data.compareSuppliers = suppliers;
    if (hasTrackingStatus) {
      var trackingStatus = coerce(block[i][TRACKING_STATUS_COL - 1], "string");
      if (trackingStatus !== undefined) data.trackingStatus = trackingStatus;
    }

    var newHash = rowHash(data);
    if (String(oldHash) === newHash) {
      helpers.push([rowId, oldHash]);   // unchanged — no Firestore write
      continue;
    }
    requests.push(buildWriteRequest(tabId, rowId, data));
    helpers.push([rowId, newHash]);
    helpersDirty = true;
  }

  // Fire every Firestore call for this sheet in parallel, chunked so a huge
  // first-time sync can't exceed fetchAll's request-count limits.
  for (var s = 0; s < requests.length; s += 50) {
    UrlFetchApp.fetchAll(requests.slice(s, s + 50));
  }
  if (helpersDirty) {
    sheet.getRange(2, rowIdCol, numRows, 2).setValues(helpers);
  }
  pruneDeletedRows(tabId, seenRowIds);
}

/* ============================================================
   Compact per-tab copy: trackingSlim/{tabId} = { json, count, updatedAt }.
   The website's summary, dashboard and cross-tab search read THIS (one
   document per tab) instead of every row of every tab — that keeps
   Firestore reads far under the free-plan daily quota. Only the fields
   those screens need are included; the full rows under trackingTabs (rows subcollection)
   stay the source for a person's own table. Failures here are logged and
   never break the main row sync (the website falls back to full rows).
   ============================================================ */
var SLIM_HEADERS = [
  "No.", "Company", "Urgent", "Status", "PR No.", "Date PR", "PA No.",
  "PO No.", "Date PO Submitted", "Project", "Description", "Vendor", "Remark",
];
var SLIM_MAX_CHARS = 900000;   // Firestore doc limit is 1 MiB

function writeSlimTabSafe(sheet, tabId) {
  try { writeSlimTab(sheet, tabId); } catch (err) { Logger.log("writeSlimTab error: " + err); }
}

function buildSlimRows(sheet, dropLongText) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var hasTrackingStatus = sheet.getMaxColumns() >= TRACKING_STATUS_COL;
  var block = sheet.getRange(2, 1, lastRow - 1, hasTrackingStatus ? TRACKING_STATUS_COL : HEADERS.length + 2).getValues();
  var out = [];
  for (var i = 0; i < block.length; i++) {
    var rowId = block[i][HEADERS.length];
    if (!rowId) continue;                       // blank / not yet synced
    var row = { id: rowId };
    for (var k = 0; k < SLIM_HEADERS.length; k++) {
      var header = SLIM_HEADERS[k];
      if (dropLongText && (header === "Description" || header === "Remark")) continue;
      var idx = HEADERS.indexOf(header);
      var m = FIELD_MAP[header];
      if (idx < 0 || !m) continue;
      var v = coerce(block[i][idx], m.type);
      if (v !== undefined) row[m.key] = v;
    }
    if (hasTrackingStatus) {
      var trackingStatus = coerce(block[i][TRACKING_STATUS_COL - 1], "string");
      if (trackingStatus !== undefined) row.trackingStatus = trackingStatus;
    }
    out.push(row);
  }
  return out;
}

function writeSlimTab(sheet, tabId) {
  var json = JSON.stringify(buildSlimRows(sheet, false));
  if (json.length > SLIM_MAX_CHARS) json = JSON.stringify(buildSlimRows(sheet, true));
  if (json.length > SLIM_MAX_CHARS) { Logger.log("Slim doc too large for " + tabId + " — skipped"); return; }
  var url = firestoreBaseUrl() + "/trackingSlim/" + tabId
    + "?updateMask.fieldPaths=json&updateMask.fieldPaths=updatedAt";
  var resp = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: {
      json: { stringValue: json },
      updatedAt: { timestampValue: new Date().toISOString() },
    } }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    Logger.log("writeSlimTab FAILED (" + resp.getResponseCode() + "): " + resp.getContentText());
  }
}

function deleteSlimDoc(tabId) {
  UrlFetchApp.fetch(firestoreBaseUrl() + "/trackingSlim/" + tabId, {
    method: "delete",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
}

/* Stamps meta/trackingSync.lastSyncedAt so the website can show a
   "last synced X ago" indicator instead of leaving data freshness a
   guessing game. Cheap: one small write per sync run, not per row. */
function writeLastSyncedAt() {
  var url = firestoreBaseUrl() + "/meta/trackingSync?updateMask.fieldPaths=lastSyncedAt";
  UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: { lastSyncedAt: { timestampValue: new Date().toISOString() } } }),
    muteHttpExceptions: true,
  });
}

/* Removes Firestore tab docs (and their rows) for subsheets that were
   deleted or renamed in the Sheet — otherwise the website keeps showing
   stale tabs like an old "Sheet4" or a tab's former name after a rename.
   Driven by the _Config bookkeeping vs the current live sheet tabs. */
function pruneDeletedTabs() {
  var ss = SpreadsheetApp.getActive();
  var current = {};
  ss.getSheets().forEach(function (s) {
    if (s.getName() !== CONFIG_SHEET_NAME) current[s.getName()] = true;
  });
  var configSheet = getConfigSheet();
  var data = configSheet.getDataRange().getValues();
  // Walk bottom-up so deleting _Config rows doesn't shift the indexes above.
  for (var r = data.length - 1; r >= 1; r--) {
    var name = data[r][0];
    var tabId = data[r][1];
    if (name && !current[name]) {
      pruneDeletedRows(tabId, {});   // delete every row under the stale tab
      deleteFirestoreTab(tabId);     // delete the tab doc itself
      deleteSlimDoc(tabId);          // and its compact summary copy
      configSheet.deleteRow(r + 1);  // remove its _Config bookkeeping row (1-based)
      Logger.log("Pruned stale tab: " + name);
    }
  }
}

function deleteFirestoreTab(tabId) {
  var url = firestoreBaseUrl() + "/trackingTabs/" + tabId;
  UrlFetchApp.fetch(url, {
    method: "delete",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
}

/* ============================================================
   Core: read one sheet row, write it to Firestore. Returns the
   Firestore row doc id (creating + writing back a hidden _RowID
   on the sheet the first time it's touched).
   ============================================================ */
function syncRow(sheet, tabId, rowIndex) {
  var rowIdCol = HEADERS.length + 1;   // hidden _RowID
  var hashCol = HEADERS.length + 2;    // hidden _Hash — lets us skip unchanged rows
  var hasTrackingStatus = sheet.getMaxColumns() >= TRACKING_STATUS_COL;
  var full = sheet.getRange(rowIndex, 1, 1, hasTrackingStatus ? TRACKING_STATUS_COL : hashCol).getValues()[0];
  var values = full.slice(0, HEADERS.length);
  var isBlank = values.every(function (v) { return v === "" || v === null; });
  var rowId = full[rowIdCol - 1];
  var oldHash = full[hashCol - 1];

  if (isBlank) {
    if (rowId) deleteFirestoreRow(tabId, rowId);
    if (rowId) sheet.getRange(rowIndex, rowIdCol, 1, 2).setValues([["", ""]]);
    return null;
  }

  if (!rowId) {
    rowId = "row-" + Utilities.getUuid();
    sheet.getRange(rowIndex, rowIdCol).setValue(rowId);
  }

  // Read by position: each subsheet's column order must match HEADERS exactly.
  var data = {};
  for (var i = 0; i < HEADERS.length; i++) {
    var header = HEADERS[i];
    if (FIELD_MAP[header]) {
      data[FIELD_MAP[header].key] = coerce(values[i], FIELD_MAP[header].type);
    }
  }
  var suppliers = SUPPLIER_COLS.map(function (label) {
    var idx = HEADERS.indexOf(label);
    return idx >= 0 ? values[idx] : "";
  }).filter(function (v) { return v !== "" && v !== null; });
  if (suppliers.length) data.compareSuppliers = suppliers;
  if (hasTrackingStatus) {
    var trackingStatus = coerce(full[TRACKING_STATUS_COL - 1], "string");
    if (trackingStatus !== undefined) data.trackingStatus = trackingStatus;
  }

  // Only hit Firestore when the row's content actually changed. The hash is a
  // sheet cell (no Firestore cost), so an idle fullResync writes nothing.
  var newHash = rowHash(data);
  if (String(oldHash) === newHash) return rowId;

  writeFirestoreRow(tabId, rowId, data);
  sheet.getRange(rowIndex, hashCol).setValue(newHash);
  return rowId;
}

/** Stable MD5 of the row payload, used to detect "nothing changed". */
function rowHash(data) {
  var s = JSON.stringify(data);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex;
}

function coerce(raw, type) {
  if (raw === "" || raw === null || raw === undefined) return undefined;
  if (type === "number") {
    var n = Number(raw);
    return isNaN(n) ? undefined : n;
  }
  if (type === "boolean") {
    if (typeof raw === "boolean") return raw;
    var s = String(raw).trim().toLowerCase();
    // Negatives first — "not urgent" contains "urgent", so it must lose.
    if (s.indexOf("not") === 0 || s === "no" || s === "false" || s === "0"
      || s === "ไม่ด่วน" || s === "ไม่เร่งด่วน") return false;
    return s === "true" || s === "yes" || s === "1" || s === "✓"
      || s === "urgent" || s === "ด่วน" || s === "เร่งด่วน" || s === "งานด่วน";
  }
  if (type === "date") {
    if (raw instanceof Date) return Utilities.formatDate(raw, Session.getScriptTimeZone(), "yyyy-MM-dd");
    return String(raw).trim();
  }
  return String(raw).trim();
}

/* ============================================================
   Firestore REST helpers (authenticated as the Apps Script
   owner's Google account, which needs the "Cloud Datastore User"
   IAM role on the Firebase project — see SETUP.md).
   ============================================================ */
function firestoreBaseUrl() {
  return "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents";
}

function fsValue(v) {
  if (v === undefined || v === null) return { nullValue: null };
  if (typeof v === "number") return { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  return { stringValue: String(v) };
}

/* Build (but don't send) a Firestore row write. Returned in the shape
   UrlFetchApp.fetch/fetchAll expects (a `url` plus fetch params), so the
   same request works for a single fetch() or a batched fetchAll(). */
function buildWriteRequest(tabId, rowId, data) {
  var fields = {};
  Object.keys(data).forEach(function (k) {
    if (data[k] !== undefined) fields[k] = fsValue(data[k]);
  });
  var mask = Object.keys(fields).map(function (k) { return "updateMask.fieldPaths=" + encodeURIComponent(k); }).join("&");
  return {
    url: firestoreBaseUrl() + "/trackingTabs/" + tabId + "/rows/" + rowId + "?" + mask,
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true,
  };
}

function buildDeleteRequest(tabId, rowId) {
  return {
    url: firestoreBaseUrl() + "/trackingTabs/" + tabId + "/rows/" + rowId,
    method: "delete",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  };
}

function writeFirestoreRow(tabId, rowId, data) {
  var req = buildWriteRequest(tabId, rowId, data);
  var resp = UrlFetchApp.fetch(req.url, req);
  if (resp.getResponseCode() >= 300) {
    Logger.log("writeFirestoreRow FAILED (" + resp.getResponseCode() + "): " + resp.getContentText());
  }
}

function deleteFirestoreRow(tabId, rowId) {
  var req = buildDeleteRequest(tabId, rowId);
  UrlFetchApp.fetch(req.url, req);
}

function pruneDeletedRows(tabId, seenRowIds) {
  // Firestore's documents.list caps each response at pageSize (max 300) and
  // returns a nextPageToken for the rest. We MUST follow every page or stale
  // rows beyond the first page never get deleted (e.g. a tab duplicated from
  // another person that once held 300+ rows would keep showing the leftovers).
  var base = firestoreBaseUrl() + "/trackingTabs/" + tabId + "/rows?pageSize=300";
  var pageToken = "";
  do {
    var url = base + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    var json = JSON.parse(resp.getContentText());
    (json.documents || []).forEach(function (docEntry) {
      var id = docEntry.name.split("/").pop();
      if (!seenRowIds[id]) deleteFirestoreRow(tabId, id);
    });
    pageToken = json.nextPageToken || "";
  } while (pageToken);
}

/* ============================================================
   Tab bookkeeping — each subsheet name maps to one trackingTabs
   Firestore doc, created on first sync.
   ============================================================ */
function getOrCreateTabId(sheetName) {
  var configSheet = getConfigSheet();
  var data = configSheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === sheetName) return data[r][1];
  }
  var tabId = "tab-" + Utilities.getUuid();
  var order = data.length; // 0-based, increases as tabs are added
  configSheet.appendRow([sheetName, tabId, order]);
  createFirestoreTabDoc(tabId, sheetName, order);
  return tabId;
}

function createFirestoreTabDoc(tabId, name, order) {
  var url = firestoreBaseUrl() + "/trackingTabs/" + tabId
    + "?updateMask.fieldPaths=name&updateMask.fieldPaths=order";
  var resp = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ fields: { name: fsValue(name), order: fsValue(order) } }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    Logger.log("createFirestoreTabDoc FAILED (" + resp.getResponseCode() + "): " + resp.getContentText());
  }
}

function getConfigSheet() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG_SHEET_NAME);
    sheet.appendRow(["SheetName", "TabId", "Order"]);
    sheet.hideSheet();
  }
  return sheet;
}
