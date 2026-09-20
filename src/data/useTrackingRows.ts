import { useEffect, useMemo, useState } from "react";
import type { Tab, TrackingRow } from "../TrackingPage";
import { subscribeSlim, getSlimSnapshot, subscribeRows, getRowsSnapshot } from "./trackingStore";

/** Rows for every tab, for the summary/dashboard/search. Reads the compact
 *  `trackingSlim` docs (1 read per tab); only tabs that have no slim doc fall
 *  back to reading all of their rows. Statuses are RAW — callers normalize. */
export function useTrackingRowsByTab(tabs: Tab[]): Record<string, TrackingRow[]> {
  const [slim, setSlim] = useState(getSlimSnapshot);
  useEffect(() => subscribeSlim(() => setSlim(getSlimSnapshot())), []);

  const [full, setFull] = useState<Record<string, TrackingRow[]>>({});
  const missing = slim.loaded ? tabs.filter((t) => !slim.rows[t.id]).map((t) => t.id) : [];
  const missingKey = missing.join(",");
  useEffect(() => {
    const ids = missingKey ? missingKey.split(",") : [];
    const unsubs = ids.map((id) =>
      subscribeRows(id, () => setFull((prev) => ({ ...prev, [id]: getRowsSnapshot(id) }))),
    );
    return () => unsubs.forEach((u) => u());
  }, [missingKey]);

  return useMemo(() => {
    const out: Record<string, TrackingRow[]> = {};
    for (const t of tabs) {
      const r = slim.rows[t.id] ?? (slim.loaded ? full[t.id] : undefined);
      if (r) out[t.id] = r;
    }
    return out;
  }, [tabs, slim, full]);
}
