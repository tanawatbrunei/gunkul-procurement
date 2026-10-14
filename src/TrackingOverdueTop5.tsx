import { useMemo } from "react";
import type { TrackingRow } from "./TrackingPage";
import { getStageProgress, STAGE_LABELS } from "./data/trackingStats";
import { groupBy } from "./data/trackingBottleneck";
import { card, n } from "./components/KpiCards";

/** Calendar days in the current stage beyond which an active row is "over SLA". */
const SLA_DAYS = 3;
const TOP_N = 5;

interface OverdueGroup {
  name: string; count: number; maxDays: number; avgDays: number; worstStage: string; rows: TrackingRow[];
}

/** Active rows sitting in their current stage longer than the SLA, grouped by a
 *  free-text name field (project / vendor); top N by how many rows are late. */
function topOverdue(rows: TrackingRow[], field: "project" | "vendor") {
  const late = rows
    .map((r) => ({ r, p: getStageProgress(r) }))
    .filter(({ p }) => p.stage >= 0 && p.stage < 4 && (p.daysInStage ?? 0) > SLA_DAYS);
  const { groups, unnamed, display } = groupBy(late.map((x) => x.r), field);
  const stageOf = new Map(late.map((x) => [x.r.id, x.p]));
  const out: OverdueGroup[] = [];
  for (const [, g] of groups) {
    const days = g.rows.map((r) => stageOf.get(r.id)?.daysInStage ?? 0);
    const stageCount = new Map<number, number>();
    g.rows.forEach((r) => { const s = stageOf.get(r.id)!.stage; stageCount.set(s, (stageCount.get(s) ?? 0) + 1); });
    const worst = [...stageCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      name: display(g), count: g.rows.length, maxDays: Math.max(...days),
      avgDays: Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10,
      worstStage: STAGE_LABELS[worst], rows: g.rows,
    });
  }
  out.sort((a, b) => b.count - a.count || b.maxDays - a.maxDays);
  return { top: out.slice(0, TOP_N), total: out.length, unnamed, lateTotal: late.length };
}

const th: React.CSSProperties = { padding: "6px 8px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "7px 8px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

function Table({ title, data, onDrill, drillLabel }: {
  title: string; data: ReturnType<typeof topOverdue>;
  onDrill: (title: string, description: string, rows: TrackingRow[]) => void; drillLabel: string;
}) {
  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 var(--sp-2)", fontSize: "1rem", color: "var(--text-strong)" }}>{title}</h3>
      {data.top.length === 0 ? (
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>ไม่มีรายการที่ค้างเกิน SLA ที่ระบุชื่อได้</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-xs)" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", background: "var(--bg-elevated)" }}>
                <th style={{ ...th, textAlign: "left", width: 24 }}>#</th>
                <th style={{ ...th, textAlign: "left" }}>ชื่อ</th>
                <th style={th}>เกิน SLA</th>
                <th style={th}>นานสุด</th>
                <th style={th}>เฉลี่ย</th>
                <th style={{ ...th, textAlign: "left" }}>ค้างที่ขั้น</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((g, i) => (
                <tr key={g.name + i} onClick={() => onDrill(`${drillLabel}: ${g.name}`, `รายการที่ค้างในขั้นเดิมเกิน ${SLA_DAYS} วัน (เกิน SLA) ของ ${g.name}`, g.rows)}
                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }} title="คลิกเพื่อดูรายการ">
                  <td style={{ ...td, textAlign: "left", color: "var(--text-faint)" }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontWeight: 600, color: "var(--text-strong)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }} title={g.name}>{g.name}</td>
                  <td style={{ ...td, fontWeight: 700, color: "var(--danger)" }}>{n(g.count)}</td>
                  <td style={td}>{g.maxDays}d</td>
                  <td style={{ ...td, color: "var(--text-muted)" }}>{g.avgDays}d</td>
                  <td style={{ ...td, textAlign: "left", color: "var(--text-muted)" }}>{g.worstStage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: "var(--sp-2) 0 0", fontSize: "10.5px", color: "var(--text-faint)" }}>
        จากทั้งหมด {n(data.total)} รายชื่อ · ไม่ระบุชื่อ {n(data.unnamed)} จาก {n(data.lateTotal)} รายการที่เกิน SLA ไม่ถูกรวม
      </p>
    </div>
  );
}

/** Top 5 projects / vendors with the most rows stuck in their current stage
 *  beyond the SLA — a "who to chase today" list. SLA here = more than 3 days
 *  in the current stage (same band as the red badge in All Rows). */
export default function TrackingOverdueTop5({ rows, onDrill }: {
  rows: TrackingRow[]; onDrill: (title: string, description: string, rows: TrackingRow[]) => void;
}) {
  const byProject = useMemo(() => topOverdue(rows, "project"), [rows]);
  const byVendor = useMemo(() => topOverdue(rows, "vendor"), [rows]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "var(--sp-4)" }}>
      <Table title="Top 5 โปรเจกต์ที่ค้างเกิน SLA" data={byProject} onDrill={onDrill} drillLabel="โปรเจกต์" />
      <Table title="Top 5 Vendor ที่ค้างเกิน SLA" data={byVendor} onDrill={onDrill} drillLabel="Vendor" />
    </div>
  );
}
