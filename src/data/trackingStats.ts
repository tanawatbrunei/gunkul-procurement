import type { TrackingRow } from "../TrackingPage";

/* Shared date helpers + the PO-issuing performance numbers shown on the
   Tracking Sheet summary. Pure functions (no Firestore) so the same rules apply
   to the team view and to each person's tab. */

export function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** A date typed into the Sheet that is a plausible tracking date. Typos like
 *  "115", "1969-07-10" or "0206-07-31" (meant 2026) parse as valid Dates but
 *  would wreck any average, so they are treated as missing. */
export function plausibleDate(s: string | undefined, today: Date = new Date()): Date | null {
  const d = parseDate(s);
  if (!d) return null;
  const y = d.getFullYear();
  return y >= 2020 && y <= today.getFullYear() + 1 ? d : null;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** A reserved row number with no PR/PA/PO No. yet — not real tracked work. */
export function isPlaceholderRow(r: TrackingRow): boolean {
  return !r.prNo?.trim() && !r.paNo?.trim() && !r.poNo?.trim();
}

export interface TrackingStats {
  /** Every real row ever opened (placeholders excluded), cancelled included. */
  total: number;
  cancelled: number;
  completed: number;
  /** Has a PO No. and isn't cancelled. */
  poIssued: number;
  /** Not Completed and not Cancelled. */
  pending: number;
  waitingPA: number;
  waitingPO: number;
  onHold: number;
  /** PR date -> PO submitted date, calendar days (cancelled excluded). */
  avgDays: number | null;
  medianDays: number | null;
  cycleN: number;
  /** Days since PR date for still-pending rows. */
  avgAge: number | null;
  maxAge: number | null;
  overdue30: number;
  /** Rows whose Date PR / PO Submitted is filled in but not a plausible date. */
  badDates: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ============================================================
   Stage-by-stage lead time (PR -> PA -> PO) — powers the stage KPI
   cards, the "Current Stage & Progress" column, and the bottleneck
   quick filters. Pure functions, same rules for team view and per-
   person tabs.
   ============================================================ */

/** The 5-node funnel shown as a mini stepper in the table and drawer.
 *  Derived from which date/No. fields are filled in, not from the free-text
 *  `status` column (which has too many legacy/Thai variants to drive a
 *  stepper reliably) — `status` is still shown separately as its own badge. */
export const STAGE_LABELS = ["PR Review", "PA Bidding", "PA Approval", "PO Pending", "Completed"] as const;
export type StageIndex = -1 | 0 | 1 | 2 | 3 | 4; // -1 = Cancelled

export function getStageIndex(r: TrackingRow): StageIndex {
  if (r.status === "Cancelled") return -1;
  if (r.status === "Completed" || r.poApprovedDate?.trim()) return 4;
  if (r.poSubmittedDate?.trim()) return 3;
  if (r.paApprovedDate?.trim()) return 3;
  if (r.paSubmittedDate?.trim()) return 2;
  if (r.paNo?.trim()) return 1;
  return 0;
}

/** Date the row entered its current stage — the basis for "days in stage". */
function stageEnteredDate(r: TrackingRow, stage: StageIndex): Date | null {
  if (stage === 3) return plausibleDate(r.paApprovedDate) ?? plausibleDate(r.paSubmittedDate) ?? plausibleDate(r.prDate);
  if (stage === 2) return plausibleDate(r.paSubmittedDate) ?? plausibleDate(r.prDate);
  if (stage === 1 || stage === 0) return plausibleDate(r.prDate);
  return null; // Completed/Cancelled rows don't age
}

export interface StageProgress {
  stage: StageIndex;
  label: string;
  /** Days sitting in the current stage (null for Completed/Cancelled, or if the anchor date is missing/implausible). */
  daysInStage: number | null;
  /** Full PR -> now (or -> PO Approved if finished) elapsed calendar days. */
  totalDuration: number | null;
}

export function getStageProgress(r: TrackingRow, today: Date = new Date()): StageProgress {
  const stage = getStageIndex(r);
  const anchor = stage >= 0 ? stageEnteredDate(r, stage) : null;
  const daysInStage = anchor ? Math.max(0, daysBetween(anchor, today)) : null;

  const prDate = plausibleDate(r.prDate, today);
  let totalDuration: number | null = null;
  if (prDate) {
    const end = stage === 4 ? (plausibleDate(r.poApprovedDate, today) ?? plausibleDate(r.poSubmittedDate, today) ?? today) : today;
    totalDuration = Math.max(0, daysBetween(prDate, end));
  }
  return { stage, label: stage === -1 ? "Cancelled" : STAGE_LABELS[stage], daysInStage, totalDuration };
}

/** Aging color band used by both the table cell and the "Bottleneck" quick filter. */
export function agingBand(days: number | null): "green" | "amber" | "red" | null {
  if (days === null) return null;
  if (days > 3) return "red"; // overdue / bottleneck
  if (days === 3) return "amber"; // at the 3-day SLA edge
  return "green"; // normal, <= 2 days
}

interface StageDurationStat { avg: number | null; median: number | null; n: number }
function durationStat(diffs: number[]): StageDurationStat {
  const sorted = [...diffs].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return { avg: null, median: null, n: 0 };
  const avg = round1(sorted.reduce((a, b) => a + b, 0) / n);
  const median = round1(n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2);
  return { avg, median, n };
}

/** SLA targets (calendar days) each stage is expected to finish within —
 *  used only to flag which stage is the current bottleneck, not shown as a
 *  hard rule. Reasonable working defaults; adjust here if the team sets
 *  official targets. */
export const STAGE_SLA_DAYS = { stage1: 3, stage2: 2, stage3: 2 } as const;

export interface StageBreakdown {
  stage1: StageDurationStat; // PR -> PA Submitted (sourcing)
  stage2: StageDurationStat; // PA Submitted -> PA Approved (management approval)
  stage3: StageDurationStat; // PA Approved -> PO Submitted (PO issuance)
  /** Stage (1/2/3) whose avg exceeds its SLA by the most, or null if every
   *  stage with data is within SLA. */
  bottleneck: 1 | 2 | 3 | null;
}

export function computeStageBreakdown(rows: TrackingRow[], today: Date = new Date()): StageBreakdown {
  const tracked = rows.filter((r) => !isPlaceholderRow(r) && r.status !== "Cancelled");
  const d1: number[] = [], d2: number[] = [], d3: number[] = [];
  for (const r of tracked) {
    const pr = plausibleDate(r.prDate, today);
    const paSub = plausibleDate(r.paSubmittedDate, today);
    const paAppr = plausibleDate(r.paApprovedDate, today);
    const poSub = plausibleDate(r.poSubmittedDate, today);
    if (pr && paSub) { const d = daysBetween(pr, paSub); if (d >= 0 && d <= 365) d1.push(d); }
    if (paSub && paAppr) { const d = daysBetween(paSub, paAppr); if (d >= 0 && d <= 365) d2.push(d); }
    if (paAppr && poSub) { const d = daysBetween(paAppr, poSub); if (d >= 0 && d <= 365) d3.push(d); }
  }
  const stage1 = durationStat(d1), stage2 = durationStat(d2), stage3 = durationStat(d3);
  const overBy = [
    { stage: 1 as const, over: stage1.avg === null ? -Infinity : stage1.avg - STAGE_SLA_DAYS.stage1 },
    { stage: 2 as const, over: stage2.avg === null ? -Infinity : stage2.avg - STAGE_SLA_DAYS.stage2 },
    { stage: 3 as const, over: stage3.avg === null ? -Infinity : stage3.avg - STAGE_SLA_DAYS.stage3 },
  ].sort((a, b) => b.over - a.over)[0];
  const bottleneck = overBy && overBy.over > 0 ? overBy.stage : null;
  return { stage1, stage2, stage3, bottleneck };
}

/** Heuristic: does this PO No. value actually look like a PO number, or is
 *  it free text a sheet-filler dropped in there instead (e.g. "ติดส่งขึ้น
 *  workflow ไม่ได้")? Real PO numbers in this sheet are short, ASCII,
 *  alphanumeric-with-dashes codes like "CDPO26-000587". Anything containing
 *  Thai characters or a space is treated as a remark, not a number. */
export function isLikelyPoNumber(s: string | undefined): boolean {
  if (!s?.trim()) return false;
  const v = s.trim();
  return /^[A-Za-z0-9][A-Za-z0-9-]{3,}$/.test(v) && !/[฀-๿]/.test(v);
}

export function computeTrackingStats(rows: TrackingRow[], today: Date = new Date()): TrackingStats {
  const tracked = rows.filter((r) => !isPlaceholderRow(r));
  const isCancelled = (r: TrackingRow) => r.status === "Cancelled";
  const cancelled = tracked.filter(isCancelled).length;
  const completed = tracked.filter((r) => r.status === "Completed").length;
  const pendingRows = tracked.filter((r) => r.status !== "Completed" && r.status !== "Cancelled");

  // PR -> PO submitted. Same 0..365-day sanity window as the Dashboard's
  // cycle-time analysis so a mistyped date can't skew the average.
  const diffs: number[] = [];
  for (const r of tracked) {
    if (isCancelled(r)) continue;
    const from = plausibleDate(r.prDate, today);
    const to = plausibleDate(r.poSubmittedDate, today);
    if (!from || !to) continue;
    const d = daysBetween(from, to);
    if (d >= 0 && d <= 365) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  const n = diffs.length;
  const mean = n ? diffs.reduce((a, b) => a + b, 0) / n : null;
  const median = n ? (n % 2 ? diffs[(n - 1) / 2] : (diffs[n / 2 - 1] + diffs[n / 2]) / 2) : null;

  const ages: number[] = [];
  for (const r of pendingRows) {
    const from = plausibleDate(r.prDate, today);
    if (!from) continue;
    const a = daysBetween(from, today);
    if (a >= 0) ages.push(a);
  }

  const badDates = tracked.filter((r) =>
    !isCancelled(r) && ((!!r.prDate && !plausibleDate(r.prDate, today)) || (!!r.poSubmittedDate && !plausibleDate(r.poSubmittedDate, today))),
  ).length;

  return {
    total: tracked.length,
    cancelled,
    completed,
    poIssued: tracked.filter((r) => !isCancelled(r) && !!r.poNo?.trim()).length,
    pending: pendingRows.length,
    waitingPA: pendingRows.filter((r) => r.status === "Pending PA Approval").length,
    waitingPO: pendingRows.filter((r) => r.status === "Pending PO Approval").length,
    onHold: pendingRows.filter((r) => r.status === "On Hold").length,
    avgDays: mean === null ? null : round1(mean),
    medianDays: median === null ? null : round1(median),
    cycleN: n,
    avgAge: ages.length ? round1(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
    maxAge: ages.length ? Math.max(...ages) : null,
    overdue30: ages.filter((a) => a > 30).length,
    badDates,
  };
}
