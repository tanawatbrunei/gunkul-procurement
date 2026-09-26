import { IconHourglass } from "@tabler/icons-react";
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

export function Card({ label, value, color, lines, title, onClick }: {
  label: string; value: React.ReactNode; color: string; lines: React.ReactNode[]; title: string;
  /** When given, the whole card becomes a button that opens the matching rows in All Rows. */
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} style={onClick ? clickableCard : card} title={onClick ? `${title} — คลิกเพื่อดูรายการ` : title} onClick={onClick}>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: "var(--fs-h2)", fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      {lines.map((l, i) => <div key={i} style={line}>{l}</div>)}
    </Tag>
  );
}

/** A KPI that needs fields the team hasn't filled in yet. Shows the number only
 *  once coverage clears the gates; until then an explicit "waiting for data". */
export function DataCard({ label, value, cov, need, title, extra, onClick }: {
  label: string; value: React.ReactNode | null; cov: Coverage; need: string; title: string; extra?: React.ReactNode;
  /** When given (and there's something to show), the card becomes a button that opens the matching rows in All Rows. */
  onClick?: () => void;
}) {
  const ready = cov.ready && value !== null;
  const clickable = !!onClick;
  const Tag = clickable ? "button" : "div";
  return (
    <Tag type={clickable ? "button" : undefined}
      style={{ ...(ready ? card : mutedCard), ...(clickable ? { cursor: "pointer", textAlign: "left" as const } : {}) }}
      title={clickable ? `${title} — คลิกเพื่อดูรายการ` : title} onClick={onClick}>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: "var(--fs-h2)", fontWeight: 700, lineHeight: 1.2, color: ready ? "var(--text-strong)" : "var(--text-faint)" }}>
        {ready ? value : "—"}
      </div>
      {extra && <div style={line}>{extra}</div>}
      <div style={{ fontSize: "var(--fs-xs)", marginTop: 6, display: "flex", gap: 4, alignItems: "flex-start", color: ready ? "var(--text-faint)" : "var(--warning)" }}>
        {!ready && <IconHourglass size={13} stroke={1.75} style={{ flexShrink: 0, marginTop: 2 }} />}
        <span>
          {ready ? `ข้อมูลครอบคลุม ${pct(cov.share)} (${n(cov.measured)} จาก ${n(cov.applicable)} รายการ)`
            : `รอข้อมูล — ครอบคลุม ${pct(cov.share)} (${n(cov.measured)} จาก ${n(cov.applicable)} รายการ) · ${need}`}
        </span>
      </div>
    </Tag>
  );
}
