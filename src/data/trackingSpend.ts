import type { TrackingRow } from "../TrackingPage";
import { plausibleDate, isPlaceholderRow } from "./trackingStats";
import { groupBy } from "./trackingBottleneck";
import { MIN_COVERAGE, MIN_SAMPLE } from "./trackingKpis";
import type { Coverage } from "./trackingKpis";

/* Spend & supplier views for the Summary tab.
   A PO counts in a period by its Date PO Approved (calendar month / calendar
   year to date). Money = qty × unit price − discount (+ VAT 7%) from the
   Sheet; most rows have no price yet, so every spend figure carries its
   coverage and the UI only shows a number once coverage clears the gates. */

const isCancelled = (r: TrackingRow) => r.status === "Cancelled";

function coverage(measured: number, applicable: number): Coverage {
  const share = applicable > 0 ? measured / applicable : 0;
  return { measured, applicable, share, ready: measured >= MIN_SAMPLE && share >= MIN_COVERAGE };
}
const hasPrice = (r: TrackingRow) => (r.qty ?? 0) > 0 && (r.unitPrice ?? 0) > 0;
const poKey = (r: TrackingRow) => r.poNo!.trim().toUpperCase();

export interface PeriodSpend {
  /** Distinct PO Nos. approved in the period (works without any price data). */
  poCount: number;
  rowCount: number;
  /** Sum of money over rows that HAVE a price — partial when coverage is low. */
  spend: number;
  /** Priced rows / approved-PO rows in the period. */
  priceCoverage: Coverage;
}

export interface VendorVolume { name: string; poCount: number }
export interface VendorSpend { name: string; spend: number; poCount: number }

export interface SpendResult {
  monthLabel: string;
  year: number;
  month: PeriodSpend;
  ytd: PeriodSpend;
  /** Top vendors by distinct approved POs, year to date. */
  vendorVolume: VendorVolume[];
  /** Approved-PO rows YTD with no Vendor name (excluded from the vendor charts). */
  vendorUnnamed: number;
  vendorUnnamedShare: number;
  ytdRowCount: number;
  totalVendors: number;
  /** Top vendors by spend (priced rows only), year to date. */
  vendorSpend: VendorSpend[];
  /** Priced YTD rows that also have a Vendor name / priced YTD rows. */
  vendorSpendCoverage: Coverage;
}

export function computeSpend(
  allRows: TrackingRow[],
  moneyOf: (r: TrackingRow) => number,
  today: Date = new Date(),
  topN = 8,
): SpendResult {
  const year = today.getFullYear();
  const rows = allRows.filter((r) => !isPlaceholderRow(r) && !isCancelled(r) && !!r.poNo?.trim());

  const monthRows: TrackingRow[] = [];
  const ytdRows: TrackingRow[] = [];
  for (const r of rows) {
    const d = plausibleDate(r.poApprovedDate, today);
    if (!d || d.getTime() > today.getTime() || d.getFullYear() !== year) continue;
    ytdRows.push(r);
    if (d.getMonth() === today.getMonth()) monthRows.push(r);
  }

  const period = (rs: TrackingRow[]): PeriodSpend => {
    const priced = rs.filter(hasPrice);
    return {
      poCount: new Set(rs.map(poKey)).size,
      rowCount: rs.length,
      spend: priced.reduce((s, r) => s + moneyOf(r), 0),
      priceCoverage: coverage(priced.length, rs.length),
    };
  };

  // Vendor volume (YTD): distinct approved POs per vendor.
  const { groups, unnamed, display } = groupBy(ytdRows, "vendor");
  const vols = [...groups.values()].map((g) => ({ name: display(g), poCount: new Set(g.rows.map(poKey)).size }))
    .sort((a, b) => b.poCount - a.poCount || a.name.localeCompare(b.name));

  // Vendor spend (YTD): priced rows only.
  const pricedYtd = ytdRows.filter(hasPrice);
  const sp = groupBy(pricedYtd, "vendor");
  const spends = [...sp.groups.values()].map((g) => ({
    name: sp.display(g), spend: g.rows.reduce((s, r) => s + moneyOf(r), 0), poCount: new Set(g.rows.map(poKey)).size,
  })).sort((a, b) => b.spend - a.spend);

  return {
    monthLabel: today.toLocaleDateString("th-TH", { month: "long", year: "numeric" }),
    year,
    month: period(monthRows),
    ytd: period(ytdRows),
    vendorVolume: vols.slice(0, topN),
    vendorUnnamed: unnamed,
    vendorUnnamedShare: ytdRows.length ? unnamed / ytdRows.length : 0,
    ytdRowCount: ytdRows.length,
    totalVendors: vols.length,
    vendorSpend: spends.slice(0, topN),
    vendorSpendCoverage: coverage(pricedYtd.length - sp.unnamed, pricedYtd.length),
  };
}
