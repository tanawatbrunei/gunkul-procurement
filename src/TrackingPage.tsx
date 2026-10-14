import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import SyncStatus from "./components/SyncStatus";
import { StatCards, StatDefinitions } from "./TrackingSummary";
import {
  computeTrackingStats, isPlaceholderRow, computeStageBreakdown,
  getStageProgress, agingBand, isLikelyPoNumber, STAGE_LABELS,
} from "./data/trackingStats";
import type { StageIndex } from "./data/trackingStats";
import { subscribeTabs, getTabsSnapshot, getTabsError, subscribeRows, getRowsSnapshot, getSlimSnapshot } from "./data/trackingStore";
import * as XLSX from "xlsx";
import {
  IconX,
  IconFileSpreadsheet,
  IconFlag,
  IconFlagFilled,
  IconSearch,
  IconClipboardList,
  IconChevronUp,
  IconChevronDown,
  IconChevronRight,
  IconSelector,
  IconExternalLink,
  IconAlertTriangle,
  IconUser,
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
  // Free-text values found in the live Sheet (each affects only a handful of rows).
  "cancel pr": "Cancelled",
  "draft pa": "Draft", "draft po": "Draft", "ทำ pa ได้เลย": "Draft",
  "pending add vendor": "Draft", "รอ add vendor": "Draft", "ขอใบเสนอราคา": "Draft", "รอใบเสนอราคา": "Draft",
  "pa approval": "Pending PA Approval",
  "wait shipment": "In Progress", "wait payment": "In Progress",
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
  /** "Note3" in the Sheet — a per-row overdue/on-time flag some tabs compute
   *  with their own formula, e.g. "🟢 ทันกำหนด", "🔴 เกินกำหนด PR-PO (>5 วัน)",
   *  "⚪ ยกเลิก". Not every tab has it yet — see data/trackingStatusNote.ts. */
  trackingStatus?: string;
  /** Client-only, not from Firestore: which person's tab this row came from,
   *  tagged in TrackingOverview so a team-wide ("ทุกคน") drill-down list can
   *  show who each row belongs to. */
  personName?: string;
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

type SortKey = keyof TrackingRow | "subtotal" | "vat" | "total" | "stageIndex" | "daysInStage" | "totalDuration";

/* Quick bottleneck-focused filters, shown as chips next to "เฉพาะงานเร่งด่วน".
   Each maps to a stage of the funnel (or the overdue-SLA cross-cut) rather
   than the raw `status` text, so it lines up with the new Stage & Progress
   column regardless of which legacy status string a row has. */
type QuickFilter = "all" | "paQuote" | "paApproval" | "poIssuance" | "bottleneck";
const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "paQuote", label: "รอราคา PA" },
  { key: "paApproval", label: "รออนุมัติ PA" },
  { key: "poIssuance", label: "รอออก PO" },
  { key: "bottleneck", label: "เกิน SLA" },
];
function matchesQuickFilter(r: TrackingRow, f: QuickFilter): boolean {
  if (f === "all") return true;
  const p = getStageProgress(r);
  if (f === "paQuote") return p.stage === 1;
  if (f === "paApproval") return p.stage === 2;
  if (f === "poIssuance") return p.stage === 3;
  if (f === "bottleneck") return p.stage >= 0 && p.stage < 4 && (p.daysInStage ?? 0) > 3;
  return true;
}

function sortValue(row: TrackingRow, key: SortKey): string | number {
  if (key === "subtotal" || key === "vat" || key === "total") return computeMoney(row)[key];
  if (key === "stageIndex" || key === "daysInStage" || key === "totalDuration") {
    const p = getStageProgress(row);
    if (key === "stageIndex") return p.stage;
    return (key === "daysInStage" ? p.daysInStage : p.totalDuration) ?? -1;
  }
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.toLowerCase();
  return "";
}

/* Display columns, grouped under a header row (identity | Duration | PR Info |
   PA Info | PO Info | Detail) to keep the table narrow: the PA/PO number and
   its submitted/approved dates share one stacked cell instead of 3 columns. */
