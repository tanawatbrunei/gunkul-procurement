import { lazy, Suspense, useEffect, useState } from "react";
import { IconLayoutDashboard, IconTable } from "@tabler/icons-react";
import TrackingDrilldownView from "./TrackingDrilldownView";
import type { DrilldownRequest } from "./TrackingDrilldownView";

// Split further: Summary (Dashboard + all the KPI/Bottleneck/Spend sections)
// and All Rows are each substantial on their own, and a session typically only
// opens one or the other — no reason to fetch both chunks up front.
const DashboardPage = lazy(() => import("./Dashboard"));
const TrackingPage = lazy(() => import("./TrackingPage"));

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

  // Clicking a Summary card opens this instead of switching sub-tabs — it
  // reuses the exact rows that card already filtered (see data/trackingKpis.ts),
  // so the list can never disagree with the number that opened it. Local state,
  // not URL-persisted: a refresh just returns to whichever sub-tab was active.
  const [drilldown, setDrilldown] = useState<DrilldownRequest | null>(null);

  if (drilldown) {
    return <TrackingDrilldownView request={drilldown} onBack={() => setDrilldown(null)} />;
  }

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
      <Suspense fallback={<div style={{ padding: "var(--sp-5)", color: "var(--text-faint)", fontSize: "var(--fs-sm)" }}>กำลังโหลด...</div>}>
        {opened.has("summary") && <div style={{ display: view === "summary" ? "block" : "none" }}><DashboardPage onDrill={setDrilldown} /></div>}
        {opened.has("rows") && <div style={{ display: view === "rows" ? "block" : "none" }}><TrackingPage /></div>}
      </Suspense>
    </div>
  );
}
