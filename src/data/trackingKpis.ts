import type { TrackingRow } from "../TrackingPage";
import { plausibleDate, daysBetween, isPlaceholderRow } from "./trackingStats";

/* Procurement KPIs for the Summary tab. Pure functions over tracking rows
   (no Firestore, no React) so the same definitions apply to the whole team
   and to one person.

   Two kinds of KPI:
   - "ready" ones use fields the team fills in reliably (PR/PA/PO numbers,
     status, PR/PA/PO dates);
   - "needs data" ones (value, on-time delivery, overdue) depend on fields that
     are mostly still blank. Each reports its COVERAGE and only exposes a
     headline number once coverage/sample clear the gates below — a precise-
     looking figure over thin data is worse than an honest "waiting for data". */

/** Below this share of the applicable rows having the needed fields, a KPI is "waiting for data". */
export const MIN_COVERAGE = 0.3;
/** …or below this many measurable rows. */
export const MIN_SAMPLE = 10;
/** An approval waiting longer than this many days counts as stuck. */
export const STUCK_APPROVAL_DAYS = 7;

const isClosed = (r: TrackingRow) => r.status === "Completed" || r.status === "Cancelled";

const round1 = (n: number) => Math.round(n * 10) / 10;
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Coverage of a "needs data" KPI: how many of the applicable rows carry the needed fields. */
export interface Coverage {
  measured: number;
  applicable: number;
  /** measured / applicable, 0 when nothing applies. */
  share: number;
  /** Clears both gates — safe to show a headline number. */
  ready: boolean;
}
function coverage(measured: number, applicable: number): Coverage {
  const share = applicable > 0 ? measured / applicable : 0;
  return { measured, applicable, share, ready: measured >= MIN_SAMPLE && share >= MIN_COVERAGE };
}

export interface Aging {
  n: number;
  medianDays: number | null;
  avgDays: number | null;
  maxDays: number | null;
  /** 0–7 / 8–30 / >30 days since PR date. */
  buckets: [number, number, number];
}
function aging(days: number[]): Aging {
  const b: [number, number, number] = [0, 0, 0];
  for (const d of days) b[d <= 7 ? 0 : d <= 30 ? 1 : 2]++;
  const m = median(days), a = mean(days);
  return { n: days.length, medianDays: m === null ? null : round1(m), avgDays: a === null ? null : round1(a), maxDays: days.length ? Math.max(...days) : null, buckets: b };
}

export interface TurnaroundStat { n: number; medianDays: number | null; avgDays: number | null }
function turnaround(rows: TrackingRow[], from: keyof TrackingRow, to: keyof TrackingRow, today: Date): TurnaroundStat {
  const ds: number[] = [];
  for (const r of rows) {
    const a = plausibleDate(r[from] as string | undefined, today);
    const b = plausibleDate(r[to] as string | undefined, today);
    if (!a || !b) continue;
    const d = daysBetween(a, b);
    if (d >= 0 && d <= 365) ds.push(d);   // same sanity window as the cycle-time chart
  }
  const m = median(ds), a = mean(ds);
  return { n: ds.length, medianDays: m === null ? null : round1(m), avgDays: a === null ? null : round1(a) };
}

export interface TrackingKpis {
  /** POs still in progress: has a PO No., not Completed/Cancelled. */
  openPo: {
    poCount: number;
    rowCount: number;
    value: number;
    /** Share of these rows with qty × unit price (gates whether the value is shown). */
    priceCoverage: Coverage;
    /** The rows behind rowCount/value — for drill-down into All Rows. */
    rows: TrackingRow[];
  };
  /** Has a PR No., no PO No., not Completed/Cancelled. */
  pendingPrToPo: {
    count: number;
    noPa: number;        // no PA No. yet
    hasPaNoPo: number;   // PA raised, PO not yet
    aging: Aging;
    /** Pending rows whose Date PR is empty/implausible (not in aging). */
    unknownAge: number;
    rows: TrackingRow[];
  };
  /** Rows waiting on an approval, with how long they've been waiting. */
  approvalQueue: {
    pa: { count: number; oldestDays: number | null; stuck: number; rows: TrackingRow[] };
    po: { count: number; oldestDays: number | null; stuck: number; rows: TrackingRow[] };
  };
  approvalTime: { pa: TurnaroundStat; po: TurnaroundStat };
  /** PO Nos. opened (Date PO Submitted) this month vs last month. */
  throughput: { thisMonth: number; lastMonth: number; monthLabel: string; thisMonthRows: TrackingRow[] };
  onTimeDelivery: {
    pct: number | null;   // null until coverage.ready
    onTime: number;
    /** Measured / (Completed ∪ delivered) rows. */
    coverage: Coverage;
  };
  atRisk: {
    /** Overdue rows among those with a needed date — real count, but only headline-worthy once coverage.ready. */
    count: number;
    coverage: Coverage;   // open, undelivered rows that have a needed date
    /** The rows counted as overdue — for drill-down into All Rows. */
    rows: TrackingRow[];
  };
}

