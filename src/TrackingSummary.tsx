import type { TrackingStats, StageBreakdown } from "./data/trackingStats";
import { STAGE_SLA_DAYS } from "./data/trackingStats";
import { IconAlertTriangle } from "@tabler/icons-react";

const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
  padding: "var(--sp-4)", position: "relative",
};

const days = (v: number | null) => (v === null ? "—" : `${v}`);

/** The five headline numbers plus the 3-stage lead-time breakdown, used for
 *  the whole team and for one person. The single overall "PR -> PO" figure
 *  is broken into its 3 stages so a slow step is visible at a glance, with
 *  a bottleneck badge on whichever stage is furthest over its SLA target. */
export function StatCards({ stats, stageStats }: { stats: TrackingStats; stageStats: StageBreakdown }) {
  const tile = (label: string, value: React.ReactNode, color: string, sub?: React.ReactNode, bottleneck?: boolean) => (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</div>
        {bottleneck && (
          <span style={{
            flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3,
            background: "color-mix(in srgb, var(--danger) 16%, transparent)", color: "var(--danger)",
            borderRadius: "var(--radius-full)", padding: "2px 8px", fontSize: "10px", fontWeight: 700,
          }}>
            <IconAlertTriangle size={11} stroke={2} /> Bottleneck
          </span>
        )}
      </div>
      <div style={{ fontSize: "var(--fs-h2)", fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const issuedPct = stats.total - stats.cancelled > 0 ? Math.round((stats.poIssued / (stats.total - stats.cancelled)) * 100) : 0;
  const stageTile = (n: 1 | 2 | 3, title: string, s: StageBreakdown["stage1"]) => {
    const sla = STAGE_SLA_DAYS[`stage${n}` as const];
    return tile(
      `Stage ${n}: ${title}`,
      <>{days(s.avg)}<span style={{ fontSize: "var(--fs-sm)", fontWeight: 500 }}> วัน</span></>,
      stageStats.bottleneck === n ? "var(--danger)" : "var(--primary)",
      `SLA ${sla} วัน · มัธยฐาน ${days(s.median)} วัน · จาก ${s.n.toLocaleString()} รายการ`,
      stageStats.bottleneck === n,
    );
  };
  const arrow = <div aria-hidden style={{ alignSelf: "center", color: "var(--text-faint)", fontSize: "1.4rem", lineHeight: 1 }}>→</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      {/* Work-flow order: Sourcing (PR) -> Approval (PA) -> PO issuance */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr)", gap: "var(--sp-2)" }}>
        {stageTile(1, "Sourcing (PR)", stageStats.stage1)}
        {arrow}
        {stageTile(2, "Approval (PA)", stageStats.stage2)}
        {arrow}
        {stageTile(3, "PO Issuance", stageStats.stage3)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "var(--sp-3)" }}>
        {tile("เปิดทั้งหมด (รายการ)", stats.total.toLocaleString(), "var(--text-strong)", `ยกเลิก ${stats.cancelled.toLocaleString()}`)}
        {tile("ออก PO แล้ว", stats.poIssued.toLocaleString(), "var(--success)", `${issuedPct}% ของที่ไม่ยกเลิก`)}
        {tile("ค้าง (Pending)", stats.pending.toLocaleString(), "var(--warning)",
          `รอ PA ${stats.waitingPA} · รอ PO ${stats.waitingPO} · พัก ${stats.onHold}`)}
        {tile("ค้างเกิน 30 วัน", stats.overdue30.toLocaleString(), stats.overdue30 ? "var(--danger)" : "var(--text-strong)", "นับจากวันที่ PR")}
        {tile("อายุงานค้างเฉลี่ย", <>{days(stats.avgAge)}<span style={{ fontSize: "var(--fs-sm)", fontWeight: 500 }}> วัน</span></>, "var(--text-strong)",
          `นานสุด ${days(stats.maxAge)} วัน`)}
      </div>
    </div>
  );
}

export function StatDefinitions({ badDates = 0 }: { badDates?: number }) {
  return (
    <>
    {badDates > 0 && (
      <p style={{ margin: "var(--sp-3) 0 0", fontSize: "var(--fs-xs)", color: "var(--warning)" }}>
        พบ {badDates.toLocaleString()} รายการที่วันที่ PR หรือ PO ผิดปกติ (เช่น ปี 0206, 1969) จึงไม่ถูกนำมาคำนวณจำนวนวัน — ตรวจแก้ได้ที่ Google Sheet
      </p>
    )}
    <p style={{ margin: "var(--sp-3) 0 0", fontSize: "var(--fs-xs)", color: "var(--text-faint)", lineHeight: 1.6 }}>
      เปิดทั้งหมด = ทุกรายการที่มีเลข PR/PA/PO (ไม่นับแถวที่จองเลขไว้เฉยๆ) · ออก PO แล้ว = มีเลข PO และไม่ถูกยกเลิก (นับซ้อนกับ "ค้าง" ได้ เช่น เปิด PO แล้วแต่ยังรออนุมัติ) ·
      ค้าง = สถานะยังไม่ Completed/Cancelled · Stage 1/2/3 = ระยะเวลาเฉลี่ยแต่ละช่วง (PR→ส่ง PA, ส่ง PA→อนุมัติ PA, อนุมัติ PA→ส่ง PO) เทียบกับ SLA ที่ตั้งไว้ — การ์ดไหนเกิน SLA มากสุดจะติดป้าย Bottleneck (ไม่นับที่ยกเลิก, ตัดค่าผิดปกติเกิน 365 วัน) ·
      อายุงานค้าง = จำนวนวันจาก Date PR ถึงวันนี้ของรายการที่ยังค้าง
    </p>
    </>
  );
}
