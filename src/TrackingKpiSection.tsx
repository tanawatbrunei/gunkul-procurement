import { useMemo } from "react";
import { computeMoney } from "./TrackingPage";
import type { TrackingRow } from "./TrackingPage";
import { computeTrackingKpis, STUCK_APPROVAL_DAYS } from "./data/trackingKpis";
import { n, d, fmtBaht, Card, DataCard, CornerBadge } from "./components/KpiCards";

/** Section 1 — Executive KPI Summary. Compact cards: active POs, this
 *  month / year-to-date PO output, the two queues (PR→PO, approvals), and the
 *  value / delivery metrics that depend on team data entry. The data-entry
 *  cards show whatever is computable now and flag incomplete coverage with a
 *  short corner badge; the per-person "what to fill in" table lives in
 *  Section 3 (TrackingDataIntegrity). */
export default function TrackingKpiSection({ rows, onDrill }: {
  rows: TrackingRow[];
  onDrill: (title: string, description: string, rows: TrackingRow[]) => void;
}) {
  const k = useMemo(() => computeTrackingKpis(rows, (r) => computeMoney(r).total), [rows]);
  const asOf = useMemo(() => new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }), []);

  const p = k.pendingPrToPo;
  const q = k.approvalQueue;
  const delta = k.throughput.lastMonth > 0
    ? Math.round(((k.throughput.thisMonth - k.throughput.lastMonth) / k.throughput.lastMonth) * 100) : null;
  const year = new Date().getFullYear() + 543;

  return (
    <div>
      <p style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
        คำนวณ ณ {asOf} · ไม่รวมรายการที่ยกเลิก · ชี้เมาส์ที่การ์ดเพื่อดูนิยาม คลิกการ์ดเพื่อดูรายการ
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "var(--sp-3)" }}>
        <Card label="Active POs" color="var(--primary)" value={n(k.openPo.poCount)}
          title="เลข PO ไม่ซ้ำ ที่แถวมี PO No. และสถานะยังไม่ Completed/Cancelled (รวม PO ที่ยังรออนุมัติ)"
          lines={[`จาก ${n(k.openPo.rowCount)} รายการ`]}
          onClick={k.openPo.rowCount ? () => onDrill("PO ที่ยังดำเนินอยู่", "มี PO No. และสถานะยังไม่ Completed/Cancelled", k.openPo.rows) : undefined} />
        <DataCard label="มูลค่า Active POs" cov={k.openPo.priceCoverage}
          value={k.openPo.priceCoverage.measured ? fmtBaht(k.openPo.value) : null} extra={k.openPo.priceCoverage.measured ? "รวม VAT 7% · เฉพาะรายการที่มีราคา" : "ยังไม่มีรายการที่กรอกราคา"}
          need="ต้องกรอก Qty และราคา/หน่วย"
          title="ผลรวม (จำนวน × ราคา/หน่วย − ส่วนลด + VAT 7%) ของ PO ที่ยังดำเนินอยู่ — รวมเฉพาะรายการที่มีราคา"
          onClick={k.openPo.priceCoverage.measured ? () => onDrill("PO ที่ยังดำเนินอยู่ (มีราคา)", "มี PO No. สถานะยังไม่ปิด และมี Qty × ราคา/หน่วย", k.openPo.rows.filter((r) => (r.qty ?? 0) > 0 && (r.unitPrice ?? 0) > 0)) : undefined} />
        <Card label={`MTD · PO ที่เปิด ${k.throughput.monthLabel}`} color="var(--success)" value={n(k.throughput.thisMonth)}
          title="จำนวนเลข PO ไม่ซ้ำ ที่ Date PO Submitted อยู่ในเดือนนี้ เทียบเดือนก่อน (เดือนนี้ยังไม่จบ)"
          lines={[`เดือนก่อน ${n(k.throughput.lastMonth)}${delta === null ? "" : ` (${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}%)`} · เดือนนี้ยังไม่จบ`]}
          onClick={k.throughput.thisMonthRows.length ? () => onDrill(`PO ที่เปิด ${k.throughput.monthLabel}`, "Date PO Submitted อยู่ในเดือนนี้", k.throughput.thisMonthRows) : undefined} />
        <Card label={`YTD · PO ที่เปิดปี ${year}`} color="var(--success)" value={n(k.throughput.ytd)}
          title="จำนวนเลข PO ไม่ซ้ำ ที่ Date PO Submitted ตั้งแต่ 1 ม.ค. ถึงวันนี้"
          lines={[`เฉลี่ย ${k.throughput.ytd ? n(Math.round((k.throughput.ytd / (new Date().getMonth() + 1)) * 10) / 10) : "—"} PO / เดือน`]}
          onClick={k.throughput.ytdRows.length ? () => onDrill(`PO ที่เปิดปี ${year}`, "Date PO Submitted ตั้งแต่ 1 ม.ค. ถึงวันนี้", k.throughput.ytdRows) : undefined} />
        <Card label="Pending PR → PO" color="var(--warning)" value={n(p.count)}
          title="มีเลข PR แต่ยังไม่มีเลข PO และยังไม่ Completed/Cancelled — อายุ = วันนี้ − Date PR"
          lines={[
            `ไม่มี PA ${n(p.noPa)} · มี PA รอ PO ${n(p.hasPaNoPo)}`,
            p.aging.n ? `อายุมัธยฐาน ${d(p.aging.medianDays)} · เกิน 30 วัน ${n(p.aging.buckets[2])}` : "อายุ —",
          ]}
          badge={p.unknownAge > 0 ? <CornerBadge>⚠️ ไม่มี Date PR {n(p.unknownAge)}</CornerBadge> : undefined}
          onClick={p.count ? () => onDrill("Pending PR → PO", "มี PR No. แต่ยังไม่มี PO No. และยังไม่ Completed/Cancelled", p.rows) : undefined} />
        <Card label="คิวรออนุมัติ" color="var(--warning)" value={n(q.pa.count + q.po.count)}
          title={`สถานะ Pending PA/PO Approval — "เกินกำหนด" = รอเกิน ${STUCK_APPROVAL_DAYS} วัน · เวลาอนุมัติ = มัธยฐานของ Date Submitted → Approved`}
          lines={[
            `PA ${n(q.pa.count)} · เกิน ${STUCK_APPROVAL_DAYS} วัน ${n(q.pa.stuck)} · PO ${n(q.po.count)} · เกิน ${n(q.po.stuck)}`,
            `เวลาอนุมัติมัธยฐาน PA ${d(k.approvalTime.pa.medianDays)} · PO ${d(k.approvalTime.po.medianDays)}`,
          ]}
          onClick={(q.pa.count + q.po.count) ? () => onDrill("คิวรออนุมัติ", "สถานะ Pending PA Approval หรือ Pending PO Approval", [...q.pa.rows, ...q.po.rows]) : undefined} />
        <DataCard label="On-Time Delivery" cov={k.onTimeDelivery.coverage}
          value={k.onTimeDelivery.pct === null ? null : `${k.onTimeDelivery.pct}%`}
          extra={k.onTimeDelivery.coverage.measured ? `ตรงเวลา ${n(k.onTimeDelivery.onTime)} จาก ${n(k.onTimeDelivery.coverage.measured)}` : undefined}
          need="ต้องกรอกวันต้องการสินค้า และวันทำรับ"
          title="สัดส่วนรายการที่ ทำรับ ≤ วันต้องการสินค้า — ฐานคือทุกรายการที่ Completed หรือมีวันทำรับ" />
        <DataCard label="At-Risk / Overdue" cov={k.atRisk.coverage}
          value={n(k.atRisk.count)} extra="เลยวันต้องการสินค้า ยังไม่ทำรับ"
          need="ต้องกรอกวันต้องการสินค้า"
          title="เลยวันต้องการสินค้า ยังไม่มีวันทำรับ และยังไม่ Completed/Cancelled"
          onClick={k.atRisk.count ? () => onDrill("At-Risk / Overdue", "เลยวันต้องการสินค้า ยังไม่มีวันทำรับ และยังไม่ Completed/Cancelled", k.atRisk.rows) : undefined} />
      </div>
    </div>
  );
}