export function computeTrackingKpis(
  allRows: TrackingRow[],
  moneyOf: (r: TrackingRow) => number,
  today: Date = new Date(),
): TrackingKpis {
  const rows = allRows.filter((r) => !isPlaceholderRow(r) && r.status !== "Cancelled");
  const open = rows.filter((r) => !isClosed(r));

  // --- Open POs ---
  const openPoRows = open.filter((r) => !!r.poNo?.trim());
  const poSet = new Set(openPoRows.map((r) => r.poNo!.trim().toUpperCase()));
  const priced = openPoRows.filter((r) => (r.qty ?? 0) > 0 && (r.unitPrice ?? 0) > 0).length;

  // --- Pending PR -> PO ---
  const pending = open.filter((r) => !!r.prNo?.trim() && !r.poNo?.trim());
  const ages: number[] = [];
  for (const r of pending) {
    const from = plausibleDate(r.prDate, today);
    if (!from) continue;
    const a = daysBetween(from, today);
    if (a >= 0) ages.push(a);
  }

  // --- Approval queue ---
  const queue = (status: string, dateField: "paSubmittedDate" | "poSubmittedDate") => {
    const waiting = open.filter((r) => r.status === status);
    const waits: number[] = [];
    for (const r of waiting) {
      const d = plausibleDate(r[dateField], today);
      if (!d) continue;
      const w = daysBetween(d, today);
      if (w >= 0) waits.push(w);
    }
    return { count: waiting.length, oldestDays: waits.length ? Math.max(...waits) : null, stuck: waits.filter((w) => w > STUCK_APPROVAL_DAYS).length, rows: waiting };
  };

  // --- Throughput: distinct PO Nos. by month of Date PO Submitted ---
  const ym = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const nowM = ym(today);
  const thisSet = new Set<string>(), lastSet = new Set<string>();
  const thisMonthRows: TrackingRow[] = [];
  for (const r of rows) {
    if (!r.poNo?.trim()) continue;
    const d = plausibleDate(r.poSubmittedDate, today);
    if (!d) continue;
    const key = r.poNo.trim().toUpperCase();
    if (ym(d) === nowM) { thisSet.add(key); thisMonthRows.push(r); }
    else if (ym(d) === nowM - 1) lastSet.add(key);
  }

  // --- On-time delivery: applicable = every Completed row (delivery date SHOULD exist) plus any delivered row ---
  const deliveryPop = rows.filter((r) => r.status === "Completed" || !!r.deliveredDate);
  let onTime = 0, measured = 0;
  for (const r of deliveryPop) {
    const got = plausibleDate(r.deliveredDate, today);
    const need = plausibleDate(r.neededDate, today);
    if (!got || !need) continue;
    measured++;
    if (got.getTime() <= need.getTime()) onTime++;
  }
  const otdCov = coverage(measured, deliveryPop.length);

  // --- At-risk: open, undelivered rows; measurable only if they have a needed date ---
  const undelivered = open.filter((r) => !r.deliveredDate);
  let withNeeded = 0;
  const overdueRows: TrackingRow[] = [];
  for (const r of undelivered) {
    const need = plausibleDate(r.neededDate, today);
    if (!need) continue;
    withNeeded++;
    if (need.getTime() < today.getTime()) overdueRows.push(r);
  }

  return {
    openPo: {
      poCount: poSet.size,
      rowCount: openPoRows.length,
      value: openPoRows.reduce((s, r) => s + moneyOf(r), 0),
      priceCoverage: coverage(priced, openPoRows.length),
      rows: openPoRows,
    },
    pendingPrToPo: {
      count: pending.length,
      noPa: pending.filter((r) => !r.paNo?.trim()).length,
      hasPaNoPo: pending.filter((r) => !!r.paNo?.trim()).length,
      aging: aging(ages),
      unknownAge: pending.length - ages.length,
      rows: pending,
    },
    approvalQueue: {
      pa: queue("Pending PA Approval", "paSubmittedDate"),
      po: queue("Pending PO Approval", "poSubmittedDate"),
    },
    approvalTime: {
      pa: turnaround(rows, "paSubmittedDate", "paApprovedDate", today),
      po: turnaround(rows, "poSubmittedDate", "poApprovedDate", today),
    },
    throughput: {
      thisMonth: thisSet.size,
      lastMonth: lastSet.size,
      monthLabel: today.toLocaleDateString("th-TH", { month: "long", year: "numeric" }),
      thisMonthRows,
    },
    onTimeDelivery: { pct: otdCov.ready ? Math.round((onTime / measured) * 100) : null, onTime, coverage: otdCov },
    atRisk: { count: overdueRows.length, coverage: coverage(withNeeded, undelivered.length), rows: overdueRows },
  };
}

/** What a person still has to fill in so the "needs data" KPIs can work: open POs
 *  (the actionable set) missing a needed date and/or qty × unit price. */
export interface DataGaps {
  openPoRows: number;
  noNeededDate: number;
  noPrice: number;
}
export function computeDataGaps(allRows: TrackingRow[]): DataGaps {
  const rows = allRows.filter((r) => !isPlaceholderRow(r) && !isClosed(r) && !!r.poNo?.trim());
  return {
    openPoRows: rows.length,
    noNeededDate: rows.filter((r) => !plausibleDate(r.neededDate)).length,
    noPrice: rows.filter((r) => !((r.qty ?? 0) > 0 && (r.unitPrice ?? 0) > 0)).length,
  };
}
