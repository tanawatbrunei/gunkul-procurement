import type { TrackingRow } from "../TrackingPage";
import { plausibleDate, daysBetween, isPlaceholderRow } from "./trackingStats";

/* Bottleneck views for the Summary tab: where does work slow down, and which
   projects / vendors carry the overdue items. Pure functions over tracking rows. */

/** Pipeline stages, in order. Also drives the team-wide cycle-time chart. */
export const CYCLE_STAGES: { label: string; short: string; from: keyof TrackingRow; to: keyof TrackingRow }[] = [
  { label: "ได้รับ PR → เปิด PA", short: "PR→PA", from: "prDate", to: "paSubmittedDate" },
  { label: "เปิด PA → อนุมัติ PA", short: "อนุมัติ PA", from: "paSubmittedDate", to: "paApprovedDate" },
  { label: "อนุมัติ PA → เปิด PO", short: "PA→PO", from: "paApprovedDate", to: "poSubmittedDate" },
  { label: "เปิด PO → อนุมัติ PO", short: "อนุมัติ PO", from: "poSubmittedDate", to: "poApprovedDate" },
];

/** A stage median needs at least this many rows in the project to be shown. */
export const MIN_STAGE_SAMPLE = 3;
export const NO_LABEL = "ไม่ระบุ";

const isClosed = (r: TrackingRow) => r.status === "Completed" || r.status === "Cancelled";
const round1 = (n: number) => Math.round(n * 10) / 10;
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const clean = (s: string | undefined) => s?.replace(/\s+/g, " ").trim() ?? "";

/** Placeholder values people type into a name cell when they mean "blank". */
const JUNK_NAMES = new Set(["0", "-", "--", "n/a", "na", "null", "none", "tbd"]);

/** Group key for free-text names ("Project A " and "project a" are one project;
 *  placeholders like "0" or "-" count as no name). */
export function nameKey(s: string | undefined): string | null {
  const t = clean(s).toLowerCase();
  return t && !JUNK_NAMES.has(t) ? t : null;
}

