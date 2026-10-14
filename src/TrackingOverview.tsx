import { useMemo, useState } from "react";
import { useTrackingRowsByTab } from "./data/useTrackingRows";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { IconClockHour4, IconX, IconAlertTriangle } from "@tabler/icons-react";
import { normalizeStatus } from "./TrackingPage";
import type { TrackingRow, Tab } from "./TrackingPage";
import { parseDate, daysBetween, isPlaceholderRow, STAGE_SLA_DAYS } from "./data/trackingStats";
import TrackingKpiSection from "./TrackingKpiSection";
import TrackingBottleneckSection from "./TrackingBottleneckSection";
import TrackingSpendSection from "./TrackingSpendSection";
import TrackingOverdueTop5 from "./TrackingOverdueTop5";
import TrackingMonthlyTrend from "./TrackingMonthlyTrend";
import TrackingDataIntegrity from "./TrackingDataIntegrity";
import TrackingAlerts from "./TrackingAlerts";
import type { DrilldownRequest } from "./TrackingDrilldownView";
import { CYCLE_STAGES } from "./data/trackingBottleneck";

/* ============================================================
   Summary / management page, in executive-priority order:
     1. Executive KPI Summary
     2. Process & Bottleneck Analytics
     3. Data Integrity & Team Workload (+ Top 10 alerts)

   Cycle-time analysis — average calendar days spent in each stage
   of the PR -> PA -> PO pipeline, so the team can see which step is
   the actual bottleneck instead of guessing. Delivery isn't tracked
   consistently by the team, so it's excluded here. Only rows with
   BOTH boundary dates present (and a plausible <1yr gap, to ignore
   obvious typos) count toward a stage's average. The stage list itself
   (CYCLE_STAGES) lives in data/trackingBottleneck.ts, shared with the
   per-project bottleneck section.
   ============================================================ */

const cardStyle: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
  padding: "var(--sp-4)",
};

/** SLA (days) per cycle stage, by CYCLE_STAGES index; the last stage (PO approval) has none. */
const STAGE_SLA_BY_INDEX: (number | null)[] = [STAGE_SLA_DAYS.stage1, STAGE_SLA_DAYS.stage2, STAGE_SLA_DAYS.stage3, null];

