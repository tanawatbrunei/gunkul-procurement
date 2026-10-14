import { collection, doc, getDoc, getDocs, orderBy, query, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import type { Tab, TrackingRow } from "../TrackingPage";

/* ============================================================
   Shared, cached, batch-synced store for the tracking dataset.

   This page is a read-only mirror of the master Google Sheet, so there
   is nothing to write back — the only Firebase cost is READING it. The
   old version opened live onSnapshot listeners (every Sheet edit pushed
   reads to every open browser). This version instead:

   - Loads with one-shot getDocs (no live listeners).
   - Persists the last snapshot in IndexedDB, so a reload / new tab
     costs zero reads while the cache is still fresh.
   - Treats the cache as fresh until the next 00:00 / 12:00 (local
     time) boundary — i.e. at most two refreshes a day per browser,
     matching the "sync every 12 hours" rule.
   - Offers `syncNow()` for a manual refresh, rate-limited to once per
     15 minutes per browser (persisted, so reloading doesn't reset it).

   The Sheet -> Firestore half of the pipeline (Apps Script triggers)
   is unchanged; this module only controls how often the BROWSER reads
   Firestore. The public subscribe / get API is the same as before, so
   Dashboard / TrackingPage / useTrackingRows need no changes.

   Rows are NOT status-normalized here (that would need importing
   `normalizeStatus`, a value from TrackingPage.tsx, creating a circular
   runtime import) — callers normalize on read, same as before.
   ============================================================ */

type Listener = () => void;

const MANUAL_SYNC_COOLDOWN_MS = 15 * 60 * 1000;
const MANUAL_SYNC_KEY = "gunkul-tracking-last-manual-sync";
/** Slim docs written by an older script lack fields the Dashboard needs (PA/PO
 *  approved dates, qty/price, needed/delivered dates) — ignore them so the
 *  caller falls back to full rows instead of showing wrong numbers. */
const SLIM_SCHEMA = 2;

/** Start of the current 12h window (the most recent 00:00 or 12:00, local). */
function lastBoundary(now = new Date()): number {
  const d = new Date(now);
  d.setHours(now.getHours() >= 12 ? 12 : 0, 0, 0, 0);
  return d.getTime();
}
/** The next scheduled batch-sync boundary (the coming 00:00 or 12:00, local time). */
export function nextScheduledSync(now = new Date()): Date {
  const d = new Date(now);
  if (now.getHours() < 12) d.setHours(12, 0, 0, 0);
  else { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); }
  return d;
}
const isFresh = (fetchedAt: number | undefined) => !!fetchedAt && fetchedAt >= lastBoundary();

// ---------- IndexedDB persistence (tiny key-value; failure = no persistence) ----------

interface Snapshot {
  v: 1;
  tabs: Tab[]; tabsFetchedAt: number;
  slim: Record<string, TrackingRow[]>; slimFetchedAt: number;
  rows: Record<string, { rows: TrackingRow[]; fetchedAt: number }>;
  sheetSyncedAt: number | null;
}

const IDB_NAME = "gunkul-tracking-cache";
function idbOpen(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function idbGet(): Promise<Snapshot | undefined> {
  const d = await idbOpen();
  if (!d) return undefined;
  return new Promise((resolve) => {
    const req = d.transaction("kv").objectStore("kv").get("snapshot");
    req.onsuccess = () => resolve(req.result as Snapshot | undefined);
    req.onerror = () => resolve(undefined);
  });
}
async function idbSet(snap: Snapshot): Promise<void> {
  const d = await idbOpen();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction("kv", "readwrite");
    tx.objectStore("kv").put(snap, "snapshot");
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ---------- in-memory state ----------

let tabsCache: Tab[] = [];
let tabsError: string | null = null;
let tabsFetchedAt = 0;
const tabsListeners = new Set<Listener>();

const rowsCache: Record<string, TrackingRow[]> = {};
const rowsFetchedAt: Record<string, number> = {};
const rowsErrorByTab: Record<string, string | null> = {};
const rowsListeners: Record<string, Set<Listener>> = {};

let slimRows: Record<string, TrackingRow[]> = {};
let slimLoaded = false;
let slimFetchedAt = 0;
const slimListeners = new Set<Listener>();

let sheetSyncedAt: number | null = null;
let syncing = false;
const syncListeners = new Set<Listener>();

const inflight = new Map<string, Promise<void>>();
const once = (key: string, fn: () => Promise<void>) => {
  let p = inflight.get(key);
  if (!p) { p = fn().finally(() => inflight.delete(key)); inflight.set(key, p); }
  return p;
};

const notify = (set: Set<Listener> | undefined) => set?.forEach((l) => l());

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const rows: Snapshot["rows"] = {};
    for (const id of Object.keys(rowsCache)) rows[id] = { rows: rowsCache[id], fetchedAt: rowsFetchedAt[id] ?? 0 };
    void idbSet({ v: 1, tabs: tabsCache, tabsFetchedAt, slim: slimRows, slimFetchedAt, rows, sheetSyncedAt });
  }, 500);
}

