import type { TrackingRow } from "../TrackingPage";
import { plausibleDate, daysBetween, isPlaceholderRow } from "./trackingStats";

/* Procurement KPIs for the Summary tab. Pure functions over tracking rows
   (no Firestore, no React) so the same definitions apply to the whole team
   and to one person. Every KPI also reports how many rows were EXCLUDED
   because a date/price it needs is missing or implausible, so the UI never
   shows a precise-looking number over thin data. */

const isClosed = (r: TrackingRow) => r.status === "Completed" || r.status === "Cancelled";

export interface KpiCompleteness {
  /** Rows the KPI could not use because a needed field was empty/implausible. */
  missing: number;
  /** Rows the KPI applies to at all (denominator for the missing share). */
  applicable: number;
}

export interface TrackingKpis {
  openPo: {
    /** Distinct PO numbers on rows that have a PO No. and are not Completed/Cancelled. */
    poCount: number;
    rowCount: number;
    /** Sum of computeMoney().total over those rows (incl. VAT). */
    value: number;
    completeness: KpiCompleteness;   // rows with no qty × unit price
  };
  pendingPrToPo: {
    /** Has a PR No., no PO No., not Completed/Cancelled. */
    count: number;
    avgAgingDays: number | null;
    maxAgingDays: number | null;
    completeness: KpiCompleteness;   // rows with no usable Date PR
  };
  onTimeDelivery: {
    /** delivered on/before the needed date, out of those with both dates. */
    pct: number | null;
    onTime: number;
    measured: number;
    completeness: KpiCompleteness;   // delivered rows lacking a needed date
  };
  atRisk: {
    /** Needed date passed, not delivered, not Completed/Cancelled. */
    count: number;
    completeness: KpiCompleteness;   // open rows with no needed date
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
  const noPrice = openPoRows.filter((r) => !((r.qty ?? 0) > 0 && (r.unitPrice ?? 0) > 0)).length;

  // --- Pending PR -> PO ---
  const pending = open.filter((r) => !!r.prNo?.trim() && !r.poNo?.trim());
  const ages: number[] = [];
  for (const r of pending) {
    const from = plausibleDate(r.prDate, today);
    if (!from) continue;
    const a = daysBetween(from, today);
    if (a >= 0) ages.push(a);
  }

  // --- On-time delivery ---
  const delivered = rows.filter((r) => !!r.deliveredDate);
  let onTime = 0, measured = 0, noNeeded = 0;
  for (const r of delivered) {
    const got = plausibleDate(r.deliveredDate, today);
    const need = plausibleDate(r.neededDate, today);
    if (!got || !need) { noNeeded++; continue; }
    measured++;
    if (got.getTime() <= need.getTime()) onTime++;
  }

  // --- At-risk / overdue ---
  const undelivered = open.filter((r) => !r.deliveredDate);
  let atRisk = 0, noNeededOpen = 0;
  for (const r of undelivered) {
    const need = plausibleDate(r.neededDate, today);
    if (!need) { noNeededOpen++; continue; }
    if (need.getTime() < today.getTime()) atRisk++;
  }

  return {
    openPo: {
      poCount: poSet.size,
      rowCount: openPoRows.length,
      value: openPoRows.reduce((s, r) => s + moneyOf(r), 0),
      completeness: { missing: noPrice, applicable: openPoRows.length },
    },
    pendingPrToPo: {
      count: pending.length,
      avgAgingDays: ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : null,
      maxAgingDays: ages.length ? Math.max(...ages) : null,
      completeness: { missing: pending.length - ages.length, applicable: pending.length },
    },
    onTimeDelivery: {
      pct: measured ? Math.round((onTime / measured) * 100) : null,
      onTime,
      measured,
      completeness: { missing: noNeeded, applicable: delivered.length },
    },
    atRisk: {
      count: atRisk,
      completeness: { missing: noNeededOpen, applicable: undelivered.length },
    },
  };
}
