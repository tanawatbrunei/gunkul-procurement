import { useEffect, useState, useSyncExternalStore } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { getSyncState, subscribeSyncState, syncNow, nextScheduledSync } from "../data/trackingStore";

/* ============================================================
   Data-freshness indicator + manual "Sync now" for the tracking pages.

   The browser reads Firebase in a 12-hour batch (00:00 / 12:00) and caches
   the result locally — see data/trackingStore.ts — so this shows when THIS
   browser last loaded the data, and (in the tooltip) when the Apps Script
   last pushed the Google Sheet into Firebase. "Sync now" forces a re-read,
   limited to once per 15 minutes per browser to protect the Firebase quota.
   ============================================================ */

function timeAgoLabel(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "เมื่อสักครู่";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  return `${Math.floor(hours / 24)} วันที่แล้ว`;
}

function freshnessColor(ms: number): string {
  const hours = (Date.now() - ms) / 3_600_000;
  if (hours < 12) return "var(--success)";
  if (hours < 24) return "var(--warning)";
  return "var(--danger)";
}

const fmtCountdown = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function SyncStatus() {
  const state = useSyncExternalStore(subscribeSyncState, getSyncState);
  // Tick every second only while the button is locked (countdown), else every 30s for the "X ago" text.
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.max(0, state.nextManualAt - now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), remaining > 0 ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [remaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state.loadedAt) return null;
  const color = freshnessColor(state.loadedAt);
  const locked = remaining > 0 || state.syncing;
  const next = nextScheduledSync(new Date(now));
  const nextLabel = `${next.getHours() === 0 ? "00:00" : "12:00"} น.${next.getDate() !== new Date(now).getDate() ? " (พรุ่งนี้)" : ""}`;

  const tooltip = [
    `โหลดข้อมูลล่าสุดในเครื่องนี้: ${new Date(state.loadedAt).toLocaleString("th-TH")}`,
    state.sheetSyncedAt ? `Google Sheet ถูกซิงค์เข้า Firebase ล่าสุด: ${new Date(state.sheetSyncedAt).toLocaleString("th-TH")}` : null,
    `รอบซิงค์ถัดไป: ${next.toLocaleString("th-TH")}`,
    "ระบบโหลดข้อมูลอัตโนมัติทุก 12 ชม. (00:00 / 12:00) — กด Sync now ได้ไม่เกิน 1 ครั้งต่อ 15 นาที",
  ].filter(Boolean).join("\n");

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <div
        title={tooltip}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: "var(--fs-xs)", color: "var(--text-muted)",
          background: "var(--surface-2)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-full)", padding: "5px 12px",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
        โหลดข้อมูลเมื่อ {timeAgoLabel(state.loadedAt)}
        <span style={{ color: "var(--text-faint)" }}>· รอบถัดไป {nextLabel}</span>
      </div>
      <button
        type="button"
        disabled={locked}
        onClick={() => { void syncNow(); }}
        title={locked && !state.syncing ? `กด Sync ได้อีกครั้งใน ${fmtCountdown(remaining)} (จำกัด 1 ครั้งต่อ 15 นาที)` : "โหลดข้อมูลล่าสุดจาก Firebase ทันที"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, font: "inherit", fontSize: "var(--fs-xs)", fontWeight: 600,
          color: locked ? "var(--text-faint)" : "var(--primary)", background: "var(--surface)",
          border: `1px solid ${locked ? "var(--border)" : "var(--primary)"}`, borderRadius: "var(--radius-full)",
          padding: "5px 12px", cursor: locked ? "not-allowed" : "pointer",
        }}
      >
        <IconRefresh size={13} stroke={2} style={state.syncing ? { animation: "spin 1s linear infinite" } : undefined} />
        {state.syncing ? "กำลังซิงค์..." : remaining > 0 ? `Sync now (${fmtCountdown(remaining)})` : "Sync now"}
      </button>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