// ---------- hydration (once per page load) ----------

let hydrated: Promise<void> | null = null;
function hydrate(): Promise<void> {
  if (!hydrated) {
    hydrated = idbGet().then((snap) => {
      if (!snap || snap.v !== 1) return;
      tabsCache = snap.tabs; tabsFetchedAt = snap.tabsFetchedAt;
      slimRows = snap.slim; slimFetchedAt = snap.slimFetchedAt; slimLoaded = slimFetchedAt > 0;
      for (const [id, e] of Object.entries(snap.rows)) { rowsCache[id] = e.rows; rowsFetchedAt[id] = e.fetchedAt; }
      sheetSyncedAt = snap.sheetSyncedAt;
    });
  }
  return hydrated;
}

// ---------- loaders (one-shot reads, deduped, skipped while cache is fresh) ----------

function loadTabs(force = false): Promise<void> {
  return once("tabs", async () => {
    await hydrate();
    if (!force && isFresh(tabsFetchedAt)) { notify(tabsListeners); notify(syncListeners); return; }
    try {
      const snap = await getDocs(query(collection(db, "trackingTabs"), orderBy("order")));
      tabsCache = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tab, "id">) }));
      tabsError = null;
      tabsFetchedAt = Date.now();
      schedulePersist();
    } catch (e) {
      // Keep showing the cached copy if we have one; only surface the error when there's nothing to show.
      if (tabsCache.length === 0) tabsError = e instanceof Error ? e.message : String(e);
    }
    notify(tabsListeners); notify(syncListeners);
  });
}

function loadRows(tabId: string, force = false): Promise<void> {
  return once(`rows:${tabId}`, async () => {
    await hydrate();
    const listeners = rowsListeners[tabId];
    if (!force && isFresh(rowsFetchedAt[tabId])) { notify(listeners); return; }
    try {
      const snap = await getDocs(query(collection(db, "trackingTabs", tabId, "rows"), orderBy("no")));
      rowsCache[tabId] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TrackingRow, "id">) }));
      rowsErrorByTab[tabId] = null;
      rowsFetchedAt[tabId] = Date.now();
      schedulePersist();
    } catch (e) {
      if (!rowsCache[tabId]) rowsErrorByTab[tabId] = e instanceof Error ? e.message : String(e);
    }
    notify(listeners); notify(syncListeners);
  });
}

/* The Apps Script also writes a compact copy of each tab's rows into ONE
   document, `trackingSlim/{tabId}` = { json: "[...rows...]" } (only the fields
   the summary, dashboard and search need). Reading ~12 such docs replaces
   reading every row of every tab — the biggest single saving on the free
   Firestore read quota. Tabs with no slim doc yet (script not updated, or
   rules not published) fall back to the full rows loaders above. */
function loadSlim(force = false): Promise<void> {
  return once("slim", async () => {
    await hydrate();
    if (!force && slimLoaded && isFresh(slimFetchedAt)) { notify(slimListeners); return; }
    try {
      const snap = await getDocs(collection(db, "trackingSlim"));
      const next: Record<string, TrackingRow[]> = {};
      snap.docs.forEach((d) => {
        if (Number(d.data().schema ?? 1) < SLIM_SCHEMA) return;
        try {
          const parsed = JSON.parse(String(d.data().json ?? "[]"));
          if (Array.isArray(parsed)) next[d.id] = parsed as TrackingRow[];
        } catch { /* corrupt doc: treat as missing, caller falls back */ }
      });
      slimRows = next;
      slimFetchedAt = Date.now();
      schedulePersist();
    } catch {
      // e.g. rules not published yet: behave as "no slim data" unless we already have a cached copy.
      if (!slimLoaded) slimRows = {};
    }
    slimLoaded = true;
    notify(slimListeners); notify(syncListeners);
  });
}

/** When the Apps Script last pushed the Sheet into Firestore (meta/trackingSync). */
async function loadSheetStamp(): Promise<void> {
  try {
    const snap = await getDoc(doc(db, "meta", "trackingSync"));
    const raw = snap.data()?.lastSyncedAt as Timestamp | string | undefined;
    if (raw) { sheetSyncedAt = (raw instanceof Timestamp ? raw.toDate() : new Date(raw)).getTime(); schedulePersist(); }
  } catch { /* indicator only — ignore */ }
}

