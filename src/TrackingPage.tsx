import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import SyncStatus from "./components/SyncStatus";
import TrackingSummary, { StatCards, StatDefinitions } from "./TrackingSummary";
import { computeTrackingStats, isPlaceholderRow } from "./data/trackingStats";
import { subscribeTabs, getTabsSnapshot, getTabsError, subscribeRows, getRowsSnapshot, getSlimSnapshot } from "./data/trackingStore";
import { useTrackingRowsByTab } from "./data/useTrackingRows";
import * as XLSX from "xlsx";
import {
  IconX,
  IconFileSpreadsheet,
  IconFlag,
  IconFlagFilled,
  IconSearch,
  IconClipboardList,
  IconLayoutDashboard,
  IconChevronUp,
  IconChevronDown,
  IconChevronRight,
  IconSelector,
  IconExternalLink,
} from "@tabler/icons-react";

const MASTER_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1Ly5d83iQ2xLDHC0tyuBFNMtbC1ZQ9mB0Dnx1NH68pro/edit";

/* ============================================================
   Unified PR/PA/PO tracking schema — union of every column found
   across the 4 personal Excel trackers (PJAME / PWHITE / PKAE / PGAM),
   with duplicate headers (e.g. "PR No." vs "เลขที่เอกสาร PR") merged
   into a single field, and the working-day diff columns dropped per
   user decision (not needed). N/U was Urgent/Not-urgent — kept on as
   a manual highlight flag instead of a column.

   Data entry now happens in the master Google Sheet (one subsheet per
   person); this page only mirrors that data in real time for
   monitoring — see google-apps-script/ for the sync setup.
   ============================================================ */

export const STATUS_OPTIONS = [
  "Draft",
  "Pending PA Approval",
  "Pending PO Approval",
  "In Progress",
  "Completed",
  "Cancelled",
  "On Hold",
] as const;
type Status = (typeof STATUS_OPTIONS)[number];

export const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  Draft: { bg: "var(--surface-2)", fg: "var(--text-muted)" },
  "Pending PA Approval": { bg: "color-mix(in srgb, var(--warning) 16%, transparent)", fg: "var(--warning)" },
  "Pending PO Approval": { bg: "color-mix(in srgb, var(--warning) 16%, transparent)", fg: "var(--warning)" },
  "In Progress": { bg: "color-mix(in srgb, var(--info) 16%, transparent)", fg: "var(--info)" },
  Completed: { bg: "color-mix(in srgb, var(--success) 16%, transparent)", fg: "var(--success)" },
  Cancelled: { bg: "color-mix(in srgb, var(--danger) 14%, transparent)", fg: "var(--danger)" },
  "On Hold": { bg: "color-mix(in srgb, var(--accent) 16%, transparent)", fg: "var(--accent)" },
};

/* Legacy/Thai status text -> canonical STATUS_OPTIONS value, so old imported
   data (e.g. "รออนุมัติ PA", "OK") reads and filters the same as new rows. */
const STATUS_ALIASES: Record<string, Status> = {
  "draft": "Draft", "ร่าง": "Draft", "pa อนุมัติ": "Draft", "pa approved": "Draft",
  "รออนุมัติ pa": "Pending PA Approval", "pending pa approval": "Pending PA Approval", "pending pa": "Pending PA Approval",
  "รออนุมัติ po": "Pending PO Approval", "pending po approval": "Pending PO Approval", "pending po": "Pending PO Approval",
  "in progress": "In Progress", "กำลังดำเนินการ": "In Progress", "ดำเนินการ": "In Progress",
  "ok": "Completed", "completed": "Completed", "done": "Completed", "เสร็จ": "Completed", "เสร็จแล้ว": "Completed", "เรียบร้อย": "Completed",
  "cancelled": "Cancelled", "canceled": "Cancelled", "cancel": "Cancelled", "ยกเลิก": "Cancelled",
  "on hold": "On Hold", "hold": "On Hold", "พัก": "On Hold", "ระงับ": "On Hold",
};

