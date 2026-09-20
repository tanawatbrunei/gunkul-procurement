import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { IconHourglass } from "@tabler/icons-react";
import type { TrackingRow } from "./TrackingPage";
import { computeTrackingKpis, MIN_COVERAGE, MIN_SAMPLE } from "./data/trackingKpis";
import {
  CYCLE_STAGES, MIN_STAGE_SAMPLE, computeLeadTimeByProject, computePendingByProject, computeOverdue,
} from "./data/trackingBottleneck";
import type { OverdueGroup } from "./data/trackingBottleneck";

const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--sp-4)",
};
const mutedCard: React.CSSProperties = { ...card, background: "transparent", border: "1px dashed var(--border-strong)" };
const h3: React.CSSProperties = { margin: "0 0 var(--sp-1)", fontSize: "1rem", color: "var(--text-strong)" };
const note: React.CSSProperties = { fontSize: "var(--fs-xs)", color: "var(--text-faint)", lineHeight: 1.6 };

// One colour per pipeline stage (fixed order, never reassigned).
const STAGE_COLORS = ["#7CA6D8", "#F4D58D", "#D6B8E0", "#8FCBAE"];
const AXIS_TICK = { fontSize: 11, fill: "var(--text-muted)" };

const n = (v: number) => v.toLocaleString("th-TH");
const pct = (share: number) => (share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);
const short = (s: string, max = 34) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function GroupBars({ title, data, color }: { title: string; data: OverdueGroup[]; color: string }) {
  return (
    <div style={card}>
      <h3 style={h3}>{title}</h3>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34 + 40)}>
        <BarChart data={data.map((d) => ({ ...d, label: short(d.name) }))} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} />
          <YAxis type="category" dataKey="label" width={230} tick={AXIS_TICK} />
          <Tooltip formatter={(v) => [`${v} รายการ`, "เลยกำหนด"]} labelFormatter={(_l, p) => p?.[0]?.payload?.name ?? ""} />
          <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function TrackingBottleneckSection({ rows }: { rows: TrackingRow[] }) {
  const today = useMemo(() => new Date(), []);
  const lead = useMemo(() => computeLeadTimeByProject(rows, today), [rows, today]);
  const pending = useMemo(() => computePendingByProject(rows, today), [rows, today]);
  const overdue = useMemo(() => computeOverdue(rows, today), [rows, today]);
  const cov = useMemo(() => computeTrackingKpis(rows, () => 0, today).atRisk.coverage, [rows, today]);

  const leadChart = lead.projects.map((p) => ({
    name: p.name, label: short(p.name), total: p.total, rows: p.rows,
    ...Object.fromEntries(p.stages.map((s, i) => [`s${i}`, s.median ?? 0])),
    ...Object.fromEntries(p.stages.map((s, i) => [`n${i}`, s.n])),
  }));
  // Which stage is the slowest most often across the shown projects?
  const slowCounts = CYCLE_STAGES.map((_, i) => lead.projects.filter((p) => p.slowest === i).length);
  const topStage = slowCounts.some((c) => c > 0) ? slowCounts.indexOf(Math.max(...slowCounts)) : null;

  const th: React.CSSProperties = { padding: "8px 10px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text-strong)" }}>จุดคอขวด (Bottleneck)</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "var(--sp-4)" }}>
        {/* Lead time per stage, per project */}
        <div style={card}>
          <h3 style={h3}>เวลาที่ใช้แต่ละขั้นตอน แยกตามโปรเจกต์ — มัธยฐาน (วัน)</h3>
          {leadChart.length === 0 ? (
            <div style={{ ...note, padding: "var(--sp-3) 0" }}>ยังไม่มีโปรเจกต์ที่มีข้อมูลวันที่เพียงพอ (ต้องมีอย่างน้อย {MIN_STAGE_SAMPLE} รายการต่อขั้นตอน)</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={leadChart.length * 34 + 80}>
                <BarChart data={leadChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={AXIS_TICK} />
                  <YAxis type="category" dataKey="label" width={230} tick={AXIS_TICK} />
                  <Legend wrapperStyle={{ fontSize: 11 }} itemSorter="dataKey" />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as Record<string, number | string>;
                      return (
                        <div style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }}>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name} <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>({n(Number(p.rows))} รายการ)</span></div>
                          {CYCLE_STAGES.map((s, i) => (
                            <div key={s.label}>{s.label}: {Number(p[`n${i}`]) >= MIN_STAGE_SAMPLE ? `${p[`s${i}`]} วัน` : "ข้อมูลไม่พอ"} <span style={{ color: "var(--text-faint)" }}>(n={p[`n${i}`]})</span></div>
                          ))}
                          <div style={{ marginTop: 4, fontWeight: 700 }}>รวมโดยประมาณ {p.total} วัน</div>
                        </div>
                      );
                    }}
                  />
                  {CYCLE_STAGES.map((s, i) => (
                    <Bar key={s.label} dataKey={`s${i}`} name={s.short} stackId="lead" fill={STAGE_COLORS[i]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <p style={{ ...note, margin: "var(--sp-2) 0 0" }}>
                {topStage !== null && <>ขั้นตอนที่ช้าที่สุดบ่อยที่สุด: <b style={{ color: "var(--text-strong)" }}>{CYCLE_STAGES[topStage].label}</b> ({slowCounts[topStage]} จาก {lead.projects.length} โปรเจกต์ที่แสดง) · </>}
                แสดง {lead.projects.length} โปรเจกต์แรกตามจำนวนรายการ จากทั้งหมด {n(lead.totalProjects)} · ขั้นตอนที่มีข้อมูลน้อยกว่า {MIN_STAGE_SAMPLE} รายการไม่นำมาคิด · ไม่มีชื่อโปรเจกต์ {n(lead.noProject)} รายการ ({pct(lead.noProjectShare)}) ไม่ถูกรวม
              </p>
            </>
          )}
        </div>

        {/* Pending PR->PO aging per project */}
        <div style={card}>
          <h3 style={h3}>งานค้าง PR → PO แยกตามโปรเจกต์</h3>
          <p style={{ ...note, margin: "0 0 var(--sp-2)" }}>อายุ = วันนี้ − Date PR (เฉพาะรายการที่มี PR แต่ยังไม่มี PO และยังไม่ปิด)</p>
          {pending.projects.length === 0 ? (
            <div style={note}>ไม่มีงานค้าง</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", fontSize: "var(--fs-xs)" }}>
                    <th style={{ ...th, textAlign: "left" }}>โปรเจกต์</th>
                    <th style={th}>ค้าง</th>
                    <th style={th}>อายุมัธยฐาน</th>
                    <th style={th}>เกิน 30 วัน</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.projects.map((p) => (
                    <tr key={p.name} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 600, color: "var(--text-strong)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</td>
                      <td style={td}>{n(p.pending)}</td>
                      <td style={td}>{p.medianAge === null ? "—" : `${p.medianAge} วัน`}</td>
                      <td style={{ ...td, color: p.over30 ? "var(--danger)" : "var(--text-faint)", fontWeight: p.over30 ? 700 : 400 }}>{n(p.over30)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ ...note, margin: "var(--sp-2) 0 0" }}>
            แสดง {pending.projects.length} โปรเจกต์แรกตามจำนวนที่ค้าง จากทั้งหมด {n(pending.totalProjects)} · ไม่มีชื่อโปรเจกต์ {n(pending.noProject)} จาก {n(pending.totalPending)} รายการที่ค้างไม่ถูกรวม
          </p>
        </div>
      </div>

      {/* Overdue by project / vendor — needs Needed Date */}
      {cov.ready ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "var(--sp-4)" }}>
          <GroupBars title={`รายการเลยกำหนดส่งมอบ แยกตามโปรเจกต์ (${n(overdue.rows.length)} รายการ)`} data={overdue.byProject} color="var(--danger)" />
          <GroupBars title="รายการเลยกำหนดส่งมอบ แยกตาม Vendor" data={overdue.byVendor} color="var(--warning)" />
        </div>
      ) : (
        <div style={mutedCard}>
          <h3 style={{ ...h3, color: "var(--text-muted)" }}>รายการเลยกำหนดส่งมอบ แยกตามโปรเจกต์และ Vendor</h3>
          <div style={{ ...note, color: "var(--warning)", display: "flex", gap: 4, alignItems: "flex-start" }}>
            <IconHourglass size={13} stroke={1.75} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              รอข้อมูล — มีวันต้องการสินค้าเพียง {n(cov.measured)} จาก {n(cov.applicable)} รายการที่ยังไม่ส่งมอบ ({pct(cov.share)})
              จะแสดงกราฟเมื่อมีอย่างน้อย {Math.round(MIN_COVERAGE * 100)}% และ {MIN_SAMPLE} รายการ
            </span>
          </div>
          {overdue.rows.length > 0 && (
            <div style={{ marginTop: "var(--sp-3)" }}>
              <div style={{ ...note, marginBottom: 4 }}>รายการที่เลยกำหนดแล้วจากข้อมูลที่มีอยู่ ({n(overdue.rows.length)} รายการ):</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-xs)" }}>
                  <thead>
                    <tr style={{ color: "var(--text-muted)" }}>
                      <th style={{ ...th, textAlign: "left" }}>PR / PO</th>
                      <th style={{ ...th, textAlign: "left" }}>โปรเจกต์</th>
                      <th style={{ ...th, textAlign: "left" }}>Vendor</th>
                      <th style={th}>วันต้องการ</th>
                      <th style={th}>เลยมา (วัน)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.rows.slice(0, 10).map((r) => (
                      <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{r.poNo || r.prNo || "—"}</td>
                        <td style={{ ...td, textAlign: "left" }}>{r.project || "—"}</td>
                        <td style={{ ...td, textAlign: "left" }}>{r.vendor || "—"}</td>
                        <td style={td}>{r.neededDate}</td>
                        <td style={{ ...td, color: "var(--danger)", fontWeight: 700 }}>{n(r.daysOverdue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