// ---------- public API (same shape as the old live-listener version) ----------

/** Subscribe to the shared tabs list. Fires once data is available (cache or fetch). */
export function subscribeTabs(listener: Listener): () => void {
  tabsListeners.add(listener);
  void loadTabs();
  if (tabsCache.length > 0 || tabsError) listener();
  return () => { tabsListeners.delete(listener); };
}
export const getTabsSnapshot = (): Tab[] => tabsCache;
export const getTabsError = (): string | null => tabsError;

/** Subscribe to one tab's rows. */
export function subscribeRows(tabId: string, listener: Listener): () => void {
  (rowsListeners[tabId] ??= new Set()).add(listener);
  void loadRows(tabId);
  if (rowsCache[tabId] || rowsErrorByTab[tabId]) listener();
  return () => { rowsListeners[tabId]?.delete(listener); };
}
export const getRowsSnapshot = (tabId: string): TrackingRow[] => rowsCache[tabId] ?? [];
export const getRowsError = (tabId: string): string | null => rowsErrorByTab[tabId] ?? null;

export function subscribeSlim(listener: Listener): () => void {
  slimListeners.add(listener);
  void loadSlim();
  if (slimLoaded) listener();
  return () => { slimListeners.delete(listener); };
}
export const getSlimSnapshot = (): { rows: Record<string, TrackingRow[]>; loaded: boolean } => ({ rows: slimRows, loaded: slimLoaded });

// ---------- sync state + manual "Sync now" ----------

export interface SyncState {
  /** When this browser last read the data from Firebase (null = not loaded yet). */
  loadedAt: number | null;
  /** When the Apps Script last pushed the Google Sheet into Firebase. */
  sheetSyncedAt: number | null;
  syncing: boolean;
  /** Epoch ms when the manual Sync button unlocks again (0 = available now). */
  nextManualAt: number;
}

const lastManualAt = () => { try { return Number(localStorage.getItem(MANUAL_SYNC_KEY) ?? 0) || 0; } catch { return 0; } };
const stateKey = (s: SyncState) => `${s.loadedAt}|${s.sheetSyncedAt}|${s.syncing}|${s.nextManualAt}`;
let lastState: SyncState = { loadedAt: null, sheetSyncedAt: null, syncing: false, nextManualAt: 0 };

/** Stable reference unless something changed (safe to use as a React snapshot). */
export function getSyncState(): SyncState {
  const loadedAt = Math.max(tabsFetchedAt, slimFetchedAt, ...Object.values(rowsFetchedAt)) || null;
  const next: SyncState = {
    loadedAt, sheetSyncedAt, syncing,
    nextManualAt: Math.max(0, lastManualAt() + MANUAL_SYNC_COOLDOWN_MS),
  };
  if (stateKey(next) !== stateKey(lastState)) lastState = next;
  return lastState;
}

export function subscribeSyncState(listener: Listener): () => void {
  syncListeners.add(listener);
  void hydrate().then(() => { void loadSheetStampIfNeeded(); notify(syncListeners); });
  return () => { syncListeners.delete(listener); };
}
async function loadSheetStampIfNeeded() { if (sheetSyncedAt === null) await loadSheetStamp(); }

/** Re-read everything from Firebase now. Limited to once per 15 minutes per browser. */
export async function syncNow(): Promise<{ ok: boolean; retryAt?: number }> {
  const now = Date.now();
  const unlockAt = lastManualAt() + MANUAL_SYNC_COOLDOWN_MS;
  if (syncing) return { ok: false, retryAt: unlockAt };
  if (now < unlockAt) return { ok: false, retryAt: unlockAt };
  try { localStorage.setItem(MANUAL_SYNC_KEY, String(now)); } catch { /* ignore */ }
  syncing = true; notify(syncListeners);
  try {
    await hydrate();
    // Tabs nobody is looking at get marked stale and refetch lazily the next time they're opened.
    const active = Object.keys(rowsListeners).filter((id) => rowsListeners[id].size > 0);
    for (const id of Object.keys(rowsFetchedAt)) if (!active.includes(id)) rowsFetchedAt[id] = 0;
    await Promise.all([loadTabs(true), loadSlim(true), loadSheetStamp(), ...active.map((id) => loadRows(id, true))]);
  } finally {
    syncing = false; notify(syncListeners);
  }
  return { ok: true };
}
