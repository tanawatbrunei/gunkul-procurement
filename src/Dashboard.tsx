import { useEffect, useState } from "react";
import { IconLayoutDashboard } from "@tabler/icons-react";
import TrackingOverview from "./TrackingOverview";
import SyncStatus from "./components/SyncStatus";
import type { Tab } from "./TrackingPage";
import { subscribeTabs, getTabsSnapshot, getTabsError } from "./data/trackingStore";
import type { DrilldownRequest } from "./TrackingDrilldownView";

export default function DashboardPage({ onDrill }: { onDrill: (r: DrilldownRequest) => void }) {
  const [tabs, setTabs] = useState<Tab[]>(getTabsSnapshot());
  const [loadError, setLoadError] = useState<string | null>(getTabsError());

  useEffect(() => {
    return subscribeTabs(() => {
      setTabs(getTabsSnapshot());
      setLoadError(getTabsError());
    });
  }, []);

  return (
    <div style={{ maxWidth: "1440px", margin: "0 auto", padding: "var(--sp-7) var(--sp-5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--fs-xs)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent)", marginBottom: "var(--sp-2)" }}>
        <IconLayoutDashboard size={16} stroke={1.75} />
        ภาพรวม
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--sp-3)", marginBottom: "var(--sp-5)" }}>
        <h1 style={{ margin: 0, color: "var(--text-strong)" }}>Dashboard</h1>
        <SyncStatus />
      </div>

      {loadError ? (
        <div style={{
          color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)", borderRadius: "var(--radius)",
          padding: "var(--sp-4)", fontSize: "var(--fs-sm)",
        }}>
          โหลดข้อมูลไม่สำเร็จ: {loadError}
        </div>
      ) : tabs.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>ยังไม่มีข้อมูลใน Tracking Sheet</div>
      ) : (
        <TrackingOverview tabs={tabs} onDrill={onDrill} />
      )}
    </div>
  );
}
