import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";

/**
 * Read-only glass panel for the procurement hero — shows the last-updated date
 * per company. Fully automatic: imports stamp meta/companyUpdates with the
 * company code (from the PO file) and the import date, so new companies appear
 * and dates refresh on their own.
 *
 * Collapsed by default to a single summary line (most-recent company + count)
 * so it doesn't dominate the hero next to the search/filters — expand on click
 * for the full per-company list in a compact 2-column grid.
 */
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export default function CompanyUpdates() {
  const [updates, setUpdates] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, "meta", "companyUpdates"), (snap) => {
      const data = snap.data() as { updates?: Record<string, string> } | undefined;
      setUpdates(data?.updates ?? {});
    });
  }, []);

  const rows = useMemo(
    () => Object.entries(updates).sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : a[0].localeCompare(b[0]))),
    [updates],
  );

  if (rows.length === 0) {
    return (
      <div style={{
        background: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)", borderRadius: "14px",
        border: "1px solid rgba(255,255,255,0.12)", padding: "10px 14px", minWidth: "230px", maxWidth: "300px",
      }}>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: "11px", fontWeight: 600 }}>
          🕒 จะแสดงอัตโนมัติเมื่อ import PO ของบริษัทนั้น
        </p>
      </div>
    );
  }

  const [latestCode, latestDate] = rows[0];

  return (
    <div style={{
      background: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)", borderRadius: "14px",
      border: "1px solid rgba(255,255,255,0.12)", minWidth: "230px", maxWidth: "300px", overflow: "hidden",
    }}>
      <button onClick={() => setExpanded(e => !e)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
        background: "none", border: "none", cursor: "pointer", padding: "12px 14px", color: "white",
      }}>
        <span style={{ fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", overflow: "hidden" }}>
          🕒 ล่าสุด: <strong style={{ fontWeight: 800 }}>{latestCode}</strong>
          <span style={{ color: "rgba(255,255,255,0.65)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmtDate(latestDate)}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "rgba(255,255,255,0.6)", fontSize: "11px", fontWeight: 700, flexShrink: 0 }}>
          {rows.length} บริษัท {expanded ? <IconChevronUp size={13} stroke={2} /> : <IconChevronDown size={13} stroke={2} />}
        </span>
      </button>
      {expanded && (
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px",
          padding: "0 14px 12px", maxHeight: "160px", overflowY: "auto",
        }}>
          {rows.map(([code, date]) => (
            <div key={code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span style={{ color: "white", fontSize: "11px", fontWeight: 700 }}>{code}</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontVariantNumeric: "tabular-nums" }}>{fmtDate(date)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
