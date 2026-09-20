import { useEffect, useState } from "react";
import { IconLayoutDashboard, IconTable } from "@tabler/icons-react";
import DashboardPage from "./Dashboard";
import TrackingPage from "./TrackingPage";

export type TrackingView = "summary" | "rows";

const TABS: { view: TrackingView; label: string; icon: typeof IconTable }[] = [
  { view: "summary", label: "Summary", icon: IconLayoutDashboard },
  { view: "rows", label: "All Rows", icon: IconTable },
];

/** One nav entry for Dashboard + Tracking Sheet: a sub-tab bar over the two
 *  existing pages. Each sub-page stays mounted once opened (hidden when
 *  inactive) so its filters/scroll survive tab switches and the shared
 *  Firestore listeners aren't re-attached. */
export default function TrackingHub({ view, onViewChange }: { view: TrackingView; onViewChange: (v: TrackingView) => void }) {
  const [opened, setOpened] = useState<Set<TrackingView>>(() => new Set([view]));
  useEffect(() => {
    setOpened((s) => (s.has(view) ? s : new Set(s).add(view)));
  }, [view]);

  return (
    <div>
      <div style={{ maxWidth: "1440px", margin: "0 auto", padding: "var(--sp-5) var(--sp-5) 0" }}>
        <div role="tablist" aria-label="Tracking views" style={{ display: "inline-flex", gap: "var(--sp-1)", padding: 4, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-full)" }}>
          {TABS.map(({ view: v, label, icon: Icon }) => {
            const active = v === view;
            return (
              <button key={v} type="button" role="tab" aria-selected={active} onClick={() => onViewChange(v)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 16px",
                  borderRadius: "var(--radius-full)", border: "none", cursor: "pointer",
                  fontSize: "var(--fs-sm)", fontWeight: active ? 700 : 500,
                  background: active ? "var(--accent-bg)" : "transparent",
                  color: active ? "var(--text-strong)" : "var(--text-muted)",
                  boxShadow: active ? "inset 0 0 0 1px var(--accent)" : "none",
                }}>
                <Icon size={15} stroke={1.75} /> {label}
              </button>
            );
          })}
        </div>
      </div>
      {opened.has("summary") && <div style={{ display: view === "summary" ? "block" : "none" }}><DashboardPage /></div>}
      {opened.has("rows") && <div style={{ display: view === "rows" ? "block" : "none" }}><TrackingPage /></div>}
    </div>
  );
}
