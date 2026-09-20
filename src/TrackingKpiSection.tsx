import { useMemo } from "react";
import { IconHourglass } from "@tabler/icons-react";
import { computeMoney } from "./TrackingPage";
import type { Tab, TrackingRow } from "./TrackingPage";
import {
  computeTrackingKpis, computeDataGaps, MIN_COVERAGE, MIN_SAMPLE, STUCK_APPROVAL_DAYS,
} from "./data/trackingKpis";
import type { Coverage } from "./data/trackingKpis";

const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--sp-4)",
};
const mutedCard: React.CSSProperties = { ...card, background: "transparent", border: "1px dashed var(--border-strong)" };
const line: React.CSSProperties = { fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: 2 };

const n = (v: number) => v.toLocaleString("th-TH");
const d = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("th-TH")} วัน`);
function pct(share: number): string {
  if (share > 0 && share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}
function fmtBaht(v: number): string {
  if (v >= 1_000_000) return `฿${(v / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}M`;
  return `฿${Math.round(v).toLocaleString("th-TH")}`;
}

function Card({ label, value, color, lines, title }: {
  label: string; value: React.ReactNode; color: string; lines: React.ReactNode[]; title: string;
}) {
  return (
    <div style={card} title={title}>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: "var(--fs-h2)", fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      {lines.map((l, i) => <div key={i} style={line}>{l}</div>)}
    </div>
  );
}

/** A KPI that needs fields the team hasn't filled in yet. Shows the number only
 *  once coverage clears the gates; until then an explicit "waiting for data". */
function DataCard({ label, value, cov, need, title, extra }: {
  label: string; value: React.ReactNode | null; cov: Coverage; need: string; title: string; extra?: React.ReactNode;
}) {
  const ready = cov.ready && value !== null;
  return (
    <div style={ready ? card : mutedCard} title={title}>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: "var(--fs-h2)", fontWeight: 700, lineHeight: 1.2, color: ready ? "var(--text-strong)" : "var(--text-faint)" }}>
        {ready ? value : "—"}
      </div>
      {extra && <div style={line}>{extra}</div>}
      <div style={{ fontSize: "var(--fs-xs)", marginTop: 6, display: "flex", gap: 4, alignItems: "flex-start", color: ready ? "var(--text-faint)" : "var(--warning)" }}>
        {!ready && <IconHourglass size={13} stroke={1.75} style={{ flexShrink: 0, marginTop: 2 }} />}
        <span>
          {ready ? `ข้อมูลครอบคลุม ${pct(cov.share)} (${n(cov.measured)} จาก ${n(cov.applicable)} รายการ)`
            : `รอข้อมูล — ครอบคลุม ${pct(cov.share)} (${n(cov.measured)} จาก ${n(cov.applicable)} รายการ) · ${need}`}
        </span>
      </div>
    </div>
  );
}

export default function TrackingKpiSection({ rows, tabs, rowsByTab, scope }: {
  rows: TrackingRow[]; tabs: Tab[]; rowsByTab: Record<string, TrackingRow[]>; scope: string;
}) {
  const k = useMemo(() => computeTrackingKpis(rows, (r) => computeMoney(r).total), [rows]);
  const asOf = useMemo(() => new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }), []);
  const gapsAll = useMemo(() => computeDataGaps(rows), [rows]);
  const gapsByPerson = useMemo(
    () => (scope === "all"
      ? tabs.map((t) => ({ name: t.name, g: computeDataGaps(rowsByTab[t.id] ?? []) }))
          .filter((x) => x.g.openPoRows > 0)
          .sort((a, b) => b.g.noNeededDate + b.g.noPrice - (a.g.noNeededDate + a.g.noPrice))
      : []),
    [scope, tabs, rowsByTab],
  );

  const p = k.pendingPrToPo;
  const delta = k.throughput.lastMonth > 0
    ? Math.round(((k.throughput.thisMonth - k.throughput.lastMonth) / k.throughput.lastMonth) * 100) : null;
  const q = k.approvalQueue;
  const th: React.CSSProperties = { padding: "8px 10px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text-strong)" }}>ตัวชี้วัดจัดซื้อ</h2>
        <p style={{ margin: "2px 0 var(--sp-3)", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
          คำนวณ ณ {asOf} · ไม่รวมรายการที่ยกเลิก · ชี้เมาส์ที่การ์ดเพื่อดูนิยาม
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--sp-3)" }}>
          <Card label="PO ที่ยังดำเนินอยู่" color="var(--primary)" value={n(k.openPo.poCount)}
            title="เลข PO ไม่ซ้ำ ที่แถวมี PO No. และสถานะยังไม่ Completed/Cancelled (รวม PO ที่ยังรออนุมัติ)"
            lines={[`จาก ${n(k.openPo.rowCount)} รายการ`]} />
          <Card label="Pending PR → PO" color="var(--warning)" value={n(p.count)}
            title="มีเลข PR แต่ยังไม่มีเลข PO และยังไม่ Completed/Cancelled — อายุ = วันนี้ − Date PR"
            lines={[
              `ยังไม่มี PA ${n(p.noPa)} · มี PA รอ PO ${n(p.hasPaNoPo)}`,
              p.aging.n ? `อายุ มัธยฐาน ${d(p.aging.medianDays)} · เฉลี่ย ${d(p.aging.avgDays)} · นานสุด ${d(p.aging.maxDays)}` : "อายุ —",
              p.aging.n ? `0–7 วัน ${n(p.aging.buckets[0])} · 8–30 วัน ${n(p.aging.buckets[1])} · เกิน 30 วัน ${n(p.aging.buckets[2])}` : "",
              p.unknownAge > 0 ? `ไม่มี Date PR ${n(p.unknownAge)} รายการ (ไม่นับในอายุ)` : "",
            ].filter(Boolean)} />
          <Card label="คิวรออนุมัติ" color="var(--warning)" value={n(q.pa.count + q.po.count)}
            title={`สถานะ Pending PA/PO Approval — รอนาน = วันนี้ − วันที่ส่งอนุมัติ, "เกินกำหนด" = รอเกิน ${STUCK_APPROVAL_DAYS} วัน`}
            lines={[
              `PA ${n(q.pa.count)} · รอนานสุด ${d(q.pa.oldestDays)} · เกิน ${STUCK_APPROVAL_DAYS} วัน ${n(q.pa.stuck)}`,
              `PO ${n(q.po.count)} · รอนานสุด ${d(q.po.oldestDays)} · เกิน ${STUCK_APPROVAL_DAYS} วัน ${n(q.po.stuck)}`,
            ]} />
          <Card label="เวลาอนุมัติ (มัธยฐาน)" color="var(--primary)" value={d(k.approvalTime.po.medianDays)}
            title="PO: Date PO Submitted → Approved · PA: Date PA Submitted → Approved (ตัดค่าติดลบและเกิน 365 วัน)"
            lines={[
              `PO ${d(k.approvalTime.po.medianDays)} · จาก ${n(k.approvalTime.po.n)} รายการ`,
              `PA ${d(k.approvalTime.pa.medianDays)} · จาก ${n(k.approvalTime.pa.n)} รายการ`,
            ]} />
          <Card label={`PO ที่เปิด ${k.throughput.monthLabel}`} color="var(--success)" value={n(k.throughput.thisMonth)}
            title="จำนวนเลข PO ไม่ซ้ำ ที่ Date PO Submitted อยู่ในเดือนนี้ เทียบเดือนก่อน (เดือนนี้ยังไม่จบ)"
            lines={[
              `เดือนก่อน ${n(k.throughput.lastMonth)}${delta === null ? "" : ` (${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}%)`}`,
              "เดือนนี้ยังไม่จบ",
            ]} />
        </div>
      </div>

      <details open style={{ ...card, padding: "var(--sp-3) var(--sp-4)" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--text-strong)", fontSize: "var(--fs-sm)" }}>
          ตัวชี้วัดที่ต้องรอข้อมูลจากทีม
          <span style={{ fontWeight: 400, color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>
            {" "}— จะแสดงตัวเลขเมื่อมีข้อมูลอย่างน้อย {Math.round(MIN_COVERAGE * 100)}% และ {MIN_SAMPLE} รายการ
          </span>
        </summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--sp-3)", marginTop: "var(--sp-3)" }}>
          <DataCard label="มูลค่า PO ที่ยังดำเนินอยู่" cov={k.openPo.priceCoverage}
            value={fmtBaht(k.openPo.value)} extra={k.openPo.priceCoverage.ready ? "รวม VAT 7%" : undefined}
            need="ต้องกรอก Qty และราคา/หน่วย"
            title="ผลรวม (จำนวน × ราคา/หน่วย − ส่วนลด + VAT 7%) ของ PO ที่ยังดำเนินอยู่" />
          <DataCard label="On-Time Delivery" cov={k.onTimeDelivery.coverage}
            value={k.onTimeDelivery.pct === null ? null : `${k.onTimeDelivery.pct}%`}
            extra={k.onTimeDelivery.coverage.ready ? `ตรงเวลา ${n(k.onTimeDelivery.onTime)} จาก ${n(k.onTimeDelivery.coverage.measured)}` : undefined}
            need="ต้องกรอกวันต้องการสินค้า และวันทำรับ"
            title="สัดส่วนรายการที่ ทำรับ ≤ วันต้องการสินค้า — ฐานคือทุกรายการที่ Completed หรือมีวันทำรับ" />
          <DataCard label="At-Risk / Overdue" cov={k.atRisk.coverage}
            value={n(k.atRisk.count)} extra={!k.atRisk.coverage.ready && k.atRisk.count > 0 ? `พบเลยกำหนดแล้ว ${n(k.atRisk.count)} รายการ จากที่มีข้อมูล` : undefined}
            need="ต้องกรอกวันต้องการสินค้า"
            title="เลยวันต้องการสินค้า ยังไม่มีวันทำรับ และยังไม่ Completed/Cancelled" />
        </div>

        <div style={{ marginTop: "var(--sp-4)" }}>
          <div style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--text-strong)" }}>ข้อมูลที่ยังต้องเติมใน Google Sheet</div>
          <p style={{ margin: "2px 0 var(--sp-2)", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
            นับเฉพาะ PO ที่ยังดำเนินอยู่ (เติมแค่กลุ่มนี้ก็พอให้ตัวชี้วัดข้างบนเริ่มทำงาน)
            {scope !== "all" && <> · ของคนนี้: ไม่มีวันต้องการสินค้า {n(gapsAll.noNeededDate)} · ไม่มีราคา/จำนวน {n(gapsAll.noPrice)} จาก {n(gapsAll.openPoRows)} รายการ</>}
          </p>
          {scope === "all" && (
            gapsByPerson.length === 0 ? (
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>ไม่มี PO ที่ยังดำเนินอยู่</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" }}>
                  <thead>
                    <tr style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", fontSize: "var(--fs-xs)" }}>
                      <th style={{ ...th, textAlign: "left" }}>ชื่อ</th>
                      <th style={th}>PO ที่ดำเนินอยู่ (รายการ)</th>
                      <th style={th}>ไม่มีวันต้องการสินค้า</th>
                      <th style={th}>ไม่มีราคา/จำนวน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gapsByPerson.map(({ name, g }) => (
                      <tr key={name} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ ...td, textAlign: "left", fontWeight: 700, color: "var(--text-strong)" }}>{name}</td>
                        <td style={td}>{n(g.openPoRows)}</td>
                        <td style={{ ...td, color: g.noNeededDate ? "var(--warning)" : "var(--text-faint)" }}>{n(g.noNeededDate)}</td>
                        <td style={{ ...td, color: g.noPrice ? "var(--warning)" : "var(--text-faint)" }}>{n(g.noPrice)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid var(--border-strong)", fontWeight: 800, color: "var(--text-strong)", background: "var(--bg-elevated)" }}>
                      <td style={{ ...td, textAlign: "left" }}>รวมทั้งทีม</td>
                      <td style={td}>{n(gapsAll.openPoRows)}</td>
                      <td style={td}>{n(gapsAll.noNeededDate)}</td>
                      <td style={td}>{n(gapsAll.noPrice)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </details>
    </div>
  );
}