type Col = { label: string; key?: SortKey; group: string };
const COLUMNS: Col[] = [
  { label: "No.", key: "no", group: "" },
  { label: "Company", key: "company", group: "" },
  { label: "PR No.", key: "prNo", group: "" },
  { label: "Stage & Progress", key: "stageIndex", group: "" },
  { label: "Days in Stage", key: "daysInStage", group: "Duration" },
  { label: "Total", key: "totalDuration", group: "Duration" },
  { label: "Date PR", key: "prDate", group: "PR Info" },
  { label: "PA No. · ส่ง → อนุมัติ", key: "paSubmittedDate", group: "PA Info" },
  { label: "PO No. · ส่ง → อนุมัติ", key: "poSubmittedDate", group: "PO Info" },
  { label: "Project", key: "project", group: "Detail" },
  { label: "Description", key: "description", group: "Detail" },
  { label: "Vendor", key: "vendor", group: "Detail" },
  { label: "Status", key: "status", group: "Detail" },
  { label: "ทำรับ", key: "deliveredDate", group: "Detail" },
  { label: "Remark", key: "remark", group: "Detail" },
];
/** Header group spans, in column order (consecutive columns sharing a group). */
const COLUMN_GROUPS = COLUMNS.reduce<{ group: string; span: number }[]>((acc, c) => {
  const last = acc[acc.length - 1];
  if (last && last.group === c.group) last.span++; else acc.push({ group: c.group, span: 1 });
  return acc;
}, []);

/* Excel export keeps the original flat layout (every date in its own column,
   money columns included) — independent of the grouped on-screen table. */
const EXPORT_COLUMNS: { label: string; key: SortKey }[] = [
  { label: "No.", key: "no" }, { label: "Company", key: "company" }, { label: "PR No.", key: "prNo" },
  { label: "Date PR", key: "prDate" }, { label: "PA No.", key: "paNo" },
  { label: "Date PA Submitted", key: "paSubmittedDate" }, { label: "Date PA Approved", key: "paApprovedDate" },
  { label: "PO No.", key: "poNo" }, { label: "Date PO Submitted", key: "poSubmittedDate" }, { label: "Date PO Approved", key: "poApprovedDate" },
  { label: "Project", key: "project" }, { label: "Description", key: "description" }, { label: "Vendor", key: "vendor" },
  { label: "Qty", key: "qty" }, { label: "ก่อน VAT", key: "subtotal" }, { label: "VAT 7%", key: "vat" }, { label: "สุทธิ", key: "total" },
  { label: "Status", key: "status" }, { label: "ทำรับ", key: "deliveredDate" }, { label: "Remark", key: "remark" },
];

/* First 4 columns (No. — with the urgent flag folded in, Company, PR No.,
   Stage & Progress) stay pinned to the left while scrolling horizontally, so
   the row's identity and current bottleneck stage are never lost off-screen. */
const STICKY_WIDTHS = [70, 110, 170, 170];
const stickyLeft = (i: number) => STICKY_WIDTHS.slice(0, i).reduce((a, b) => a + b, 0);
const GROUP_ROW_H = 26;

