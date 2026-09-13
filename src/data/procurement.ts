/**
 * Procurement data layer — single source of truth = `poLines` (imported from the
 * "All_Purchase orders" export). `vendors` and `items` are caches recomputed from
 * poLines on every import, so they can never drift out of sync.
 *
 * Re-imports MERGE by PO number: a Purchase order already in the system is never
 * touched again (Gunkul can only pull ~2 years back, so old data must be preserved).
 * The caller may also pass a start date to skip POs older than a chosen cut-off.
 */
import * as XLSX from "xlsx";
import {
  collection, getDocs, doc, writeBatch, setDoc, getDoc, query, where, orderBy,
} from "firebase/firestore";
import { db, auth } from "../firebase";

// ---------- Types ----------

export type PurchaseStatus =
  | "Invoiced" | "Open order" | "Canceled" | "Received" | string;

/** One purchase-order line — mirrors a row of the All_Purchase orders file. */
export interface POLine {
  id: string;            // `${poNumber}__${seq}` — deterministic within a PO
  poNumber: string;
  poDate: string;        // YYYY-MM-DD (Accounting date, fallback Created date)
  company: string;       // Company code (GKE / GUE / ...) — one per import file
  status: PurchaseStatus;
  vendorCode: string;    // Vendor account
  vendorName: string;    // Name
  vendorGroup: string;   // Vendor group (LOCAL / GROUP / OVERSEA / EMP)
  itemNumber: string;    // "" for service/labour lines
  productName: string;
  category: string;
  unit: string;
  currency: string;
  qty: number;
  unitPrice: number;
  amountTHB: number;
  paymentTerms: string;
  project: string;       // D06_Project
}

/** Aggregated vendor record stored in `vendors`. Derived fields are recomputed;
 *  manual fields (categories, note, status) are preserved across recomputes. */
export interface VendorAgg {
  vendorCode: string;
  name: string;
  vendorGroup: string;
  totalSpend: number;
  numPOs: number;
  lastPurchase: string;
  topPaymentTerms: string;
  topProject: string;
  categorySpend: Record<string, number>;
  monthlySpend: Record<string, number>;
}

/** Per-vendor price stats for one item (apple-to-apple comparison). */
export interface ItemVendorStat {
  vendorCode: string;
  vendorName: string;
  lastPrice: number;
  lastDate: string;
  lastPoNumber: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  qty: number;
  count: number;
}

/** Aggregated item record stored in `items`. */
export interface ItemAgg {
  itemNumber: string;
  productName: string;
  searchName: string;
  category: string;
  unit: string;
  totalQty: number;
  totalSpend: number;
  numVendors: number;
  lastPrice: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  vendors: ItemVendorStat[];
  /** Distinct company codes (GKE/GUE/GSC/...) that have bought this item. */
  companies: string[];
}

// ---------- Cleaning helpers ----------

/** Trim + collapse internal whitespace; returns "" for null/undefined. */
export function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Excel cell (Date | serial | string) → YYYY-MM-DD. "" if unparseable. */
function toISODate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 0) {
    // Excel serial date → JS Date (epoch 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return toISODate(d);
  }
  const s = clean(v);
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

const STATUS_NON_SPEND = new Set(["Canceled", "Cancelled"]);
/** Spend counts every status except Canceled. */
export function countsAsSpend(status: string): boolean {
  return !STATUS_NON_SPEND.has(clean(status));
}

// ---------- Parsing ----------

/** Column header → POLine field. Tolerant to spacing/case via normalizeHeader. */
const PO_HEADERS: Record<string, keyof POLine | "createdDate"> = {
  "purchase order": "poNumber",
  "accounting date": "poDate",
  "created date and time": "createdDate",
  "company": "company",
  "purchase order status": "status",
  "vendor account": "vendorCode",
  "name": "vendorName",
  "vendor group": "vendorGroup",
  "item number": "itemNumber",
  "product name": "productName",
  "category": "category",
  "unit": "unit",
  "currency": "currency",
  "quantity": "qty",
  "unit price": "unitPrice",
  "amount (thb)": "amountTHB",
  "terms of payment": "paymentTerms",
  "d06_project": "project",
};

function normalizeHeader(h: string): string {
  return clean(h).toLowerCase();
}

export interface ParsedPO {
  lines: Omit<POLine, "id">[];
  poNumbers: string[];       // distinct PO numbers found (after date filter)
  skippedNoPO: number;
  skippedBeforeDate: number;
}

/** Parse the All_Purchase orders workbook. `startDate` (YYYY-MM-DD) filters out
 *  POs whose date is strictly before it; pass "" to keep everything. */
