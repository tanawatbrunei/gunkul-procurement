import type { TrackingStats } from "./data/trackingStats";

const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
  padding: "var(--sp-4)",
};

const days = (v: number | null) => (v === null ? "—" : `${v}`);

/** The six headline numbers, used for the whole team and for one person. */
export function StatCards({ stats }: { stats: TrackingStats }) {
  const tile = (label: string, value: React.ReactNode, color: string, sub?: React.ReactNode) => (
    <div style={card}>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: "var(--fs-h2)", fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const issuedPct = stats.total - stats.cancelled > 0 ? Math.round((stats.poIssued / (stats.total - stats.cancelled)) * 100) : 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "var(--sp-3)" }}>
      {tile("เปิดทั้งหมด (รายการ)", stats.total.toLocaleString(), "var(--text-strong)", `ยกเลิก ${stats.cancelled.toLocaleString()}`)}
      {tile("ออก PO แล้ว", stats.poIssued.toLocaleString(), "var(--success)", `${issuedPct}% ของที่ไม่ยกเลิก`)}
      {tile("ค้าง (Pending)", stats.pending.toLocaleString(), "var(--warning)",
        `รอ PA ${stats.waitingPA} · รอ PO ${stats.waitingPO} · พัก ${stats.onHold}`)}
      {tile("ค้างเกิน 30 วัน", stats.overdue30.toLocaleString(), stats.overdue30 ? "var(--danger)" : "var(--text-strong)", "นับจากวันที่ PR")}
      {tile("เฉลี่ย PR → เปิด PO", <>{days(stats.avgDays)}<span style={{ fontSize: "var(--fs-sm)", fontWeight: 500 }}> วัน</span></>, "var(--primary)",
        `มัธยฐาน ${days(stats.medianDays)} วัน · จาก ${stats.cycleN.toLocaleString()} รายการ`)}
      {tile("อายุงานค้างเฉลี่ย", <>{days(stats.avgAge)}<span style={{ fontSize: "var(--fs-sm)", fontWeight: 500 }}> วัน</span></>, "var(--text-strong)",
        `นานสุด ${days(stats.maxAge)} วัน`)}
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
      ค้าง = สถานะยังไม่ Completed/Cancelled · เฉลี่ย PR → เปิด PO = จาก Date PR ถึง Date PO Submitted (ไม่นับที่ยกเลิก, ตัดค่าผิดปกติเกิน 365 วัน) ·
      อายุงานค้าง = จำนวนวันจาก Date PR ถึงวันนี้ของรายการที่ยังค้าง
    </p>
    </>
  );
}