/** Groups rows by a name field, remembering the most common spelling for display. */
export function groupBy(rows: TrackingRow[], field: "project" | "vendor") {
  const groups = new Map<string, { rows: TrackingRow[]; spellings: Map<string, number> }>();
  let unnamed = 0;
  for (const r of rows) {
    const k = nameKey(r[field]);
    if (!k) { unnamed++; continue; }
    let g = groups.get(k);
    if (!g) { g = { rows: [], spellings: new Map() }; groups.set(k, g); }
    g.rows.push(r);
    const sp = clean(r[field]);
    g.spellings.set(sp, (g.spellings.get(sp) ?? 0) + 1);
  }
  const display = (g: { spellings: Map<string, number> }) => [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { groups, unnamed, display };
}

// ------------------------------------------------------------------
// Lead time per project (median days per pipeline stage)
// ------------------------------------------------------------------
export interface ProjectLeadTime {
  name: string;
  rows: number;
  /** Median days per stage, null when fewer than MIN_STAGE_SAMPLE rows have both dates. */
  stages: { median: number | null; n: number }[];
  /** Sum of the shown stage medians — a rough end-to-end figure. */
  total: number;
  /** Index of the slowest stage, or null if no stage is measurable. */
  slowest: number | null;
}
export interface LeadTimeResult {
  projects: ProjectLeadTime[];
  totalProjects: number;
  /** Rows with no Project (not in any group) and their share of all rows. */
  noProject: number;
  noProjectShare: number;
}

export function computeLeadTimeByProject(allRows: TrackingRow[], today: Date = new Date(), topN = 10): LeadTimeResult {
  const rows = allRows.filter((r) => !isPlaceholderRow(r) && r.status !== "Cancelled");
  const { groups, unnamed, display } = groupBy(rows, "project");
  const out: ProjectLeadTime[] = [];
  for (const [, g] of groups) {
    const stages = CYCLE_STAGES.map(({ from, to }) => {
      const ds: number[] = [];
      for (const r of g.rows) {
        const a = plausibleDate(r[from] as string | undefined, today);
        const b = plausibleDate(r[to] as string | undefined, today);
        if (!a || !b) continue;
        const d = daysBetween(a, b);
        if (d >= 0 && d <= 365) ds.push(d);
      }
      return { median: ds.length >= MIN_STAGE_SAMPLE ? round1(median(ds)!) : null, n: ds.length };
    });
    const measurable = stages.filter((s) => s.median !== null);
    if (!measurable.length) continue;
    let slowest: number | null = null;
    stages.forEach((s, i) => { if (s.median !== null && (slowest === null || s.median > stages[slowest].median!)) slowest = i; });
    out.push({ name: display(g), rows: g.rows.length, stages, total: round1(measurable.reduce((s, x) => s + x.median!, 0)), slowest });
  }
  out.sort((a, b) => b.rows - a.rows);
  return { projects: out.slice(0, topN), totalProjects: out.length, noProject: unnamed, noProjectShare: rows.length ? unnamed / rows.length : 0 };
}

// ------------------------------------------------------------------
// Pending PR -> PO aging per project
// ------------------------------------------------------------------
export interface ProjectPending {
  name: string;
  pending: number;
  /** Median age (days since Date PR) among pending rows that have a usable PR date. */
  medianAge: number | null;
  over30: number;
  unknownAge: number;
}
export interface PendingByProjectResult {
  projects: ProjectPending[];
  totalProjects: number;
  /** Pending rows with no Project. */
  noProject: number;
  totalPending: number;
}
export function computePendingByProject(allRows: TrackingRow[], today: Date = new Date(), topN = 10): PendingByProjectResult {
  const pending = allRows.filter((r) => !isPlaceholderRow(r) && !isClosed(r) && !!r.prNo?.trim() && !r.poNo?.trim());
  const { groups, unnamed, display } = groupBy(pending, "project");
  const out: ProjectPending[] = [];
  for (const [, g] of groups) {
    const ages: number[] = [];
    for (const r of g.rows) {
      const d = plausibleDate(r.prDate, today);
      if (!d) continue;
      const a = daysBetween(d, today);
      if (a >= 0) ages.push(a);
    }
    const m = median(ages);
    out.push({
      name: display(g), pending: g.rows.length, medianAge: m === null ? null : round1(m),
      over30: ages.filter((a) => a > 30).length, unknownAge: g.rows.length - ages.length,
    });
  }
  out.sort((a, b) => b.pending - a.pending || (b.medianAge ?? 0) - (a.medianAge ?? 0));
  return { projects: out.slice(0, topN), totalProjects: out.length, noProject: unnamed, totalPending: pending.length };
}

// ------------------------------------------------------------------
// Overdue rows by project / vendor
// ------------------------------------------------------------------
export interface OverdueRow {
  id: string;
  prNo?: string;
  poNo?: string;
  project?: string;
  vendor?: string;
  neededDate: string;
  daysOverdue: number;
}
export interface OverdueGroup { name: string; count: number; maxDays: number }
export interface OverdueResult {
  /** Worst first. */
  rows: OverdueRow[];
  byProject: OverdueGroup[];
  byVendor: OverdueGroup[];
}

/** Open, undelivered rows whose needed date has passed. */
export function computeOverdue(allRows: TrackingRow[], today: Date = new Date(), topN = 8): OverdueResult {
  const rows: OverdueRow[] = [];
  for (const r of allRows) {
    if (isPlaceholderRow(r) || isClosed(r) || r.deliveredDate) continue;
    const need = plausibleDate(r.neededDate, today);
    if (!need || need.getTime() >= today.getTime()) continue;
    rows.push({ id: r.id, prNo: r.prNo, poNo: r.poNo, project: r.project, vendor: r.vendor, neededDate: r.neededDate!, daysOverdue: daysBetween(need, today) });
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  const group = (field: "project" | "vendor"): OverdueGroup[] => {
    const m = new Map<string, OverdueGroup>();
    for (const r of rows) {
      const raw = clean(r[field]);
      const key = nameKey(raw) ?? "__none__";
      let g = m.get(key);
      if (!g) { g = { name: nameKey(raw) ? raw : NO_LABEL, count: 0, maxDays: 0 }; m.set(key, g); }
      g.count++;
      g.maxDays = Math.max(g.maxDays, r.daysOverdue);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || b.maxDays - a.maxDays).slice(0, topN);
  };
  return { rows, byProject: group("project"), byVendor: group("vendor") };
}