/** ISO date -> DD/MM for the compact stacked date lines (full date in tooltips). */
const fmtShort = (d?: string) => {
  const m = d && /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}` : d || "—";
};

const STAGE_DOT_COLOR: Record<StageIndex, string> = {
  [-1]: "var(--text-faint)", 0: "var(--text-faint)", 1: "var(--warning)",
  2: "var(--warning)", 3: "var(--info)", 4: "var(--success)",
};

/** Mini 5-node stepper + label, used in both the table's sticky "Stage &
 *  Progress" column and the row detail drawer's timeline. */
function StageStepper({ stage, compact }: { stage: StageIndex; compact?: boolean }) {
  if (stage === -1) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "10.5px", fontWeight: 700, color: "var(--text-faint)" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-faint)" }} /> Cancelled
      </span>
    );
  }
  if (compact) {
    // 3-node [PR] -> [PA] -> [PO]: PR covers review+bidding (stages 0-1), PA the
    // approval (2), PO the issuance (3); Completed turns all three green.
    const cur = stage <= 1 ? 0 : stage === 2 ? 1 : stage === 3 ? 2 : 3;
    return (
      <span title={STAGE_LABELS[stage]} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {["PR", "PA", "PO"].map((n, i) => {
          const done = i < cur;
          const current = i === cur;
          const color = done ? "var(--success)" : current ? STAGE_DOT_COLOR[stage] : "var(--text-faint)";
          return (
            <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span style={{
                minWidth: 26, textAlign: "center", fontSize: "10px", fontWeight: 700, borderRadius: "var(--radius-full)", padding: "1px 6px",
                color: current ? "#fff" : color,
                background: current ? color : done ? "color-mix(in srgb, var(--success) 14%, transparent)" : "transparent",
                border: `1px solid ${current || done ? color : "var(--border)"}`,
                boxShadow: current ? `0 0 0 2px color-mix(in srgb, ${color} 25%, transparent)` : undefined,
              }}>{done ? "✓ " : ""}{n}</span>
              {i < 2 && <span style={{ width: 8, height: 2, background: done ? "var(--success)" : "var(--border)" }} />}
            </span>
          );
        })}
      </span>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {STAGE_LABELS.map((label, i) => {
        const done = i < stage;
        const current = i === stage;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < STAGE_LABELS.length - 1 ? 1 : undefined }}>
            <div title={label} style={{
              width: current ? 10 : 8, height: current ? 10 : 8, borderRadius: "50%", flexShrink: 0,
              background: done ? "var(--success)" : current ? STAGE_DOT_COLOR[stage] : "var(--border-strong)",
              boxShadow: current ? `0 0 0 3px color-mix(in srgb, ${STAGE_DOT_COLOR[stage]} 25%, transparent)` : undefined,
            }} />
            {i < STAGE_LABELS.length - 1 && (
              <div style={{ flex: 1, height: 2, minWidth: 10, background: done ? "var(--success)" : "var(--border)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Read-only row detail — right-side slide-over drawer with the full
   timeline log, date stamps, and the responsible buyer (the tab owner).
   ============================================================ */
function RowDetailModal({ row, buyerName, onClose }: { row: TrackingRow; buyerName?: string; onClose: () => void }) {
  const { subtotal, vat, total } = computeMoney(row);
  const progress = getStageProgress(row);

  const field = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: "var(--fs-sm)", color: "var(--text)" }}>{value || "—"}</span>
    </div>
  );

  const TIMELINE: { label: string; date?: string; no?: string }[] = [
    { label: "PR สร้าง", date: row.prDate, no: row.prNo },
    { label: "PA ส่งเสนอ", date: row.paSubmittedDate, no: row.paNo },
    { label: "PA อนุมัติ", date: row.paApprovedDate },
    { label: "PO ส่งเสนอ", date: row.poSubmittedDate, no: row.poNo },
    { label: "PO อนุมัติ", date: row.poApprovedDate },
  ];

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        zIndex: 100, animation: "trackingDrawerFade 0.15s ease",
      }}
    >
      <style>{`
        @keyframes trackingDrawerFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes trackingDrawerSlide { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
      <div
        style={{
          position: "absolute", top: 0, right: 0, height: "100%", width: "min(440px, 100%)",
          background: "var(--surface)", boxShadow: "var(--shadow-lg)", overflowY: "auto", padding: "var(--sp-5)",
          animation: "trackingDrawerSlide 0.2s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--sp-3)" }}>
          <div>
            <h3 style={{ margin: 0, color: "var(--text-strong)" }}>{row.prNo || "รายละเอียด PR/PO"}</h3>
            {row.urgent && <span style={{ color: "var(--danger)", fontSize: "var(--fs-xs)", fontWeight: 700 }}>● เร่งด่วน</span>}
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)" }}>
            <IconX size={20} stroke={1.75} />
          </button>
        </div>

        {buyerName && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-4)" }}>
            <IconUser size={13} stroke={1.75} /> ผู้รับผิดชอบ: <strong style={{ color: "var(--text)" }}>{buyerName}</strong>
          </div>
        )}

        {/* Current stage + progress */}
        <div style={{ background: "var(--surface-2)", borderRadius: "var(--radius)", padding: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
          <StageStepper stage={progress.stage} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--sp-2)", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
            <span>สถานะปัจจุบัน: <strong style={{ color: "var(--text)" }}>{progress.label}</strong></span>
            {progress.daysInStage !== null && <span>ค้างในสถานะนี้ {progress.daysInStage} วัน</span>}
          </div>
          {progress.totalDuration !== null && (
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: 2 }}>รวมตั้งแต่ PR: {progress.totalDuration} วัน</div>
          )}
        </div>

        {/* Timeline log */}
        <div style={{ marginBottom: "var(--sp-4)" }}>
          <p style={{ margin: "0 0 var(--sp-2)", fontSize: "var(--fs-xs)", fontWeight: 700, color: "var(--text-muted)" }}>Timeline</p>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {TIMELINE.map((t, i) => {
              const done = !!t.date;
              return (
                <div key={t.label} style={{ display: "flex", gap: "var(--sp-3)" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      width: 9, height: 9, borderRadius: "50%", flexShrink: 0, marginTop: 3,
                      background: done ? "var(--success)" : "var(--border-strong)",
                    }} />
                    {i < TIMELINE.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 22, background: "var(--border)" }} />}
                  </div>
                  <div style={{ paddingBottom: "var(--sp-3)" }}>
                    <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: done ? "var(--text)" : "var(--text-faint)" }}>{t.label}</div>
                    <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                      {t.date || "ยังไม่ถึง"} {t.no && <span style={{ color: "var(--text-faint)" }}>· {t.no}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "var(--sp-3)" }}>
          {field("Company", row.company)}
          {field("Dept", row.dept)}
          {field("Project", row.project)}
          {field("Description", row.description)}
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
            background: "var(--surface-2)", display: "flex", gap: "var(--sp-3)", fontSize: "var(--fs-sm)", flexWrap: "wrap",
          }}
        >
          <span>ก่อน VAT: <b>{baht(subtotal)}</b></span>
          <span>VAT 7%: <b>{baht(vat)}</b></span>
          <span>สุทธิ: <b>{baht(total)}</b></span>
        </div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: 4 }}>(คำนวณอัตโนมัติจาก Qty × ราคา/หน่วย − Dis.)</div>

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
  const [showDone, setShowDone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewingRow, setViewingRow] = useState<TrackingRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
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

  // A person's full rows load once their tab is selected (always exactly one
  // tab active now — the old team-overview landing view moved to the Summary
  // tab in Tracking & Dashboard, which already covers it with the real KPIs).
  useEffect(() => {
    if (!activeTab) { setRows([]); return; }
    return subscribeRows(activeTab, () => {
      setRows(getRowsSnapshot(activeTab).map((r) => ({ ...r, status: normalizeStatus(r.status) })));
    });
  }, [activeTab]);

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
    if (!q || !activeTab || tabs.length <= 1) return;
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
  }, [search, activeTab, rows, tabs]);

  const exportToExcel = () => {
    if (!activeTab) return;
    const tabName = tabs.find((t) => t.id === activeTab)?.name ?? "tracking";
    const data = filteredRows.map((r) => {
      const { subtotal, vat, total } = computeMoney(r);
      const out: Record<string, unknown> = {};
      for (const { label, key } of EXPORT_COLUMNS) {
        if (!key || !label) continue;
        if (key === "subtotal") { out[label] = subtotal; continue; }
        if (key === "vat") { out[label] = vat; continue; }
        if (key === "total") { out[label] = total; continue; }
        if (key === "stageIndex" || key === "daysInStage" || key === "totalDuration") continue; // excluded from EXPORT_COLUMNS, guard only for TS
        out[label] = r[key];
      }
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wbOut = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbOut, ws, tabName.slice(0, 31));
    XLSX.writeFile(wbOut, `${tabName}-tracking.xlsx`);
  };

  const personStats = useMemo(() => computeTrackingStats(rows), [rows]);
  const stageStats = useMemo(() => computeStageBreakdown(rows), [rows]);

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
      if (!matchesQuickFilter(r, quickFilter)) return false;
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
  }, [rows, search, statusFilter, urgentOnly, quickFilter, sortKey, sortDir]);

  // Counter badges on the quick-filter chips: how many ACTIVE rows each chip would show,
  // given the search / status / urgent filters (but not the chip selection itself).
  const quickCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = rows.filter((r) =>
      !isPlaceholderRow(r) && !isDone(r) && (!statusFilter || r.status === statusFilter) && (!urgentOnly || r.urgent) && rowMatchesSearch(r, q));
    const out = {} as Record<QuickFilter, number>;
    for (const f of QUICK_FILTERS) out[f.key] = base.filter((r) => matchesQuickFilter(r, f.key)).length;
    return out;
  }, [rows, search, statusFilter, urgentOnly]); // eslint-disable-line react-hooks/exhaustive-deps

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
          return tabs.map((tab) => (
            <button key={tab.id} type="button"
              onClick={() => setActiveTab(tab.id)}
              style={pill(tab.id === activeTab)}>
              {tab.name}
            </button>
          ));
        })()}
      </div>

      {!activeTab ? (
        <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>ยังไม่มีแท็ปข้อมูล — เริ่มกรอกใน Google Sheet กลาง แท็ปจะปรากฏที่นี่อัตโนมัติ</div>
      ) : (
        <>
          {/* Performance of the selected person */}
          <div style={{ marginBottom: "var(--sp-4)" }}>
            <StatCards stats={personStats} stageStats={stageStats} />
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

          {/* Quick bottleneck filters */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "var(--sp-4)" }}>
            {QUICK_FILTERS.map((f) => {
              const active = quickFilter === f.key;
              const isBottleneck = f.key === "bottleneck";
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setQuickFilter(f.key)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    border: `1px solid ${active ? (isBottleneck ? "var(--danger)" : "var(--accent)") : "var(--border)"}`,
                    background: active ? (isBottleneck ? "color-mix(in srgb, var(--danger) 14%, transparent)" : "var(--accent-bg)") : "transparent",
                    color: active ? (isBottleneck ? "var(--danger)" : "var(--text-strong)") : "var(--text-muted)",
                    borderRadius: "var(--radius-full)", padding: "5px 12px", fontSize: "var(--fs-xs)",
                    fontWeight: active ? 700 : 500, cursor: "pointer",
                  }}
                >
                  {isBottleneck && <IconAlertTriangle size={12} stroke={2} />}
                  {f.label}
                  <span style={{
                    minWidth: 18, textAlign: "center", fontSize: "10px", fontWeight: 700, borderRadius: "var(--radius-full)", padding: "0 6px",
                    background: isBottleneck && quickCounts[f.key] > 0 ? "var(--danger)" : "var(--surface-2)",
                    color: isBottleneck && quickCounts[f.key] > 0 ? "#fff" : "var(--text-muted)",
                  }}>{quickCounts[f.key].toLocaleString()}</span>
                </button>
              );
            })}
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
                    <tr>
                      {COLUMN_GROUPS.map(({ group, span }, gi) => (
                        <th
                          key={gi}
                          colSpan={span}
                          style={{
                            position: "sticky", top: 0, zIndex: gi === 0 ? 4 : 2, height: GROUP_ROW_H, boxSizing: "border-box",
                            ...(gi === 0 ? { left: 0 } : {}),
                            padding: "0 12px", background: "var(--bg-elevated)", color: "var(--text-faint)",
                            fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "left",
                            borderLeft: gi === 0 ? undefined : "1px solid var(--border)",
                          }}
                        >{group}</th>
                      ))}
                    </tr>
                    <tr style={{ background: "var(--bg-elevated)", textAlign: "left", color: "var(--text-muted)" }}>
                      {COLUMNS.map(({ label, key, group }, i) => {
                        const active = key && key === sortKey;
                        const sticky = i < STICKY_WIDTHS.length;
                        const right = key === "daysInStage" || key === "totalDuration";
                        const groupStart = i > 0 && COLUMNS[i - 1].group !== group;
                        return (
                          <th
                            key={label || i}
                            onClick={key ? () => toggleSort(key) : undefined}
                            style={{
                              position: "sticky", top: GROUP_ROW_H, zIndex: sticky ? 3 : 1, padding: "8px 12px",
                              ...(sticky ? { left: stickyLeft(i), minWidth: STICKY_WIDTHS[i], width: STICKY_WIDTHS[i] } : {}),
                              borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)",
                              borderLeft: groupStart ? "1px solid var(--border)" : undefined,
                              cursor: key ? "pointer" : "default", userSelect: "none",
                              color: active ? "var(--text-strong)" : "var(--text-muted)",
                              textAlign: right ? "right" : "left",
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flexDirection: right ? "row-reverse" : "row" }}>
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
                      const progress = getStageProgress(r);
                      const band = agingBand(progress.daysInStage);
                      const agingColor = band === "red" ? "var(--danger)" : band === "amber" ? "var(--warning)" : band === "green" ? "var(--success)" : "var(--text-faint)";
                      const poLooksReal = isLikelyPoNumber(r.poNo);
                      return (
                        <tr
                          key={r.id}
                          style={{ borderBottom: "1px solid var(--border)", background: rowBg, cursor: "pointer" }}
                          onClick={() => setViewingRow(r)}
                        >
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)", ...stickyTd(0) }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              {r.urgent
                                ? <IconFlagFilled size={12} stroke={1.75} style={{ color: "var(--danger)", flexShrink: 0 }} />
                                : <IconFlag size={12} stroke={1.75} style={{ color: "var(--text-faint)", flexShrink: 0 }} />}
                              {r.no}
                            </span>
                          </td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)", ...stickyTd(1) }}>{r.company}</td>
                          <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-strong)", ...stickyTd(2) }}>{r.prNo}</td>
                          <td style={{ padding: "8px 12px", ...stickyTd(3) }}><StageStepper stage={progress.stage} compact /></td>
                          <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", borderLeft: "1px solid var(--border)" }}>
                            {progress.daysInStage === null ? "—" : (
                              <span
                                title={band === "red" ? "เกิน SLA 3 วัน — Bottleneck" : band === "amber" ? "ใกล้เกิน SLA (3 วัน)" : "ปกติ"}
                                style={{
                                  display: "inline-block", minWidth: 34, textAlign: "center", fontWeight: 700, fontSize: "10.5px",
                                  borderRadius: "var(--radius-full)", padding: "2px 8px", color: agingColor,
                                  background: `color-mix(in srgb, ${agingColor} 15%, transparent)`,
                                }}
                              >{progress.daysInStage}d</span>
                            )}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>
                            {progress.totalDuration === null ? "—" : `${progress.totalDuration}d`}
                          </td>
                          <td style={{ padding: "8px 12px", color: "var(--text-muted)", borderLeft: "1px solid var(--border)" }}>{r.prDate}</td>
                          <td style={{ padding: "6px 12px", color: "var(--text-muted)", borderLeft: "1px solid var(--border)" }}>
                            <div>{r.paNo || "—"}</div>
                            <div title={`ส่ง ${r.paSubmittedDate || "-"} · อนุมัติ ${r.paApprovedDate || "-"}`}
                              style={{ fontSize: "10px", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                              {fmtShort(r.paSubmittedDate)} → {fmtShort(r.paApprovedDate)}
                            </div>
                          </td>
                          <td style={{ padding: "6px 12px", color: "var(--text-muted)", borderLeft: "1px solid var(--border)" }}>
                            <div>
                              {!r.poNo ? "—" : poLooksReal ? r.poNo : (
                                <span title={r.poNo} style={{
                                  display: "inline-flex", alignItems: "center", gap: 4, maxWidth: 160,
                                  background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)",
                                  borderRadius: "var(--radius-full)", padding: "2px 9px", fontSize: "10.5px", fontWeight: 700,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  <IconAlertTriangle size={11} stroke={2} style={{ flexShrink: 0 }} /> {r.poNo}
                                </span>
                              )}
                            </div>
                            <div title={`ส่ง ${r.poSubmittedDate || "-"} · อนุมัติ ${r.poApprovedDate || "-"}`}
                              style={{ fontSize: "10px", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                              {fmtShort(r.poSubmittedDate)} → {fmtShort(r.poApprovedDate)}
                            </div>
                          </td>
                          <td style={{ padding: "8px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", borderLeft: "1px solid var(--border)" }}>{r.project}</td>
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

      {viewingRow && (
        <RowDetailModal
          row={viewingRow}
          buyerName={tabs.find((t) => t.id === activeTab)?.name}
          onClose={() => setViewingRow(null)}
        />
      )}
    </div>
  );
}