export function normalizeStatus(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const trimmed = raw.trim();
  return STATUS_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** The fields the search box looks through. `q` must already be trimmed + lowercased. */
type Searchable = Pick<TrackingRow, "prNo" | "paNo" | "poNo" | "project" | "description" | "vendor" | "remark">;
function rowMatchesSearch(r: Searchable, q: string): boolean {
  if (!q) return true;
  return [r.prNo, r.paNo, r.poNo, r.project, r.description, r.vendor, r.remark]
    .some((v) => v?.toLowerCase().includes(q));
}

export interface TrackingRow {
  id: string;
  no?: number;
  company?: string;
  dept?: string;
  project?: string;
  description?: string;
  prNo?: string;
  prDate?: string;
  paNo?: string;
  paSubmittedDate?: string;
  paApprovedDate?: string;
  poNo?: string;
  poSubmittedDate?: string;
  poApprovedDate?: string;
  vendor?: string;
  vendorId?: string;
  compareSuppliers?: string[];
  qty?: number;
  unit?: string;
  unitPrice?: number;
  discount?: number;
  budget?: number;
  saveCost?: number;
  payment?: string;
  neededDate?: string;
  deliveredDate?: string;
  status?: Status | string;
  urgent?: boolean;
  remark?: string;
}

export interface Tab {
  id: string;
  name: string;
  order: number;
}

/* ============================================================
   Money / vat helpers — qty, unitPrice, discount drive the rest
   ============================================================ */
export function computeMoney(row: TrackingRow) {
  const qty = row.qty ?? 0;
  const unitPrice = row.unitPrice ?? 0;
  const discount = row.discount ?? 0;
  const subtotal = Math.max(0, qty * unitPrice - discount);
  const vat = subtotal * 0.07;
  const total = subtotal + vat;
  return { subtotal, vat, total };
}
export function baht(n: number) {
  return (n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

type SortKey = keyof TrackingRow | "subtotal" | "vat" | "total";

function sortValue(row: TrackingRow, key: SortKey): string | number {
  if (key === "subtotal" || key === "vat" || key === "total") return computeMoney(row)[key];
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.toLowerCase();
  return "";
}

const COLUMNS: { label: string; key?: SortKey }[] = [
  { label: "" },
  { label: "No.", key: "no" },
  { label: "Company", key: "company" },
  { label: "PR No.", key: "prNo" },
  { label: "Date PR", key: "prDate" },
  { label: "PA No.", key: "paNo" },
  { label: "Date PA Submitted", key: "paSubmittedDate" },
  { label: "Date PA Approved", key: "paApprovedDate" },
  { label: "PO No.", key: "poNo" },
  { label: "Date PO Submitted", key: "poSubmittedDate" },
  { label: "Date PO Approved", key: "poApprovedDate" },
  { label: "Project", key: "project" },
  { label: "Description", key: "description" },
  { label: "Vendor", key: "vendor" },
  { label: "Status", key: "status" },
  { label: "ทำรับ", key: "deliveredDate" },
  { label: "Remark", key: "remark" },
];

/* The web table is for monitoring, so quantity / VAT / totals are not shown.
   Excel export still includes them (inserted before Status, original order). */
const MONEY_COLUMNS: { label: string; key?: SortKey }[] = [
  { label: "Qty", key: "qty" },
  { label: "ก่อน VAT", key: "subtotal" },
  { label: "VAT 7%", key: "vat" },
  { label: "สุทธิ", key: "total" },
];
const EXPORT_COLUMNS = (() => {
  const i = COLUMNS.findIndex((c) => c.key === "status");
  return [...COLUMNS.slice(0, i), ...MONEY_COLUMNS, ...COLUMNS.slice(i)];
})();

/* First 4 columns (flag, No., Company, PR No.) stay pinned to the left while
   scrolling horizontally, so the row's identity is never lost off-screen. */
const STICKY_WIDTHS = [40, 60, 110, 170];
const stickyLeft = (i: number) => STICKY_WIDTHS.slice(0, i).reduce((a, b) => a + b, 0);

/* ============================================================
   Read-only row detail modal
   ============================================================ */
function RowDetailModal({ row, onClose }: { row: TrackingRow; onClose: () => void }) {
  const { subtotal, vat, total } = computeMoney(row);

  const field = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: "var(--fs-sm)", color: "var(--text)" }}>{value || "—"}</span>
    </div>
  );

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "var(--sp-4)",
      }}
    >
      <div
        style={{
          background: "var(--surface)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)",
          width: "min(760px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "var(--sp-5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-4)" }}>
          <h3 style={{ margin: 0, color: "var(--text-strong)" }}>รายละเอียด PR/PO {row.urgent && <span style={{ color: "var(--danger)", fontSize: "var(--fs-xs)" }}>● เร่งด่วน</span>}</h3>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)" }}>
            <IconX size={20} stroke={1.75} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "var(--sp-3)" }}>
          {field("Company", row.company)}
          {field("Dept", row.dept)}
          {field("Project", row.project)}
          {field("Description", row.description)}
          {field("PR No.", row.prNo)}
          {field("Date PR", row.prDate)}
          {field("PA No.", row.paNo)}
          {field("Date PA Submitted", row.paSubmittedDate)}
          {field("Date PA Approved", row.paApprovedDate)}
          {field("PO No.", row.poNo)}
          {field("Date PO Submitted", row.poSubmittedDate)}
          {field("Date PO Approved", row.poApprovedDate)}
          {field("Vendor", row.vendor)}
          {field("Vendor ID", row.vendorId)}
          {field("Qty", row.qty !== undefined ? `${row.qty}${row.unit ? ` ${row.unit}` : ""}` : "")}
          {field("ราคา/หน่วย", row.unitPrice !== undefined ? baht(row.unitPrice) : "")}
          {field("Dis.", row.discount !== undefined ? baht(row.discount) : "")}
          {field("Budget", row.budget !== undefined ? baht(row.budget) : "")}
          {field("รวม Save Cost", row.saveCost !== undefined ? baht(row.saveCost) : "")}
          {field("Payment", row.payment)}
          {field("วันต้องการสินค้า", row.neededDate)}
          {field("ทำรับ/ส่งมอบ", row.deliveredDate)}
          {field("Status", row.status)}
        </div>

        {row.compareSuppliers && row.compareSuppliers.length > 0 && (
          <div style={{ marginTop: "var(--sp-3)" }}>
            {field("Supplier เทียบราคา", row.compareSuppliers.join(", "))}
          </div>
        )}

        {row.remark && (
          <div style={{ marginTop: "var(--sp-3)" }}>
            {field("Remark", row.remark)}
          </div>
        )}

        <div
          style={{
            marginTop: "var(--sp-4)", padding: "var(--sp-3)", borderRadius: "var(--radius)",
            background: "var(--surface-2)", display: "flex", gap: "var(--sp-4)", fontSize: "var(--fs-sm)", flexWrap: "wrap",
          }}
        >
          <span>ก่อน VAT: <b>{baht(subtotal)}</b></span>
          <span>VAT 7%: <b>{baht(vat)}</b></span>
          <span>สุทธิ: <b>{baht(total)}</b></span>
          <span style={{ color: "var(--text-faint)" }}>(คำนวณอัตโนมัติจาก Qty × ราคา/หน่วย − Dis.)</span>
        </div>

        <div style={{ marginTop: "var(--sp-4)", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
          แก้ไขข้อมูลนี้ได้ที่ Google Sheet กลางเท่านั้น — หน้านี้แสดงผลแบบ real-time เพื่อ monitor อย่างเดียว
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--sp-4)" }}>
          <button type="button" onClick={onClose} style={secondaryBtnStyle}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

const secondaryBtnStyle: React.CSSProperties = {
  border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)",
  borderRadius: "var(--radius)", padding: "8px 16px", fontSize: "var(--fs-sm)", cursor: "pointer",
};