export function parsePurchaseOrders(buf: ArrayBuffer, startDate: string): ParsedPO {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: undefined });

  const lines: Omit<POLine, "id">[] = [];
  const poSet = new Set<string>();
  let skippedNoPO = 0, skippedBeforeDate = 0;

  for (const row of raw) {
    const rec: Record<string, unknown> = {};
    for (const [header, value] of Object.entries(row)) {
      const key = PO_HEADERS[normalizeHeader(header)];
      if (key) rec[key] = value;
    }
    const poNumber = clean(rec.poNumber);
    const vendorCode = clean(rec.vendorCode);
    if (!poNumber || !vendorCode) { skippedNoPO++; continue; }

    const poDate = toISODate(rec.poDate) || toISODate(rec.createdDate);
    if (startDate && poDate && poDate < startDate) { skippedBeforeDate++; continue; }

    lines.push({
      poNumber,
      poDate,
      company: clean(rec.company).toUpperCase(),
      status: clean(rec.status),
      vendorCode,
      vendorName: clean(rec.vendorName),
      vendorGroup: clean(rec.vendorGroup),
      itemNumber: clean(rec.itemNumber),
      productName: clean(rec.productName),
      category: clean(rec.category),
      unit: clean(rec.unit),
      currency: clean(rec.currency),
      qty: num(rec.qty),
      unitPrice: num(rec.unitPrice),
      amountTHB: num(rec.amountTHB),
      paymentTerms: clean(rec.paymentTerms),
      project: clean(rec.project),
    });
    poSet.add(poNumber);
  }
  return { lines, poNumbers: [...poSet], skippedNoPO, skippedBeforeDate };
}

const PRODUCT_HEADERS: Record<string, "itemNumber" | "productName" | "searchName"> = {
  "product number": "itemNumber",
  "product name": "productName",
  "search name": "searchName",
};

/** Parse All_Products → map itemNumber → {productName, searchName}. */
export function parseProducts(buf: ArrayBuffer): Map<string, { productName: string; searchName: string }> {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: undefined });
  const map = new Map<string, { productName: string; searchName: string }>();
  for (const row of raw) {
    const rec: Record<string, string> = {};
    for (const [header, value] of Object.entries(row)) {
      const key = PRODUCT_HEADERS[normalizeHeader(header)];
      if (key) rec[key] = clean(value);
    }
    const itemNumber = rec.itemNumber;
    if (!itemNumber) continue;
    // last occurrence wins (dirty duplicates exist in the source file)
    map.set(itemNumber, { productName: rec.productName || "", searchName: rec.searchName || "" });
  }
  return map;
}

// ---------- Aggregation (pure) ----------

function topKey(counts: Record<string, number>): string {
  let best = "", bestN = -Infinity;
  for (const [k, n] of Object.entries(counts)) if (n > bestN) { best = k; bestN = n; }
  return best;
}

/** Recompute vendor aggregates from all poLines. */
export function aggregateVendors(lines: POLine[]): Map<string, VendorAgg> {
  const acc = new Map<string, {
    v: VendorAgg; pos: Set<string>;
    terms: Record<string, number>; projects: Record<string, number>;
  }>();
  for (const l of lines) {
    if (!countsAsSpend(l.status)) continue;
    let e = acc.get(l.vendorCode);
    if (!e) {
      e = {
        v: {
          vendorCode: l.vendorCode, name: l.vendorName, vendorGroup: l.vendorGroup,
          totalSpend: 0, numPOs: 0, lastPurchase: "", topPaymentTerms: "", topProject: "",
          categorySpend: {}, monthlySpend: {},
        },
        pos: new Set(), terms: {}, projects: {},
      };
      acc.set(l.vendorCode, e);
    }
    if (l.vendorName) e.v.name = l.vendorName;
    if (l.vendorGroup) e.v.vendorGroup = l.vendorGroup;
    e.v.totalSpend += l.amountTHB;
    e.pos.add(l.poNumber);
    if (l.poDate > e.v.lastPurchase) e.v.lastPurchase = l.poDate;
    if (l.category) e.v.categorySpend[l.category] = (e.v.categorySpend[l.category] || 0) + l.amountTHB;
    if (l.poDate) {
      const ym = l.poDate.slice(0, 7);
      e.v.monthlySpend[ym] = (e.v.monthlySpend[ym] || 0) + l.amountTHB;
    }
    if (l.paymentTerms) e.terms[l.paymentTerms] = (e.terms[l.paymentTerms] || 0) + 1;
    if (l.project) e.projects[l.project] = (e.projects[l.project] || 0) + 1;
  }
  const out = new Map<string, VendorAgg>();
  for (const [code, e] of acc) {
    e.v.numPOs = e.pos.size;
    e.v.topPaymentTerms = topKey(e.terms);
    e.v.topProject = topKey(e.projects);
    out.set(code, e.v);
  }
  return out;
}

