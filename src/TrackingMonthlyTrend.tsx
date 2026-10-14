import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { IconChartBar } from "@tabler/icons-react";
import type { Tab, TrackingRow } from "./TrackingPage";
import { parseDate, isPlaceholderRow } from "./data/trackingStats";
import { card } from "./components/KpiCards";

/* Rows received per month, as a STACKED bar (one segment per person) instead of
   one line per person — easier to read total volume and each person's share at
   once. Person chips filter which people are drawn. Rows are the unit of work:
   PR/PA/PO is many-to-many, so deduping by PR No. would drop distinct work. */
const TH_MONTHS_SHORT = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function monthKey(dateStr: string | undefined): string | null {
  const d = parseDate(dateStr);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : null;
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${TH_MONTHS_SHORT[parseInt(m, 10)]} ${String((parseInt(y, 10) + 543) % 100).padStart(2, "0")}`;
}
function countByMonth(rows: TrackingRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) { const m = monthKey(r.prDate); if (m) out[m] = (out[m] ?? 0) + 1; }
  return out;
}
// Fixed categorical order (never reassigned when the person list is filtered).
const PERSON_PALETTE = ["#7CA6D8", "#8FCBAE", "#F2B6A0", "#D6B8E0", "#F4D58D", "#9AD0D6", "#C9B7A0", "#A8B8D8", "#E3A6B5", "#B5D99C", "#F0C27B", "#9DB4E8"];

export default function TrackingMonthlyTrend({ tabs, rowsByTab, scope, trackedRows }: {
  tabs: Tab[]; rowsByTab: Record<string, TrackingRow[]>; scope: string; trackedRows: TrackingRow[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (name: string) => setHidden((s) => { const x = new Set(s); if (x.has(name)) x.delete(name); else x.add(name); return x; });

  const people = useMemo(() => tabs.map((t, i) => ({ name: t.name, color: PERSON_PALETTE[i % PERSON_PALETTE.length], id: t.id })), [tabs]);

  const { chartData, series } = useMemo(() => {
    const groups = scope === "all"
      ? people.filter((p) => !hidden.has(p.name)).map((p) => ({ key: p.name, color: p.color, counts: countByMonth((rowsByTab[p.id] ?? []).filter((r) => !isPlaceholderRow(r))) }))
      : [{ key: people.find((p) => p.id === scope)?.name ?? "รายการ", color: PERSON_PALETTE[0], counts: countByMonth(trackedRows) }];
    const months = new Set<string>();
    groups.forEach((g) => Object.keys(g.counts).forEach((m) => months.add(m)));
    // Start at Jan 2026 (2569) — older months are mostly empty and flatten the chart.
    const sorted = [...months].filter((m) => m >= "2026-01").sort();
    return {
      series: groups,
      chartData: sorted.map((m) => {
        const pt: Record<string, number | string> = { month: m, monthLabel: monthLabel(m) };
        let total = 0;
        groups.forEach((g) => { const v = g.counts[m] ?? 0; pt[g.key] = v; total += v; });
        pt.total = total;
        return pt;
      }),
    };
  }, [scope, people, hidden, rowsByTab, trackedRows]);

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 var(--sp-2)", display: "flex", alignItems: "center", gap: 6, fontSize: "1rem", color: "var(--text-strong)" }}>
        <IconChartBar size={18} stroke={1.75} style={{ color: "var(--primary)" }} /> จำนวนรายการที่ได้รับต่อเดือน{scope === "all" ? " (แยกตามคน)" : ""}
      </h3>
      {scope === "all" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "var(--sp-3)", alignItems: "center" }}>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>แสดง:</span>
          {people.map((p) => {
            const on = !hidden.has(p.name);
            return (
              <button key={p.id} type="button" onClick={() => toggle(p.name)} aria-pressed={on}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, font: "inherit", fontSize: "var(--fs-xs)", cursor: "pointer",
                  border: `1px solid ${on ? p.color : "var(--border)"}`, background: on ? `color-mix(in srgb, ${p.color} 18%, transparent)` : "transparent",
                  color: on ? "var(--text)" : "var(--text-faint)", borderRadius: "var(--radius-full)", padding: "3px 10px", opacity: on ? 1 : 0.6,
                }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />{p.name}
              </button>
            );
          })}
          {hidden.size > 0 && (
            <button type="button" onClick={() => setHidden(new Set())}
              style={{ font: "inherit", fontSize: "var(--fs-xs)", background: "none", border: "none", color: "var(--primary)", cursor: "pointer", textDecoration: "underline" }}>แสดงทั้งหมด</button>
          )}
        </div>
      )}
      {chartData.length === 0 ? (
        <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)" }}>ยังไม่มีข้อมูลวันที่ PR ให้แสดงแนวโน้มรายเดือน</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const total = (payload[0].payload as { total: number }).total;
                return (
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)" }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{label} · รวม {total}</div>
                    {[...payload].reverse().filter((p) => Number(p.value) > 0).map((p) => (
                      <div key={String(p.dataKey)} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />{p.name}: {String(p.value)}
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.key} stackId="m" fill={s.color} />)}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
