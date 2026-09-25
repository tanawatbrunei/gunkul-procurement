/** Parses `TrackingRow.trackingStatus` ("Note3" in the Sheet) — a per-row
 *  overdue/on-time flag some tabs compute with their own formula, e.g.
 *  "🟢 ทันกำหนด", "🔴 เกินกำหนด PR-PO (>5 วัน)", "⚪ ยกเลิก". Not every tab has
 *  this column yet, so callers must treat a missing/unparsed value as "no
 *  opinion" rather than "on time". */

export type StatusSeverity = "ok" | "warn" | "danger" | "cancelled" | "unknown";

export interface StatusNote {
  /** Raw value as typed in the Sheet, unchanged (for display/debugging). */
  raw: string;
  emoji: string;
  /** Text after the emoji, e.g. "เกินกำหนด PR-PO (>5 วัน)". */
  label: string;
  severity: StatusSeverity;
}

const SEVERITY_BY_EMOJI: Record<string, StatusSeverity> = {
  "🟢": "ok",
  "🟡": "warn",
  "🟠": "warn",
  "🔴": "danger",
  "⚪": "cancelled",
};

export function parseTrackingStatus(raw: string | undefined): StatusNote | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const emoji = [...trimmed][0] ?? "";
  const label = trimmed.slice(emoji.length).trim();
  return { raw: trimmed, emoji, label: label || trimmed, severity: SEVERITY_BY_EMOJI[emoji] ?? "unknown" };
}

/** True for a row this flag calls overdue right now (warn or danger; not ok/cancelled/unknown). */
export function isOverdueNote(note: StatusNote | null): boolean {
  return note?.severity === "warn" || note?.severity === "danger";
}