function Section({ no, title, subtitle, children }: { no: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-2)", borderBottom: "1px solid var(--border)", paddingBottom: "var(--sp-2)" }}>
        <span style={{ fontSize: "var(--fs-xs)", fontWeight: 800, color: "var(--accent)" }}>{no}</span>
        <h2 style={{ margin: 0, fontSize: "1.15rem", color: "var(--text-strong)" }}>{title}</h2>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

interface CycleTimeEntry {
  id: string;
  prNo?: string;
  company?: string;
  project?: string;
  days: number;
  fromDate: string;
  toDate: string;
}

/* Drill-down: proof behind the median, not just the number. Lets the team
   check whether the slowest PRs in a stage are legitimate special cases
   (a paused project, etc.) or genuinely stuck with no reason — click any
   bar in the cycle-time chart to open this for that stage. */
function CycleTimeDrilldownModal({
  stage, entries, onClose,
}: { stage: string; entries: CycleTimeEntry[]; onClose: () => void }) {
  const top = entries.slice(0, 10);
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: "var(--sp-4)" }}
    >
      <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)", width: "min(760px, 100%)", maxHeight: "85vh", overflowY: "auto", padding: "var(--sp-5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-2)" }}>
          <h3 style={{ margin: 0, color: "var(--text-strong)" }}>PR ที่ใช้เวลานานที่สุด: {stage}</h3>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)" }}>
            <IconX size={20} stroke={1.75} />
          </button>
        </div>
        <p style={{ margin: "0 0 var(--sp-4)", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
          Top {top.length} จากทั้งหมด {entries.length} รายการที่มีข้อมูลครบในขั้นตอนนี้ (ไม่รวมรายการที่ถูกยกเลิก) — ใช้ตรวจสอบว่ารายการที่ใช้เวลานาน
          เป็นเคสพิเศษ (โปรเจกต์พักไว้ ฯลฯ) หรือค้างโดยไม่มีเหตุผล
        </p>
        {top.length === 0 ? (
          <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)" }}>ไม่มีข้อมูล</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-xs)" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                <th style={{ padding: "6px 8px" }}>PR No.</th>
                <th style={{ padding: "6px 8px" }}>Company</th>
                <th style={{ padding: "6px 8px" }}>Project</th>
                <th style={{ padding: "6px 8px" }}>จากวันที่</th>
                <th style={{ padding: "6px 8px" }}>ถึงวันที่</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>จำนวนวัน</th>
              </tr>
            </thead>
            <tbody>
              {top.map((e) => (
                <tr key={e.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{e.prNo || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{e.company || "—"}</td>
                  <td style={{ padding: "6px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.project || "—"}</td>
                  <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{e.fromDate}</td>
                  <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{e.toDate}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "var(--danger)" }}>{e.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function TrackingOverview({ tabs, onDrill, onOpenAllRows }: {
  tabs: Tab[]; onDrill: (r: DrilldownRequest) => void; onOpenAllRows: () => void;
}) {
  const rawRowsByTab = useTrackingRowsByTab(tabs);
  const rowsByTab = useMemo(() => {
    const out: Record<string, TrackingRow[]> = {};
    for (const id of Object.keys(rawRowsByTab)) out[id] = rawRowsByTab[id].map((r) => ({ ...r, status: normalizeStatus(r.status) }));
    return out;
  }, [rawRowsByTab]);
  const [scope, setScope] = useState<string>("all");

  // Tag every row with which person's tab it came from — not stored in
  // Firestore, just so a team-wide ("ทุกคน") list can show who each row
  // belongs to (alerts table, drill-down view).
  const rows = useMemo(() => {
    if (scope === "all") return tabs.flatMap((t) => (rowsByTab[t.id] ?? []).map((r) => ({ ...r, personName: t.name })));
    const name = tabs.find((t) => t.id === scope)?.name;
    return (rowsByTab[scope] ?? []).map((r) => ({ ...r, personName: name }));
  }, [rowsByTab, scope, tabs]);

  // Excludes placeholder rows (no PR/PA/PO No. at all — a reserved row
  // number with nothing tracked yet) from anything measuring "how much work
  // is there", so pre-added blank rows don't inflate the numbers.
  const trackedRows = useMemo(() => rows.filter((r) => !isPlaceholderRow(r)), [rows]);

  // Cancelled PRs sat idle because the request was abandoned, not because a
  // stage was slow — including them would count that idle time as real
  // process time and bias the whole cycle-time picture toward "everything
  // is slow" when it's really "a few dead requests never moved."
  const cycleTimeRows = useMemo(() => rows.filter((r) => r.status !== "Cancelled"), [rows]);

  const cycleTimeData = useMemo(() => {
    return CYCLE_STAGES.map(({ label, from, to }, i) => {
      const diffs: number[] = [];
      for (const r of cycleTimeRows) {
        const df = parseDate(r[from] as string | undefined);
        const dt = parseDate(r[to] as string | undefined);
        if (!df || !dt) continue;
        const diff = daysBetween(df, dt);
        // Guard against obviously bad data (negative gaps, >1yr typos) so a
        // handful of mis-keyed dates can't skew the result.
        if (diff >= 0 && diff <= 365) diffs.push(diff);
      }
      diffs.sort((a, b) => a - b);
      const n = diffs.length;
      // Median, not mean: procurement lead times are long-tailed (a handful of
      // stuck/backlog PRs can sit for months), so a straight average gets
      // dragged way above what most rows actually experience. Median reflects
      // the typical case; mean is kept alongside (tooltip) for transparency.
      const median = n === 0 ? 0 : n % 2 === 1 ? diffs[(n - 1) / 2] : (diffs[n / 2 - 1] + diffs[n / 2]) / 2;
      const mean = n === 0 ? 0 : diffs.reduce((a, b) => a + b, 0) / n;
      return {
        label,
        axisLabel: STAGE_SLA_BY_INDEX[i] != null ? `${label} (SLA ${STAGE_SLA_BY_INDEX[i]} วัน)` : label,
        sla: STAGE_SLA_BY_INDEX[i],
        medianDays: Math.round(median * 10) / 10,
        meanDays: Math.round(mean * 10) / 10,
        n,
      };
    });
  }, [cycleTimeRows]);

  const bottleneckStage = useMemo(() => {
    const withSamples = cycleTimeData.filter((d) => d.n > 0);
    if (!withSamples.length) return null;
    return withSamples.reduce((max, d) => (d.medianDays > max.medianDays ? d : max));
  }, [cycleTimeData]);

  // Per-stage list backing the drill-down modal — the actual rows behind
  // each stage's median/mean, so a bottleneck claim can be checked against
  // real PRs instead of taken on faith.
  const cycleTimeDetails = useMemo(() => {
    const details: Record<string, CycleTimeEntry[]> = {};
    for (const { label, from, to } of CYCLE_STAGES) {
      const list: CycleTimeEntry[] = [];
      for (const r of cycleTimeRows) {
        const df = parseDate(r[from] as string | undefined);
        const dt = parseDate(r[to] as string | undefined);
        if (!df || !dt) continue;
        const diff = daysBetween(df, dt);
        if (diff >= 0 && diff <= 365) {
          list.push({ id: r.id, prNo: r.prNo, company: r.company, project: r.project, days: diff, fromDate: r[from] as string, toDate: r[to] as string });
        }
      }
      list.sort((a, b) => b.days - a.days);
      details[label] = list;
    }
    return details;
  }, [cycleTimeRows]);

  const [drilldownStage, setDrilldownStage] = useState<string | null>(null);
  const drill = (title: string, description: string, drillRows: TrackingRow[]) =>
    onDrill({ title, description, rows: drillRows, crossPerson: scope === "all" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6, 2rem)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <label style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>มุมมอง:</label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          style={{ font: "inherit", fontSize: "var(--fs-xs)", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", padding: "8px 10px" }}
        >
          <option value="all">ทุกคน (ทีม)</option>
          {tabs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* ---------- 1. Executive KPI Summary ---------- */}
      <Section no={1} title="Executive KPI Summary" subtitle="ตัวเลขสำคัญประจำเดือน / ปี และงานที่ยังดำเนินอยู่">
        <TrackingKpiSection rows={trackedRows} onDrill={drill} />
      </Section>

      {/* ---------- 2. Process & Bottleneck Analytics ---------- */}
      <Section no={2} title="Process & Bottleneck Analytics" subtitle="เวลาที่ใช้แต่ละขั้นตอน จุดคอขวด และงานที่ค้างเกิน SLA">
        {/* Cycle time per pipeline stage */}
        <div style={cardStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-2)", marginBottom: "var(--sp-1)" }}>
            <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: "1rem", color: "var(--text-strong)" }}>
              <IconClockHour4 size={18} stroke={1.75} style={{ color: "var(--accent)" }} /> Stage Duration — เวลาที่ใช้แต่ละขั้นตอน (มัธยฐาน, วัน)
            </h3>
            {bottleneckStage && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-xs)", fontWeight: 700, color: "var(--danger)",
                background: "color-mix(in srgb, var(--danger) 14%, transparent)", borderRadius: "var(--radius-full)", padding: "3px 12px",
              }}>
                <IconAlertTriangle size={13} stroke={2} /> Bottleneck: {bottleneckStage.label} · {bottleneckStage.medianDays} วัน
              </span>
            )}
          </div>
          <p style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-xs)", color: "var(--text-faint)", lineHeight: 1.6 }}>
            {bottleneckStage
              ? <>แท่งสีแดง = ขั้นที่ช้าที่สุด · สีส้ม = เกิน SLA · คำนวณจากรายการที่มีวันที่ครบทั้งต้น-ปลายขั้น (ไม่รวมที่ยกเลิก) ใช้มัธยฐานเพราะบาง PR ค้างนานผิดปกติจนดึงค่าเฉลี่ยสูงเกินจริง · </>
              : <>ยังไม่มีข้อมูลวันที่ครบพอจะคำนวณ (ต้องมีทั้งวันเริ่มและวันจบของแต่ละขั้นตอน) · </>}
            💡 คลิกที่แท่งเพื่อดู PR ที่ใช้เวลานานที่สุดในขั้นนั้น
          </p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={cycleTimeData} layout="vertical" margin={{ left: 8, right: 56 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} unit=" วัน" />
              <YAxis type="category" dataKey="axisLabel" width={220} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value, _name, item) => {
                  const p = item?.payload as { n?: number; meanDays?: number; sla?: number | null } | undefined;
                  return [`มัธยฐาน ${value} วัน (เฉลี่ย ${p?.meanDays ?? 0} วัน จาก ${p?.n ?? 0} รายการ${p?.sla != null ? ` · SLA ${p.sla} วัน` : ""})`, "เวลาที่ใช้"];
                }}
              />
              <Bar
                dataKey="medianDays"
                radius={[0, 4, 4, 0]}
                onClick={(data: unknown) => {
                  const label = (data as { payload?: { label?: string } })?.payload?.label;
                  if (label) setDrilldownStage(label);
                }}
                style={{ cursor: "pointer" }}
              >
                {cycleTimeData.map((d) => (
                  <Cell key={d.label} fill={d.label === bottleneckStage?.label ? "var(--danger)" : d.sla != null && d.medianDays > d.sla ? "var(--warning)" : "var(--primary)"} />
                ))}
                <LabelList dataKey="medianDays" position="right" formatter={(v: unknown) => `${v} วัน`} style={{ fontSize: 11, fill: "var(--text-muted)" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {drilldownStage && (
          <CycleTimeDrilldownModal
            stage={drilldownStage}
            entries={cycleTimeDetails[drilldownStage] ?? []}
            onClose={() => setDrilldownStage(null)}
          />
        )}

        <TrackingOverdueTop5 rows={trackedRows} onDrill={drill} />

        <TrackingMonthlyTrend tabs={tabs} rowsByTab={rowsByTab} scope={scope} trackedRows={trackedRows} />

        <details style={{ ...cardStyle, padding: "var(--sp-3) var(--sp-4)" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--text-strong)", fontSize: "var(--fs-sm)" }}>
            รายละเอียดเพิ่มเติม: จุดคอขวดแยกโปรเจกต์ · ค่าใช้จ่ายและ Supplier
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)", marginTop: "var(--sp-4)" }}>
            <TrackingBottleneckSection rows={trackedRows} />
            <TrackingSpendSection rows={trackedRows} />
          </div>
        </details>
      </Section>

      {/* ---------- 3. Data Integrity & Team Workload ---------- */}
      <Section no={3} title="Data Integrity & Team Workload" subtitle="ข้อมูลที่ต้องเติม ภาระงานรายคน และงานที่ต้องติดตามด่วน">
        <TrackingAlerts rows={trackedRows} onDrill={drill} onOpenAllRows={onOpenAllRows} />
        <TrackingDataIntegrity rows={trackedRows} tabs={tabs} rowsByTab={rowsByTab} scope={scope} />
      </Section>
    </div>
  );
}
