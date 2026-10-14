import type { Coverage } from "../data/trackingKpis";

export const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--sp-4)",
};
export const mutedCard: React.CSSProperties = { ...card, background: "transparent", border: "1px dashed var(--border-strong)" };
export const line: React.CSSProperties = { fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: 2 };

export const n = (v: number) => v.toLocaleString("th-TH");
export const d = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("th-TH")} วัน`);
export function pct(share: number): string {
  if (share > 0 && share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}
export function fmtBaht(v: number): string {
  if (v >= 1_000_000) return `฿${(v / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}M`;
  return `฿${Math.round(v).toLocaleString("th-TH")}`;
}

const clickableCard: React.CSSProperties = { ...card, cursor: "pointer", textAlign: "left" };
const compact: React.CSSProperties = { padding: "var(--sp-3)", display: "flex", flexDirection: "column", gap: 2 };

/** Short warning pill for a card's top-right corner (replaces long "waiting for data" paragraphs). */
export function CornerBadge({ children, title, tone = "warning" }: { children: React.ReactNode; title?: string; tone?: "warning" | "danger" }) {
  const c = tone === "danger" ? "var(--danger)" : "var(--warning)";
  return (
    <span title={title} style={{
      flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap",
      background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c,
      borderRadius: "var(--radius-full)", padding: "1px 8px", fontSize: "10px", fontWeight: 700,
    }}>{children}</span>
  );
}

export function Card({ label, value, color, lines, title, onClick, badge }: {
  label: string; value: React.ReactNode; color: string; lines: React.ReactNode[]; title: string;
  /** When given, the whole card becomes a button that opens the matching rows in All Rows. */
  onClick?: () => void;
  badge?: React.ReactNode;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} style={{ ...(onClick ? clickableCard : card), ...compact }} title={onClick ? `${title} — คลิกเพื่อดูรายการ` : title} onClick={onClick}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</div>
        {badge}
      </div>
      <div style={{ fontSize: "var(--fs-h2)", fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      {lines.map((l, i) => <div key={i} style={line}>{l}</div>)}
    </Tag>
  );
}

/** A KPI that depends on fields the team hasn't fully filled in. Always shows
 *  the number computable from the rows that DO have data; incomplete coverage
 *  is flagged by a short corner badge ("⚠️ ข้อมูลไม่ครบ X รายการ") and a dashed
 *  border, with the full explanation in the tooltip instead of in the card body. */
export function DataCard({ label, value, cov, need, title, extra, onClick }: {
  label: string; value: React.ReactNode | null; cov: Coverage; need: string; title: string; extra?: React.ReactNode;
  /** When given (and there's something to show), the card becomes a button that opens the matching rows in All Rows. */
  onClick?: () => void;
}) {
  const missing = Math.max(0, cov.applicable - cov.measured);
  const clickable = !!onClick;
  const Tag = clickable ? "button" : "div";
  const tip = `${title}\nข้อมูลครอบคลุม ${pct(cov.share)} (${n(cov.measured)} จาก ${n(cov.applicable)} รายการ)${cov.ready ? "" : ` — ยังไม่ครบเกณฑ์ ตัวเลขนี้เป็นค่าจากข้อมูลที่มี · ${need}`}${clickable ? "\nคลิกเพื่อดูรายการ" : ""}`;
  return (
    <Tag type={clickable ? "button" : undefined}
      style={{ ...(cov.ready ? card : mutedCard), ...compact, ...(clickable ? { cursor: "pointer", textAlign: "left" as const } : {}) }}
      title={tip} onClick={onClick}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</div>
        {missing > 0 && <CornerBadge title={need}>⚠️ ข้อมูลไม่ครบ {n(missing)} รายการ</CornerBadge>}
      </div>
      <div style={{ fontSize: "var(--fs-h2)", fontWeight: 700, lineHeight: 1.2, color: cov.ready ? "var(--text-strong)" : "var(--text-muted)" }}>
        {value ?? "—"}
      </div>
      {extra && <div style={line}>{extra}</div>}
    </Tag>
  );
}
