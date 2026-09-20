import { useMemo } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { computeTrackingStats } from "./data/trackingStats";
import type { TrackingStats } from "./data/trackingStats";
import type { Tab, TrackingRow } from "./TrackingPage";

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

/** Landing view: everyone's numbers at a glance; click a person to open their tab. */
export default function TrackingSummary({
  tabs, rowsByTab, onOpenTab,
}: { tabs: Tab[]; rowsByTab: Record<string, TrackingRow[]>; onOpenTab: (tabId: string) => void }) {
  const perPerson = useMemo(
    () => tabs.map((t) => ({ tab: t, stats: computeTrackingStats(rowsByTab[t.id] ?? []) })),
    [tabs, rowsByTab],
  );
  const team = useMemo(() => computeTrackingStats(tabs.flatMap((t) => rowsByTab[t.id] ?? [])), [tabs, rowsByTab]);
  const loaded = tabs.every((t) => rowsByTab[t.id]);

  const th: React.CSSProperties = { padding: "10px 12px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div>
        <h2 style={{ margin: "0 0 var(--sp-3)", fontSize: "1.1rem", color: "var(--text-strong)" }}>ภาพรวมทั้งทีม</h2>
        <StatCards stats={team} />
        <StatDefinitions badDates={team.badDates} />
        {!loaded && <p style={{ margin: "var(--sp-2) 0 0", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>กำลังโหลดข้อมูลของทุกคน...</p>}
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--sp-4) var(--sp-4) var(--sp-2)" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text-strong)" }}>ผลงานรายคน</h2>
          <p style={{ margin: "2px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>คลิกชื่อหรือแถวเพื่อดูรายการทั้งหมดของคนนั้น</p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", fontSize: "var(--fs-xs)" }}>
                <th style={{ ...th, textAlign: "left" }}>ชื่อ</th>
                <th style={th}>เปิดทั้งหมด</th>
                <th style={th}>ออก PO แล้ว</th>
                <th style={th}>ค้าง</th>
                <th style={th}>ค้าง &gt;30 วัน</th>
                <th style={th}>เฉลี่ย PR→PO (วัน)</th>
                <th style={th}>มัธยฐาน (วัน)</th>
                <th style={th}>อายุงานค้างเฉลี่ย (วัน)</th>
                <th style={{ ...th, width: 24 }} />
              </tr>
            </thead>
            <tbody>
              {perPerson.map(({ tab, stats: s }) => (
                <tr key={tab.id} onClick={() => onOpenTab(tab.id)}
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700, color: "var(--text-strong)" }}>{tab.name}</td>
                  <td style={td}>{s.total.toLocaleString()}</td>
                  <td style={{ ...td, color: "var(--success)", fontWeight: 700 }}>{s.poIssued.toLocaleString()}</td>
                  <td style={{ ...td, color: s.pending ? "var(--warning)" : "var(--text-faint)", fontWeight: 700 }}>{s.pending.toLocaleString()}</td>
                  <td style={{ ...td, color: s.overdue30 ? "var(--danger)" : "var(--text-faint)", fontWeight: s.overdue30 ? 700 : 400 }}>{s.overdue30.toLocaleString()}</td>
                  <td style={td}>{days(s.avgDays)}</td>
                  <td style={td}>{days(s.medianDays)}</td>
                  <td style={td}>{days(s.avgAge)}</td>
                  <td style={{ ...td, color: "var(--text-faint)" }}><IconChevronRight size={16} stroke={1.75} /></td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--border-strong)", fontWeight: 800, color: "var(--text-strong)", background: "var(--bg-elevated)" }}>
                <td style={{ ...td, textAlign: "left" }}>รวมทั้งทีม</td>
                <td style={td}>{team.total.toLocaleString()}</td>
                <td style={td}>{team.poIssued.toLocaleString()}</td>
                <td style={td}>{team.pending.toLocaleString()}</td>
                <td style={td}>{team.overdue30.toLocaleString()}</td>
                <td style={td}>{days(team.avgDays)}</td>
                <td style={td}>{days(team.medianDays)}</td>
                <td style={td}>{days(team.avgAge)}</td>
                <td style={td} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
