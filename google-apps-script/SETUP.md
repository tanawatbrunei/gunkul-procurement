# Tracking Sheet → Firestore sync setup

One-time setup, done once by you (no coding). After this, the team edits
the Google Sheet only; the website shows it live for monitoring.

## 1. Create the spreadsheet

1. Create a new Google Sheet — this is the single master file.
2. Create one tab per person (e.g. `P'Jame`, `P'Kae`, `P'White`, `P'Gam`),
   matching the current tabs on the Tracking Sheet page.
3. In **row 1** of every person tab, paste this header row (must match
   exactly, same order):

   ```
   No.	Company	Dept	Project	Description	PR No.	Date PR	PA No.	Date PA Submitted	Date PA Approved	PO No.	Date PO Submitted	Date PO Approved	Vendor	Vendor ID	Qty	Unit	ราคา/หน่วย	Dis.	Budget	รวม Save Cost	Payment	วันต้องการสินค้า	ทำรับ	Status	Urgent	Supplier 1	Supplier 2	Supplier 3	Remark
   ```

   Don't worry about a "_RowID" column — the script adds it automatically
   one column after Remark, and you should leave it alone.

## 2. Add the sync script

1. In the Sheet, go to **Extensions → Apps Script**.
2. Delete the placeholder code and paste the entire contents of
   `google-apps-script/Code.gs` (in this repo).
3. The `FIREBASE_PROJECT_ID` at the top of the file is already set to
   `gunkul-internship` (this project's Firebase project ID) — no need to
   change it.
4. Click **Save**.

## 3. Grant write access to Firestore

The script writes to Firestore using your own Google account's permissions
(no extra credentials/keys needed) — it just needs the right role:

1. Go to [Google Cloud Console → IAM](https://console.cloud.google.com/iam-admin/iam),
   make sure the Firebase project above is selected.
2. Click **Grant Access**, add your Google account (the one that owns this
   Sheet) with the role **Cloud Datastore User**.
3. Save.

## 4. Authorize and install triggers

1. Back in the Apps Script editor, in the function dropdown (top toolbar)
   select `setupTriggers`, then click **Run**.
2. Google will ask you to authorize — click through "Advanced → Go to
   (project name) (unsafe)" (this warning is normal for personal scripts)
   and allow access to Sheets + external requests.
3. Run `setupProtection` once too (same dropdown) — this locks the header
   row on every person tab so the template can't be edited by mistake.

That's it. From now on:
- Typing/editing any row pushes to the website within a few seconds
  (real-time via the edit trigger).
- A safety-net sync also runs every 6 hours (4×/day) in case any edits
  were missed (e.g. pasting many rows at once) and to clean up rows that
  were deleted. An unchanged row writes nothing to Firestore (the row
  hash is stored in the sheet), so an idle resync stays well within the
  Firestore free (Spark) quota.
- Deleting a row's content in the Sheet removes it from the website too.

## 5. Adding a new person / subsheet later

Duplicate any existing person tab (right-click the tab → Duplicate),
rename it, and clear out the sample rows — keep row 1 (the header) as is.
The script will register it as a new tab automatically the first time
someone edits a row in it.

**Important when clearing the duplicated rows:** select the whole data
area INCLUDING the two hidden helper columns to the right of the
template (`_RowID` and `_Hash`) and delete their contents too. If you
leave old `_RowID`/`_Hash` values behind, the new tab inherits the
source person's row identities and the website can show leftover rows
that aren't in the sheet. After clearing, run a Full resync once to
reconcile the website.

## 6. Migrating existing data

The rows currently in the website (Firestore) were entered directly on
the site before this change — they are NOT automatically copied into the
new Sheet. If you want to keep that history, ask Claude to export the
current Tracking Sheet data to an Excel file per person, then paste those
rows into the matching Sheet tab (above the locked header) — the script
picks them up the moment they're pasted in.


## Read-quota saver: `trackingSlim` (added later)

`Code.gs` also writes one compact document per tab (`trackingSlim/{tabId}`)
after every sync. The website's Summary, Dashboard and cross-tab search read
those (a handful of documents) instead of every row, which keeps Firestore
reads well under the free-plan quota. After pasting the updated `Code.gs`:

1. Run `fullResync` once (it creates the slim documents for every tab).
2. Publish the updated `firestore.rules` (adds read access to `trackingSlim`).

Until both are done the website simply keeps using the old (heavier) path.