/** Recompute item aggregates (only lines with an item number, excluding Canceled). */
export function aggregateItems(
  lines: POLine[],
  productMap?: Map<string, { productName: string; searchName: string }>,
): Map<string, ItemAgg> {
  // itemNumber → vendorCode → records
  const acc = new Map<string, Map<string, { name: string; prices: { p: number; d: string; po: string }[]; qty: number }>>();
  const meta = new Map<string, { productName: string; category: string; unit: string }>();
  const companiesByItem = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.itemNumber || !countsAsSpend(l.status)) continue;
    if (l.currency && l.currency !== "THB") continue; // compare like-for-like in THB only
    let vm = acc.get(l.itemNumber);
    if (!vm) { vm = new Map(); acc.set(l.itemNumber, vm); }
    let r = vm.get(l.vendorCode);
    if (!r) { r = { name: l.vendorName, prices: [], qty: 0 }; vm.set(l.vendorCode, r); }
    if (l.vendorName) r.name = l.vendorName;
    if (l.unitPrice > 0) r.prices.push({ p: l.unitPrice, d: l.poDate, po: l.poNumber });
    r.qty += l.qty;
    const m = meta.get(l.itemNumber);
    if (!m) meta.set(l.itemNumber, { productName: l.productName, category: l.category, unit: l.unit });
    else if (!m.productName && l.productName) m.productName = l.productName;
    if (l.company) {
      let cs = companiesByItem.get(l.itemNumber);
      if (!cs) { cs = new Set(); companiesByItem.set(l.itemNumber, cs); }
      cs.add(l.company);
    }
  }

  const out = new Map<string, ItemAgg>();
  for (const [itemNumber, vm] of acc) {
    const vendors: ItemVendorStat[] = [];
    let totalQty = 0, totalSpend = 0;
    const allPrices: number[] = [];
    let globalLast = { p: 0, d: "" };
    for (const [vendorCode, r] of vm) {
      if (!r.prices.length) continue;
      const ps = r.prices.map((x) => x.p);
      const sorted = [...r.prices].sort((a, b) => (a.d < b.d ? 1 : -1));
      const last = sorted[0];
      const avg = ps.reduce((s, x) => s + x, 0) / ps.length;
      vendors.push({
        vendorCode, vendorName: r.name,
        lastPrice: last.p, lastDate: last.d, lastPoNumber: last.po,
        avgPrice: avg, minPrice: Math.min(...ps), maxPrice: Math.max(...ps),
        qty: r.qty, count: ps.length,
      });
      totalQty += r.qty;
      totalSpend += ps.reduce((s, x) => s + x, 0); // indicative; line amounts vary
      allPrices.push(...ps);
      if (last.d > globalLast.d) globalLast = last;
    }
    if (!vendors.length) continue;
    vendors.sort((a, b) => a.lastPrice - b.lastPrice); // cheapest first
    const m = meta.get(itemNumber)!;
    const enrich = productMap?.get(itemNumber);
    out.set(itemNumber, {
      itemNumber,
      productName: enrich?.productName || m.productName || "",
      searchName: enrich?.searchName || "",
      category: m.category || "",
      unit: m.unit || "",
      totalQty,
      totalSpend,
      numVendors: vendors.length,
      lastPrice: globalLast.p,
      avgPrice: allPrices.reduce((s, x) => s + x, 0) / allPrices.length,
      minPrice: Math.min(...allPrices),
      maxPrice: Math.max(...allPrices),
      vendors,
      companies: [...(companiesByItem.get(itemNumber) ?? [])].sort(),
    });
  }
  return out;
}

// ---------- Firestore I/O ----------

const PO_INDEX_DOC = ["meta", "poImport"] as const;

async function chunkedSet(
  entries: { ref: ReturnType<typeof doc>; data: Record<string, unknown> }[],
  merge = false,
) {
  for (let i = 0; i < entries.length; i += 400) {
    const batch = writeBatch(db);
    for (const e of entries.slice(i, i + 400)) batch.set(e.ref, e.data, { merge });
    await batch.commit();
  }
}

async function chunkedDelete(refs: ReturnType<typeof doc>[]) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
}

/** Order-independent stable JSON for comparing an aggregate against its stored
 *  doc, so we only write docs whose derived fields actually changed. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

/** True when every key in `next` already equals the same key in `prev`
 *  (prev may carry extra manual fields, which we ignore). */
