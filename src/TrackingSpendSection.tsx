import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { IconHourglass } from "@tabler/icons-react";
import { computeMoney } from "./TrackingPage";
import type { TrackingRow } from "./TrackingPage";
import { computeSpend } from "./data/trackingSpend";
import { MIN_COVERAGE, MIN_SAMPLE } from "./data/trackingKpis";
import { card, mutedCard, n, pct, fmtBaht, Card, DataCard } from "./components/KpiCards";

const h3: React.CSSProperties = { margin: "0 0 var(--sp-1)", fontSize: "1rem", color: "var(--text-strong)" };
const note: React.CSSProperties = { fontSize: "var(--fs-xs)", color: "var(--text-faint)", lineHeight: 1.6 };
const AXIS_TICK = { fontSize: 11, fill: "var(--text-muted)" };
const short = (s: string, max = 34) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function VendorBars({ title, data, dataKey, unit, color, footnote }: {
  title: string; data: { name: string; value: number }[]; dataKey: string; unit: string; color: string; footnote: React.ReactNode;
}) {
  return (
    <div style={card}>
      <h3 style={h3}>{title}</h3>
      {data.length === 0 ? (
        <div style={{ ...note, padding: "var(--sp-3) 0" }}>ยังไม่มีข้อมูล Vendor</div>
      ) : (
        <ResponsiveContainer width="100%" height={data.length * 34 + 50}>
          <BarChart data={data.map((d) => ({ ...d, label: short(d.name) }))} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickFormatter={dataKey === "spend" ? (v) => fmtBaht(Number(v)) : undefined} />
            <YAxis type="category" dataKey="label" width={230} tick={AXIS_TICK} />
            <Tooltip formatter={(v) => [dataKey === "spend" ? fmtBaht(Number(v)) : `${v} ${unit}`, title]} labelFormatter={(_l, p) => p?.[0]?.payload?.name ?? ""} />
            <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      <p style={{ ...note, margin: "var(--sp-2) 0 0" }}>{footnote}</p>
    </div>
  );
}

export default function TrackingSpendSection({ rows }: { rows: TrackingRow[] }) {
  const s = useMemo(() => computeSpend(rows, (r) => computeMoney(r).total), [rows]);
  const spendReady = s.ytd.priceCoverage.ready && s.vendorSpendCoverage.ready;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text-strong)" }}>ค่าใช้จ่ายและ Supplier</h2>
        <p style={{ margin: "2px 0 var(--sp-3)", ...note }}>
          นับ PO ตามวันที่อนุมัติ PO (Date PO Approved) · เดือนนี้ = {s.monthLabel} · YTD = 1 ม.ค. – วันนี้ของปี {s.year + 543} · ไม่รวมรายการที่ยกเลิก
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "var(--sp-3)" }}>
          <DataCard label={`ยอดสั่งซื้อ ${s.monthLabel}`} cov={s.month.priceCoverage}
            value={fmtBaht(s.month.spend)}
            extra={`PO ที่อนุมัติ ${n(s.month.poCount)} PO${s.month.priceCoverage.ready ? " · รวม VAT 7%" : ""}`}
            need="ต้องกรอก Qty และราคา/หน่วย"
            title="ผลรวม (จำนวน × ราคา/หน่วย − ส่วนลด + VAT 7%) ของ PO ที่ Date PO Approved อยู่ในเดือนนี้" />
          <DataCard label="ยอดสั่งซื้อสะสมปีนี้ (YTD)" cov={s.ytd.priceCoverage}
            value={fmtBaht(s.ytd.spend)}
            extra={`PO ที่อนุมัติ ${n(s.ytd.poCount)} PO${s.ytd.priceCoverage.ready ? " · รวม VAT 7%" : ""}`}
            need="ต้องกรอก Qty และราคา/หน่วย"
            title="ผลรวม (จำนวน × ราคา/หน่วย − ส่วนลด + VAT 7%) ของ PO ที่ Date PO Approved ตั้งแต่ 1 ม.ค. ถึงวันนี้" />
          <Card label="PO ที่อนุมัติ (YTD)" color="var(--success)" value={n(s.ytd.poCount)}
            title="จำนวนเลข PO ไม่ซ้ำ ที่ Date PO Approved อยู่ในปีนี้ — ใช้ได้แม้ยังไม่มีราคา"
            lines={[`เดือนนี้ ${n(s.month.poCount)} PO`, `จาก ${n(s.ytd.rowCount)} รายการ`]} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "var(--sp-4)" }}>
        <VendorBars title="Top Vendor ตามจำนวน PO (YTD)" dataKey="poCount" unit="PO" color="#7CA6D8"
          data={s.vendorVolume.map((v) => ({ name: v.name, value: v.poCount }))}
          footnote={<>
            แสดง {s.vendorVolume.length} อันดับแรก จาก {n(s.totalVendors)} Vendor · นับเลข PO ไม่ซ้ำ ·{" "}
            <span style={{ color: s.vendorUnnamedShare >= MIN_COVERAGE ? "var(--warning)" : undefined }}>
              ไม่ระบุ Vendor {n(s.vendorUnnamed)} จาก {n(s.ytdRowCount)} รายการ ({pct(s.vendorUnnamedShare)}) ไม่ถูกรวม
            </span>
          </>} />

        {spendReady ? (
          <VendorBars title="Top Vendor ตามมูลค่า (YTD, รวม VAT)" dataKey="spend" unit="บาท" color="#8FCBAE"
            data={s.vendorSpend.map((v) => ({ name: v.name, value: v.spend }))}
            footnote={<>
              แสดง {s.vendorSpend.length} อันดับแรก · นับเฉพาะรายการที่มีราคา ({n(s.ytd.priceCoverage.measured)} จาก {n(s.ytd.priceCoverage.applicable)} รายการ, {pct(s.ytd.priceCoverage.share)})
            </>} />
        ) : (
          <div style={mutedCard}>
            <h3 style={{ ...h3, color: "var(--text-muted)" }}>Top Vendor ตามมูลค่า (YTD)</h3>
            <div style={{ ...note, color: "var(--warning)", display: "flex", gap: 4, alignItems: "flex-start" }}>
              <IconHourglass size={13} stroke={1.75} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                รอข้อมูล — มีราคาเพียง {n(s.ytd.priceCoverage.measured)} จาก {n(s.ytd.priceCoverage.applicable)} รายการที่อนุมัติปีนี้ ({pct(s.ytd.priceCoverage.share)})
                {s.ytd.priceCoverage.ready && !s.vendorSpendCoverage.ready && <> และระบุชื่อ Vendor ไม่ถึง {Math.round(MIN_COVERAGE * 100)}%</>}
                {" "}· จะแสดงเมื่อมีอย่างน้อย {Math.round(MIN_COVERAGE * 100)}% และ {MIN_SAMPLE} รายการ (ต้องกรอก Qty, ราคา/หน่วย และ Vendor)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