/* ============================================================
   Main page — read-only monitoring view. Data entry happens in the
   master Google Sheet; see google-apps-script/SETUP.md.
   ============================================================ */
export default function TrackingPage() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [rows, setRows] = useState<TrackingRow[]>([]);
  // Landing view is the team summary; a person's tab opens their own table.
  const [showSummary, setShowSummary] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewingRow, setViewingRow] = useState<TrackingRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("no");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  useEffect(() => {
    return subscribeTabs(() => {
      const err = getTabsError();
      setLoadError(err);
      if (err) return;
      const list = getTabsSnapshot();
      setTabs(list);
      setActiveTab((cur) => (cur && list.some((t) => t.id === cur) ? cur : list[0]?.id ?? null));
    });
  }, []);

  // Summary numbers come from the compact per-tab docs (see useTrackingRows).
  const rawRowsByTab = useTrackingRowsByTab(tabs);
  const rowsByTab = useMemo(() => {
    const out: Record<string, TrackingRow[]> = {};
    for (const id of Object.keys(rawRowsByTab)) out[id] = rawRowsByTab[id].map((r) => ({ ...r, status: normalizeStatus(r.status) }));
    return out;
  }, [rawRowsByTab]);

  // A person's full rows are only loaded once their tab is opened.
  useEffect(() => {
    if (!activeTab || showSummary) { setRows([]); return; }
    return subscribeRows(activeTab, () => {
      setRows(getRowsSnapshot(activeTab).map((r) => ({ ...r, status: normalizeStatus(r.status) })));
    });
  }, [activeTab, showSummary]);

  // Cross-tab search: if the searched number isn't in the current person's tab,
  // find the tab that DOES contain it and jump there automatically. Only runs
  // when the active tab has no local match (so normal browsing stays cheap),
  // debounced, and de-duped per search term to avoid repeat reads.
  const jumpedForRef = useRef<string>("");
  // Cache other tabs' rows once fetched, so repeated cross-tab searches reuse
  // them instead of re-reading whole collections from Firestore every time.
  const otherTabCache = useRef<Map<string, Searchable[]>>(new Map());
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (showSummary || !q || !activeTab || tabs.length <= 1) return;
    if (rows.some((r) => rowMatchesSearch(r, q))) { jumpedForRef.current = ""; return; }
    if (jumpedForRef.current === q) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      jumpedForRef.current = q;
      for (const t of tabs) {
        if (t.id === activeTab) continue;
        try {
          let tabRows: Searchable[] | undefined = getSlimSnapshot().rows[t.id] ?? otherTabCache.current.get(t.id);
          if (!tabRows) {
            const snap = await getDocs(collection(db, "trackingTabs", t.id, "rows"));
            if (cancelled) return;
            tabRows = snap.docs.map((d) => d.data() as Searchable);
            otherTabCache.current.set(t.id, tabRows);
          }
          if (tabRows.some((r) => rowMatchesSearch(r, q))) { setActiveTab(t.id); return; }
        } catch { /* ignore a failed tab, keep searching the rest */ }
      }
    }, 450);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, activeTab, rows, tabs, showSummary]);

  const exportToExcel = () => {
    if (!activeTab) return;
    const tabName = tabs.find((t) => t.id === activeTab)?.name ?? "tracking";
    const data = filteredRows.map((r) => {
      const { subtotal, vat, total } = computeMoney(r);
      const out: Record<string, unknown> = {};
      for (const { label, key } of EXPORT_COLUMNS) {
        if (!key || !label) continue;
        out[label] = key === "subtotal" ? subtotal : key === "vat" ? vat : key === "total" ? total : r[key];
      }
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wbOut = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbOut, ws, tabName.slice(0, 31));
    XLSX.writeFile(wbOut, `${tabName}-tracking.xlsx`);
  };

  const personStats = useMemo(() => computeTrackingStats(rows), [rows]);

  // Monitoring view: what is still open comes first; finished work (Completed /
  // Cancelled) sits below and is collapsed unless the user is looking for it
  // (searching, or filtering to a finished status). Reserved blank rows are not work.
  const isDone = (r: TrackingRow) => r.status === "Completed" || r.status === "Cancelled";
  const isSearchingDone = search.trim() !== "" || statusFilter === "Completed" || statusFilter === "Cancelled";

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (urgentOnly && !r.urgent) return false;
      return rowMatchesSearch(r, q);
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [rows, search, statusFilter, urgentOnly, sortKey, sortDir]);

  if (loadError) {
    return (
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "var(--sp-7) var(--sp-5)" }}>
        <div style={{
          color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)", borderRadius: "var(--radius)",
          padding: "var(--sp-4)", fontSize: "var(--fs-sm)",
        }}>
          โหลดข้อมูลไม่สำเร็จ: {loadError}
          <br />
          (ส่วนใหญ่เกิดจาก Firestore security rules ยังไม่อนุญาตให้อ่าน collection "trackingTabs")
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1440px", margin: "0 auto", padding: "var(--sp-7) var(--sp-5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--fs-xs)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent)", marginBottom: "var(--sp-2)" }}>
        <IconClipboardList size={16} stroke={1.75} />
        PR / PA / PO Tracking
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--sp-3)", marginBottom: "var(--sp-2)" }}>
        <h1 style={{ margin: 0, color: "var(--text-strong)" }}>Tracking Sheet</h1>
        <SyncStatus />
      </div>
      <p style={{ margin: "0 0 var(--sp-5)", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
        ข้อมูลแบบ real-time จาก Google Sheet กลาง — แก้ไขข้อมูลได้ที่ Sheet เท่านั้น หน้านี้สำหรับ monitor
      </p>

      {/* Tabs bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap", borderBottom: "1px solid var(--border)", marginBottom: "var(--sp-4)", paddingBottom: "var(--sp-2)" }}>
        {(() => {
          const pill = (active: boolean): React.CSSProperties => ({
            background: active ? "var(--accent-bg)" : "transparent",
            border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
            borderRadius: "var(--radius-full)", padding: "6px 14px",
            cursor: "pointer", fontSize: "var(--fs-sm)",
            color: active ? "var(--text-strong)" : "var(--text-muted)",
            fontWeight: active ? 700 : 500,
          });
          return (
            <>
              <button type="button" onClick={() => setShowSummary(true)}
                style={{ ...pill(showSummary), display: "inline-flex", alignItems: "center", gap: 6 }}>
                <IconLayoutDashboard size={15} stroke={1.75} /> ภาพรวมทีม
              </button>
              <span aria-hidden style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
              {tabs.map((tab) => (
                <button key={tab.id} type="button"
                  onClick={() => { setActiveTab(tab.id); setShowSummary(false); }}
                  style={pill(!showSummary && tab.id === activeTab)}>
                  {tab.name}
                </button>
              ))}
            </>
          );
        })()}
      </div>

      {showSummary && tabs.length > 0 ? (
        <TrackingSummary tabs={tabs} rowsByTab={rowsByTab}
          onOpenTab={(id) => { setActiveTab(id); setShowSummary(false); }} />
      ) : !activeTab ? (
        <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>ยังไม่มีแท็ปข้อมูล — เริ่มกรอกใน Google Sheet กลาง แท็ปจะปรากฏที่นี่อัตโนมัติ</div>
      ) : (
        <>
          {/* Performance of the selected person */}
          <div style={{ marginBottom: "var(--sp-4)" }}>
            <StatCards stats={personStats} />
            <StatDefinitions badDates={personStats.badDates} />
          </div>

          {/* Toolbar */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", alignItems: "center", marginBottom: "var(--sp-4)" }}>
            <div style={{ position: "relative" }}>
              <IconSearch size={15} stroke={1.75} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหา PR/PA/PO, project, vendor..."
                style={{ font: "inherit", fontSize: "var(--fs-xs)", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", padding: "8px 12px 8px 32px", width: 260 }}
              />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ font: "inherit", fontSize: "var(--fs-xs)", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", padding: "8px 10px" }}>
              <option value="">ทุกสถานะ</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", color: "var(--text-muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.target.checked)} />
              เฉพาะงานเร่งด่วน
            </label>
            <div style={{ flex: 1 }} />
            <a
              href={MASTER_SHEET_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...secondaryBtnStyle, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", color: "var(--primary)", borderColor: "var(--primary)" }}
            >
              <IconExternalLink size={15} stroke={1.75} /> แก้ไขใน Google Sheet
            </a>
            <button type="button" onClick={exportToExcel} style={{ ...secondaryBtnStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <IconFileSpreadsheet size={15} stroke={1.75} /> Export Excel
            </button>
          </div>

          {(() => {
            const visible = filteredRows.filter((r) => !isPlaceholderRow(r));
            const pendingList = visible.filter((r) => !isDone(r));
            const doneList = visible.filter(isDone);
            const doneOpen = showDone || isSearchingDone;

            const renderTable = (list: TrackingRow[], emptyText: string) => (
              <div style={{ overflow: "auto", maxHeight: "min(70vh, 760px)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-elevated)", textAlign: "left", color: "var(--text-muted)" }}>
                      {COLUMNS.map(({ label, key }, i) => {
                        const active = key && key === sortKey;
                        const sticky = i < STICKY_WIDTHS.length;
                        return (
                          <th
                            key={label || i}
                            onClick={key ? () => toggleSort(key) : undefined}
                            style={{
                              position: "sticky", top: 0, zIndex: sticky ? 3 : 1, padding: "10px 12px",
                              ...(sticky ? { left: stickyLeft(i), minWidth: STICKY_WIDTHS[i], width: STICKY_WIDTHS[i] } : {}),
                              borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)",
                              cursor: key ? "pointer" : "default", userSelect: "none",
                              color: active ? "var(--text-strong)" : "var(--text-muted)",
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                              {label}
                              {key && (
                                active ? (
                                  sortDir === "asc" ? <IconChevronUp size={12} stroke={2} /> : <IconChevronDown size={12} stroke={2} />
                                ) : (
                                  <IconSelector size={12} stroke={1.75} style={{ color: "var(--text-faint)" }} />
                                )
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const statusColor = r.status ? STATUS_COLOR[r.status] : undefined;
                      const rowBg = r.urgent ? "color-mix(in srgb, var(--danger) 8%, var(--surface))" : "var(--surface)";
                      const stickyTd = (i: number): React.CSSProperties =>
                        i < STICKY_WIDTHS.length
                          ? { position: "sticky", left: stickyLeft(i), zIndex: 1, background: rowBg }
                          : {};
                      return (
                        <tr
                          key={r.id}
                          style={{ borderBottom: "1px solid var(--border)", background: rowBg, cursor: "pointer" }}
                          onClick={() => setViewingRow(r)}
                        >
                          <td style={{ padding: "8px 12px", ...stickyTd(0) }}>
                            {r.urgent ? <IconFlagFilled size={14} stroke={1.75} style={{ color: "var(--danger)" }} /> : <IconFlag size={14} stroke={1.75} style={{ color: "var(--text-faint)" }} />}
                          </td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)", ...stickyTd(1) }}>{r.no}</td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)", ...stickyTd(2) }}>{r.company}</td>
                          <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-strong)", ...stickyTd(3) }}>{r.prNo}</td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.prDate}</td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.paNo}</td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.paSubmittedDate}</td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.paApprovedDate}</td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.poNo}</td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.poSubmittedDate}</td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.poApprovedDate}</td>
                          <td style={{ padding: "8px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{r.project}</td>
                          <td style={{ padding: "8px 12px", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>{r.description}</td>
                          <td style={{ padding: "8px 12px" }}>{r.vendor}</td>
                          <td style={{ padding: "8px 12px" }}>
                            {r.status && (
                              <span style={{ background: statusColor?.bg, color: statusColor?.fg, borderRadius: "var(--radius-full)", padding: "2px 9px", fontSize: "10.5px", fontWeight: 700 }}>
                                {r.status}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>{r.deliveredDate}</td>
                          <td style={{ padding: "8px 12px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-muted)" }}>{r.remark}</td>
                        </tr>
                      );
                    })}
                    {list.length === 0 && (
                      <tr>
                        <td colSpan={COLUMNS.length} style={{ padding: "var(--sp-5)", textAlign: "center", color: "var(--text-faint)" }}>
                          {emptyText}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );

            return (
              <>
                <h2 style={{ margin: "0 0 var(--sp-2)", fontSize: "1.05rem", color: "var(--text-strong)" }}>
                  ที่ยังค้างอยู่ <span style={{ color: "var(--warning)" }}>({pendingList.length.toLocaleString()})</span>
                </h2>
                {renderTable(pendingList, "ไม่มีรายการที่ค้างอยู่")}

                <div style={{ marginTop: "var(--sp-5)" }}>
                  <button
                    type="button"
                    onClick={() => setShowDone((v) => !v)}
                    disabled={isSearchingDone}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, margin: "0 0 var(--sp-2)", font: "inherit", fontSize: "1.05rem", fontWeight: 700, color: "var(--text-strong)", cursor: isSearchingDone ? "default" : "pointer" }}
                  >
                    {doneOpen ? <IconChevronDown size={18} stroke={2} /> : <IconChevronRight size={18} stroke={2} />}
                    เสร็จสิ้นแล้ว (Completed / Cancelled) <span style={{ color: "var(--text-faint)" }}>({doneList.length.toLocaleString()})</span>
                    {!doneOpen && <span style={{ fontSize: "var(--fs-xs)", fontWeight: 400, color: "var(--text-faint)" }}>— กดเพื่อดู</span>}
                  </button>
                  {doneOpen && renderTable(doneList, "ไม่มีรายการที่เสร็จสิ้น")}
                </div>
              </>
            );
          })()}
        </>
      )}

      {viewingRow && <RowDetailModal row={viewingRow} onClose={() => setViewingRow(null)} />}
    </div>
  );
}