function sameSubset(prev: Record<string, unknown> | undefined, next: Record<string, unknown>): boolean {
  if (!prev) return false;
  return Object.keys(next).every((k) => stableStringify(prev[k]) === stableStringify(next[k]));
}

export interface ImportResult {
  newPOs: number;
  newLines: number;
  skippedExisting: number;
  skippedNoPO: number;
  skippedBeforeDate: number;
  vendorsUpserted: number;
  itemsUpserted: number;
}

/** One row in the "PO update history" log — one entry per import run,
 *  even when it added zero new POs, so the team can see *when* someone
 *  last checked for updates, not just what changed. */
export interface ImportHistoryEntry {
  id: string;
  timestamp: string;   // ISO datetime
  importedBy: string;  // auth email, "unknown" if not signed in (shouldn't happen)
  fileName: string;
  companies: string[];
  newPOs: number;
  newLines: number;
  skippedExisting: number;
  skippedNoPO: number;
  skippedBeforeDate: number;
}

/** Read the set of already-imported PO numbers from the index doc. */
async function loadImportedPOs(): Promise<Set<string>> {
  const ref = doc(db, PO_INDEX_DOC[0], PO_INDEX_DOC[1]);
  const snap = await getDoc(ref);
  const arr = (snap.exists() ? (snap.data().poNumbers as string[]) : []) || [];
  return new Set(arr);
}

/** Read all poLines from Firestore (used to recompute aggregates after a merge). */
async function loadAllPOLines(): Promise<POLine[]> {
  const snap = await getDocs(collection(db, "poLines"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<POLine, "id">) }));
}

/**
 * Import a PO file (merge by PO number) and recompute vendors + items.
 * Optionally enrich item names from a parsed products map.
 */
export async function importPurchaseOrders(
  poBuf: ArrayBuffer,
  startDate: string,
  productMap?: Map<string, { productName: string; searchName: string }>,
  fileName = "",
): Promise<ImportResult> {
  const parsed = parsePurchaseOrders(poBuf, startDate);
  const existing = await loadImportedPOs();

  // Merge: keep only lines whose PO number is new.
  const newPONumbers = parsed.poNumbers.filter((p) => !existing.has(p));
  const newSet = new Set(newPONumbers);
  const seq: Record<string, number> = {};
  const newLineEntries = parsed.lines
    .filter((l) => newSet.has(l.poNumber))
    .map((l) => {
      const i = (seq[l.poNumber] = (seq[l.poNumber] ?? 0) + 1);
      const id = `${l.poNumber}__${i}`;
      return { ref: doc(db, "poLines", id), data: { ...l, id } };
    });

  await chunkedSet(newLineEntries);

  // Update the PO index doc.
  await setDoc(doc(db, PO_INDEX_DOC[0], PO_INDEX_DOC[1]), {
    poNumbers: [...existing, ...newPONumbers],
    count: existing.size + newPONumbers.length,
  }, { merge: true });

  // Recompute aggregates from the full (post-merge) set.
  const allLines = await loadAllPOLines();
  const vendorAggs = aggregateVendors(allLines);
  const itemAggs = aggregateItems(allLines, productMap);

  // Upsert vendors, preserving manual fields (status/note/categories) by matching
  // vendorCode. Only write a doc whose derived fields actually changed — this keeps
  // re-imports from spending thousands of writes (and hitting the daily quota).
  const vendorSnap = await getDocs(collection(db, "vendors"));
  const codeToId = new Map<string, string>();
  const vendorPrev = new Map<string, Record<string, unknown>>();
  for (const d of vendorSnap.docs) {
    const data = d.data() as { vendorCode?: string };
    const code = clean(data.vendorCode) || d.id;
    codeToId.set(code, d.id);
    vendorPrev.set(d.id, data as Record<string, unknown>);
  }
  const vendorEntries = [...vendorAggs.values()].map((v) => {
    const id = codeToId.get(v.vendorCode) || v.vendorCode;
    return {
      ref: doc(db, "vendors", id),
      data: {
        vendorCode: v.vendorCode, name: v.name, vendorGroup: v.vendorGroup,
        totalSpend: v.totalSpend, numPOs: v.numPOs, lastPurchase: v.lastPurchase,
        topPaymentTerms: v.topPaymentTerms, topProject: v.topProject,
        categorySpend: v.categorySpend, monthlySpend: v.monthlySpend,
        source: "po-import",
      } as Record<string, unknown>,
      id,
    };
  }).filter((e) => !sameSubset(vendorPrev.get(e.id), e.data));
  await chunkedSet(vendorEntries, true); // merge → keep status/note/categories

  // Items collection mirrors the aggregation exactly. Write only changed/new docs
  // and delete items that no longer appear in any PO line.
  const itemSnap = await getDocs(collection(db, "items"));
  const itemPrev = new Map<string, Record<string, unknown>>();
  for (const d of itemSnap.docs) itemPrev.set(d.id, d.data() as Record<string, unknown>);

  const itemEntries = [...itemAggs.values()]
    .map((it) => ({ ref: doc(db, "items", it.itemNumber), data: it as unknown as Record<string, unknown>, id: it.itemNumber }))
    .filter((e) => !sameSubset(itemPrev.get(e.id), e.data));
  await chunkedSet(itemEntries);

  const staleItemRefs = [...itemPrev.keys()]
    .filter((id) => !itemAggs.has(id))
    .map((id) => doc(db, "items", id));
  await chunkedDelete(staleItemRefs);

  // Stamp every company present in this file with today's date, so the UI can
  // show "last updated per company" (refreshes even on a re-import with 0 new POs).
  const companies = [...new Set(parsed.lines.map((l) => l.company).filter(Boolean))];
  if (companies.length) {
    const today = new Date().toISOString().slice(0, 10);
    const updates: Record<string, string> = {};
    for (const c of companies) updates[c] = today;
    await setDoc(doc(db, "meta", "companyUpdates"), { updates }, { merge: true });
  }

  // Log this import run (even a 0-new-PO run) so the team can see who last
  // checked for updates and when — the weekly "PO update history".
  const historyId = `${Date.now()}`;
  const historyEntry: ImportHistoryEntry = {
    id: historyId,
    timestamp: new Date().toISOString(),
    importedBy: auth.currentUser?.email || "unknown",
    fileName,
    companies,
    newPOs: newPONumbers.length,
    newLines: newLineEntries.length,
    skippedExisting: parsed.poNumbers.length - newPONumbers.length,
    skippedNoPO: parsed.skippedNoPO,
    skippedBeforeDate: parsed.skippedBeforeDate,
  };
  await setDoc(doc(db, "importHistory", historyId), historyEntry);

  return {
    newPOs: newPONumbers.length,
    newLines: newLineEntries.length,
    skippedExisting: parsed.poNumbers.length - newPONumbers.length,
    skippedNoPO: parsed.skippedNoPO,
    skippedBeforeDate: parsed.skippedBeforeDate,
    vendorsUpserted: vendorEntries.length,
    itemsUpserted: itemEntries.length,
  };
}

