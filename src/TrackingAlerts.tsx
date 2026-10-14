import { useMemo } from "react";
import { IconAlertTriangle, IconArrowRight, IconFlagFilled } from "@tabler/icons-react";
import type { TrackingRow } from "./TrackingPage";
import { getStageProgress, agingBand } from "./data/trackingStats";
import { card, n } from "./components/KpiCards";

const TOP_N = 10;
const th: React.CSSProperties = { padding: "6px 8px", textAlign: "left", fontWeight: 700, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "7px 8px", whiteSpace: "nowrap" };

/** Top 10 High Priority Alerts: active rows that are flagged urgent and/or stuck
 *  past the 3-day SLA, ranked by (urgent first, then days in current stage).
 *  Replaces the old paginated urgent list — the full list lives in All Rows. */
export default function TrackingAlerts({ rows, onDrill, onOpenAllRows }: {
  rows: TrackingRow[];
  onDrill: (title: string, description: string, rows: TrackingRow[]) => void;
  onOpenAllRows: () => void;
}) {
  const { alerts, top } = useMemo(() => {
    const ranked = rows
      .map((r) => ({ r, p: getStageProgress(r) }))
      .filter(({ r, p }) => p.stage >= 0 && p.stage < 4 && (r.urgent || (p.daysInStage ?? 0) > 3))
      .sort((a, b) => (Number(!!b.r.urgent) - Number(!!a.r.urgent)) || ((b.p.daysInStage ?? 0) - (a.p.daysInStage ?? 0)));
    return { alerts: ranked, top: ranked.slice(0, TOP_N) };
  }, [rows]);

  return (
    <div style={card}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: "1rem", color: "var(--text-strong)" }}>
          <IconAlertTriangle size={18} stroke={1.75} style={{ color: "var(--danger)" }} /> Top {TOP_N} High Priority Alerts
          <span style={{ fontWeight: 400, fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>({n(alerts.length)} รายการที่ต้องติดตาม)</span>
        </h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {alerts.length > TOP_N && (
            <button type="button" onClick={() => onDrill("High Priority Alerts", "งานเร่งด่วน และ/หรือค้างในขั้นเดิมเกิน 3 วัน (เกิน SLA)", alerts.map((a) => a.r))}
              style={linkBtn}>ดูทั้งหมด {n(alerts.length)} รายการ (ทั้งทีม)</button>
          )}
          <button type="button" onClick={onOpenAllRows} style={{ ...linkBtn, color: "var(--primary)", borderColor: "var(--primary)" }}>
            ไปหน้า All Rows <IconArrowRight size={13} stroke={2} />
          </button>
        </div>
      </div>
      {top.length === 0 ? (
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-faint)" }}>ไม่มีงานเร่งด่วนหรือค้างเกิน SLA ในมุมมองนี้ 🎉</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-xs)" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", background: "var(--bg-elevated)" }}>
                <th style={{ ...th, width: 24 }}></th>
                <th style={th}>PR / PO No.</th>
                <th style={th}>ผู้รับผิดชอบ</th>
                <th style={th}>Project</th>
                <th style={th}>ขั้นปัจจุบัน</th>
                <th style={{ ...th, textAlign: "right" }}>ค้างในขั้น</th>
              </tr>
            </thead>
            <tbody>
              {top.map(({ r, p }) => {
                const band = agingBand(p.daysInStage);
                const c = band === "red" ? "var(--danger)" : band === "amber" ? "var(--warning)" : "var(--success)";
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>{r.urgent && <IconFlagFilled size={13} stroke={1.75} style={{ color: "var(--danger)" }} />}</td>
                    <td style={{ ...td, fontWeight: 700, color: "var(--text-strong)" }}>{r.poNo || r.prNo || "—"}</td>
                    <td style={{ ...td, color: "var(--text-muted)" }}>{r.personName || r.company || "—"}</td>
                    <td style={{ ...td, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-muted)" }} title={r.project}>{r.project || "—"}</td>
                    <td style={td}>{p.label}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {p.daysInStage === null ? "—" : (
                        <span style={{ display: "inline-block", minWidth: 34, textAlign: "center", fontWeight: 700, fontSize: "10.5px", color: c, background: `color-mix(in srgb, ${c} 15%, transparent)`, borderRadius: "var(--radius-full)", padding: "2px 8px" }}>{p.daysInStage}d</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 600,
  color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-full)", padding: "5px 12px", cursor: "pointer",
};
