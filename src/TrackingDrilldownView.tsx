import { useMemo, useState } from "react";
import { IconArrowLeft, IconExternalLink, IconFileSpreadsheet } from "@tabler/icons-react";
import * as XLSX from "xlsx";
import { computeMoney, baht } from "./TrackingPage";
import type { TrackingRow } from "./TrackingPage";

const MASTER_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1Ly5d83iQ2xLDHC0tyuBFNMtbC1ZQ9mB0Dnx1NH68pro/edit";

export interface DrilldownRequest {
  /** Card/section title, shown as the page heading. */
  title: string;
  /** One line explaining the filter, so the list is self-explanatory away from the card. */
  description: string;
  rows: TrackingRow[];
  /** True when rows come from more than one person (shows the "ชื่อ" column). */
  crossPerson: boolean;
}

const th: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontWeight: 700, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", textAlign: "left", whiteSpace: "nowrap" };
const n = (v: number) => v.toLocaleString("th-TH");

/** A read-only, filtered list of tracking rows reached by clicking a Summary
 *  card — proof behind the number, not just the count. Reuses the exact same
 *  row objects the KPI/bottleneck calc already filtered (see data/trackingKpis.ts
 *  and data/trackingBottleneck.ts), so this list can never disagree with the
 *  card that opened it. */
export default function TrackingDrilldownView({ request, onBack }: { request: DrilldownRequest; onBack: () => void }) {
  const { title, description, rows, crossPerson } = request;
  const [sortDesc, setSortDesc] = useState(true);

  // No single date field applies to every kind of drill-down (pending PR, approval
  // queue, overdue delivery, PO opened this month …), so order by row No. — stable
  // and already meaningful to the team as "the order things came in".
  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => ((a.no ?? 0) - (b.no ?? 0)) * (sortDesc ? -1 : 1));
    return copy;
  }, [rows, sortDesc]);

  const totalValue = useMemo(() => rows.reduce((s, r) => s + computeMoney(r).total, 0), [rows]);
  const hasMoney = rows.some((r) => (r.qty ?? 0) > 0 && (r.unitPrice ?? 0) > 0);

  const exportToExcel = () => {
    const data = sorted.map((r) => ({
      ...(crossPerson ? { ชื่อ: r.personName ?? "" } : {}),
      "No.": r.no ?? "", Company: r.company ?? "", "PR No.": r.prNo ?? "", "Date PR": r.prDate ?? "",
      "PA No.": r.paNo ?? "", "PO No.": r.poNo ?? "", Project: r.project ?? "", Vendor: r.vendor ?? "",
      Status: r.status ?? "", "วันต้องการสินค้า": r.neededDate ?? "", "ทำรับ": r.deliveredDate ?? "",
      Remark: r.remark ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Drilldown");
    XLSX.writeFile(wb, `${title}.xlsx`);
  };

  return (
    <div style={{ maxWidth: "1440px", margin: "0 auto", padding: "var(--sp-5)" }}>
      <button type="button" onClick={onBack}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--fs-sm)", padding: 0, marginBottom: "var(--sp-3)" }}>
        <IconArrowLeft size={16} stroke={1.75} /> กลับไปภาพรวม
      </button>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--sp-3)", marginBottom: "var(--sp-1)" }}>
        <h1 style={{ margin: 0, color: "var(--text-strong)" }}>{title}</h1>
        <button type="button" onClick={exportToExcel} disabled={rows.length === 0}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", padding: "8px 14px", cursor: rows.length ? "pointer" : "not-allowed", fontSize: "var(--fs-sm)", color: "var(--text)" }}>
          <IconFileSpreadsheet size={16} stroke={1.75} /> Export Excel
        </button>
      </div>
      <p style={{ margin: "0 0 var(--sp-4)", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
        {description} · {n(rows.length)} รายการ{hasMoney && <> · รวม {baht(totalValue)} บาท (VAT 7%)</>}
      </p>

      {rows.length === 0 ? (
        <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)" }}>ไม่มีรายการ</div>
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", fontSize: "var(--fs-xs)" }}>
                  <th style={th}>
                    <button type="button" onClick={() => setSortDesc((d) => !d)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", padding: 0 }}>
                      No. {sortDesc ? "▼" : "▲"}
                    </button>
                  </th>
                  {crossPerson && <th style={th}>ชื่อ</th>}
                  <th style={th}>Company</th>
                  <th style={th}>PR No.</th>
                  <th style={th}>PA No.</th>
                  <th style={th}>PO No.</th>
                  <th style={th}>Project</th>
                  <th style={th}>Vendor</th>
                  <th style={th}>Status</th>
                  <th style={th}>วันต้องการสินค้า</th>
                  <th style={th}>ทำรับ</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>{r.no ?? "—"}</td>
                    {crossPerson && <td style={{ ...td, fontWeight: 700, color: "var(--text-strong)" }}>{r.personName ?? "—"}</td>}
                    <td style={td}>{r.company ?? "—"}</td>
                    <td style={td}>{r.prNo ?? "—"}</td>
                    <td style={td}>{r.paNo ?? "—"}</td>
                    <td style={td}>{r.poNo ?? "—"}</td>
                    <td style={{ ...td, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }} title={r.project}>{r.project ?? "—"}</td>
                    <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={r.vendor}>{r.vendor ?? "—"}</td>
                    <td style={td}>{r.status ?? "—"}</td>
                    <td style={td}>{r.neededDate ?? "—"}</td>
                    <td style={td}>{r.deliveredDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ margin: "var(--sp-4) 0 0", fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
        แก้ไขข้อมูลได้ที่ Google Sheet เท่านั้น —{" "}
        <a href={MASTER_SHEET_URL} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          เปิด Sheet <IconExternalLink size={12} stroke={1.75} />
        </a>
      </p>
    </div>
  );
}
