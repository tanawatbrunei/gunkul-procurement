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