/** Fetch the last `limitN` import-history entries, newest first. */
export async function fetchImportHistory(limitN = 30): Promise<ImportHistoryEntry[]> {
  const snap = await getDocs(query(collection(db, "importHistory"), orderBy("timestamp", "desc")));
  return snap.docs.slice(0, limitN).map((d) => d.data() as ImportHistoryEntry);
}

/** One unit-price observation for an item from a single PO line. */
export interface PricePoint {
  date: string;       // YYYY-MM-DD
  price: number;      // unit price (THB)
  qty: number;
  poNumber: string;
}

/**
 * Fetch unit-price history for one item, grouped by vendorCode, each list
 * sorted by date ascending. Only THB, non-Canceled lines with a real
 * unit price + date are kept (same filters as the item aggregation), so
 * the timeline matches the comparison numbers shown in the table.
 */
export async function fetchItemPriceHistory(itemNumber: string): Promise<Map<string, PricePoint[]>> {
  const snap = await getDocs(query(collection(db, "poLines"), where("itemNumber", "==", itemNumber)));
  const byVendor = new Map<string, PricePoint[]>();
  for (const d of snap.docs) {
    const l = d.data() as POLine;
    if (!countsAsSpend(l.status)) continue;
    if (l.currency && l.currency !== "THB") continue;
    if (!(l.unitPrice > 0) || !l.poDate) continue;
    const arr = byVendor.get(l.vendorCode) ?? [];
    arr.push({ date: l.poDate, price: l.unitPrice, qty: l.qty, poNumber: l.poNumber });
    byVendor.set(l.vendorCode, arr);
  }
  for (const arr of byVendor.values()) arr.sort((a, b) => (a.date < b.date ? -1 : 1));
  return byVendor;
}

/** Fetch all PO lines for one vendor (for the vendor PO drill-down). */
export async function fetchVendorPOLines(vendorCode: string): Promise<POLine[]> {
  const snap = await getDocs(collection(db, "poLines"));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<POLine, "id">) }))
    .filter((l) => l.vendorCode === vendorCode);
}
