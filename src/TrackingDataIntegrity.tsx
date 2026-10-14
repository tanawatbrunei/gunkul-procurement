import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { STATUS_OPTIONS, STATUS_COLOR } from "./TrackingPage";
import type { Tab, TrackingRow } from "./TrackingPage";
import { isPlaceholderRow } from "./data/trackingStats";
import { computeDataGaps } from "./data/trackingKpis";
import { card, n } from "./components/KpiCards";

const th: React.CSSProperties = { padding: "8px 10px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" };

/** Section 3 — Data Integrity & Team Workload: what each buyer still has to fill
 *  in on the Google Sheet (so the data-dependent KPIs can work), plus workload per
 *  person and the status mix. */
export default function TrackingDataIntegrity({ rows, tabs, rowsByTab, scope }: {
  rows: TrackingRow[]; tabs: Tab[]; rowsByTab: Record<string, TrackingRow[]>; scope: string;
}) {
  const gapsAll = useMemo(() => computeDataGaps(rows), [rows]);
  const gapsByPerson = useMemo(
    () => (scope === "all"
      ? tabs.map((t) => ({ id: t.id, name: t.name, g: computeDataGaps(rowsByTab[t.id] ?? []) }))
          .filter((x) => x.g.openPoRows > 0)
          .sort((a, b) => b.g.noNeededDate + b.g.noPrice - (a.g.noNeededDate + a.g.noPrice))
      : []),
    [scope, tabs, rowsByTab],
  );

  const workloadData = useMemo(
    () => (scope === "all" ? tabs.map((t) => ({ name: t.name, count: (rowsByTab[t.id] ?? []).filter((r) => !isPlaceholderRow(r)).length })) : []),
    [tabs, rowsByTab, scope],
  );
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const key = r.status && STATUS_OPTIONS.includes(r.status as never) ? r.status : "ไม่ระบุ";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return [...STATUS_OPTIONS, "ไม่ระบุ"].map((s) => ({ status: s, count: counts[s] ?? 0 })).filter((d) => d.count > 0);
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div style={card}>
        <div style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--text-strong)" }}>ข้อมูลที่ยังต้องเติมใน Google Sheet</div>
        <p style={{ margin: "2px 0 var(--sp-2)", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
          นับเฉพาะ PO ที่ยังดำเนินอยู่ (เติมแค่กลุ่มนี้ก็พอให้ตัวชี้วัดด้านบนเริ่มแม่นยำ)
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
                  {gapsByPerson.map(({ id, name, g }) => (
                    <tr key={id} style={{ borderTop: "1px solid var(--border)" }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "var(--sp-4)" }}>
        {scope === "all" && (
          <div style={card}>
            <h3 style={{ margin: "0 0 var(--sp-3)", fontSize: "1rem", color: "var(--text-strong)" }}>ปริมาณงานต่อคน</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={workloadData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" name="รายการ" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div style={card}>
          <h3 style={{ margin: "0 0 var(--sp-3)", fontSize: "1rem", color: "var(--text-strong)" }}>สถานะงาน</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={statusData} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="status" width={140} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="รายการ" radius={[0, 4, 4, 0]}>
                {statusData.map((d) => <Cell key={d.status} fill={STATUS_COLOR[d.status]?.fg ?? "var(--text-faint)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
