import { useState, useEffect, useMemo, Fragment } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { db } from "./firebase";
import { fetchItemPriceHistory } from "./data/procurement";
import type { ItemAgg, ItemVendorStat, PricePoint, ImportHistoryEntry } from "./data/procurement";
import ImportModal from "./components/ImportModal";
import CompanyUpdates from "./components/CompanyUpdates";

type SortKey = "spend" | "vendors" | "name" | "qty";

function baht(n: number) {
  return "฿" + (n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
}
function bahtShort(n: number) {
  const v = n || 0;
  if (Math.abs(v) >= 1_000_000) return "฿" + (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000) return "฿" + (v / 1_000).toFixed(0) + "K";
  return "฿" + v.toFixed(0);
}
function highlight(text: string, search: string) {
  if (!search || !text) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return <span>{parts.map((p, i) => p.toLowerCase() === search.toLowerCase()
    ? <mark key={i} style={{ background: "#e2c97e", borderRadius: "2px", padding: "0 2px", color: "#1a3c6e" }}>{p}</mark> : p)}</span>;
}

function spread(it: ItemAgg): number {
  return it.minPrice > 0 ? (it.maxPrice - it.minPrice) / it.minPrice : 0;
}

function HistoryTooltip({ active, payload }: { active?: boolean; payload?: { payload: PricePoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ background: "white", borderRadius: "10px", border: "1px solid #e2e8f0", fontSize: "12px", padding: "8px 12px" }}>
      <p style={{ margin: "0 0 3px", color: "#94a3b8" }}>วันที่ {p.date}</p>
      <p style={{ margin: "0 0 3px", fontWeight: 800, color: "#1a3c6e" }}>{baht(p.price)}</p>
      <p style={{ margin: 0, color: "#64748b", fontFamily: "monospace" }}>PO: {p.poNumber || "-"}</p>
    </div>
  );
}

function PriceHistoryChart({ points, unit }: { points: PricePoint[]; unit: string }) {
  const perUnit = unit ? `บาท/${unit}` : "บาท/หน่วย";
  if (points.length < 2) {
    return (
      <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#94a3b8" }}>
        ℹ️ มีประวัติการซื้อเพียง {points.length} ครั้ง — ยังไม่พอวาดกราฟแนวโน้มราคา
      </p>
    );
  }
  const newestFirst = [...points].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div style={{ marginTop: "8px" }}>
      <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#64748b", fontWeight: 700 }}>
        แนวโน้มราคาซื้อ ({perUnit}) — แกนX: วันที่ซื้อ
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} margin={{ top: 8, right: 18, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2ff" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={58} tickFormatter={(v) => bahtShort(Number(v))} />
          <Tooltip content={<HistoryTooltip />} />
          <Line type="linear" dataKey="price" stroke="#2d5a9e" strokeWidth={2}
            dot={{ r: 3, fill: "#2d5a9e" }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>

      <p style={{ margin: "12px 0 6px", fontSize: "11px", color: "#64748b", fontWeight: 700 }}>
        อ้างอิงเลข PO ต่อครั้งที่ซื้อ (ใหม่สุดก่อน)
      </p>
      <div style={{ maxHeight: "150px", overflowY: "auto", border: "1px solid #eef2ff", borderRadius: "8px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <tbody>
            {newestFirst.map((p, i) => (
              <tr key={`${p.poNumber}-${i}`} style={{ borderBottom: i < newestFirst.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                <td style={{ padding: "6px 10px", color: "#94a3b8" }}>{p.date}</td>
                <td style={{ padding: "6px 10px", color: "#1a3c6e", fontFamily: "monospace", fontWeight: 700 }}>{p.poNumber || "-"}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: "#475569" }}>{p.qty ? `${p.qty.toLocaleString()} ${unit}` : ""}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: "#1a3c6e" }}>{baht(p.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemDetailModal({ item, onClose }: { item: ItemAgg; onClose: () => void }) {
  const vendors: ItemVendorStat[] = [...item.vendors].sort((a, b) => a.lastPrice - b.lastPrice);
  const cheapest = vendors[0]?.vendorCode;
  const unitLabel = item.unit ? `บาท/${item.unit}` : "บาท/หน่วย";

  const [history, setHistory] = useState<Map<string, PricePoint[]> | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [openVendor, setOpenVendor] = useState<string | null>(null);

  function toggleHistory(vendorCode: string) {
    if (openVendor === vendorCode) { setOpenVendor(null); return; }
    setOpenVendor(vendorCode);
    if (!history && !loadingHistory) {
      setLoadingHistory(true);
      fetchItemPriceHistory(item.itemNumber)
        .then((h) => setHistory(h))
        .catch((e) => { console.error("price history error:", e); setHistory(new Map()); })
        .finally(() => setLoadingHistory(false));
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: "22px", width: "720px", maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 32px 80px rgba(26,60,110,0.3)" }}>
        <div style={{ background: "linear-gradient(135deg, #1a3c6e, #2d5a9e)", padding: "26px 30px", borderRadius: "22px 22px 0 0", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: "20px", right: "22px", background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: "34px", height: "34px", cursor: "pointer", color: "white", fontSize: "17px" }}>✕</button>
          <p style={{ margin: "0 0 4px", color: "rgba(226,201,126,0.9)", fontSize: "12px", fontWeight: 700 }}>{item.itemNumber} · {item.category || "ไม่ระบุหมวด"}{item.unit ? ` · หน่วย: ${item.unit}` : ""}</p>
          <h2 style={{ margin: 0, color: "white", fontSize: "19px", fontWeight: 700, lineHeight: 1.35, marginRight: "40px" }}>{item.productName || item.itemNumber}</h2>
        </div>

        <div style={{ padding: "24px 30px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "22px" }}>
            {[
              { label: "Vendor ที่ขาย", value: item.numVendors.toLocaleString() },
              { label: `ราคาต่ำสุด (${unitLabel})`, value: baht(item.minPrice) },
              { label: `ราคาเฉลี่ย (${unitLabel})`, value: baht(item.avgPrice) },
              { label: `ราคาสูงสุด (${unitLabel})`, value: baht(item.maxPrice) },
            ].map((s) => (
              <div key={s.label} style={{ background: "linear-gradient(135deg, #f8faff, #eef2ff)", borderRadius: "12px", padding: "13px", textAlign: "center", border: "1px solid #e0e7ff" }}>
                <p style={{ margin: "0 0 4px", fontSize: "10px", color: "#94a3b8", fontWeight: 700 }}>{s.label}</p>
                <p style={{ margin: 0, fontSize: "15px", color: "#1a3c6e", fontWeight: 800 }}>{s.value}</p>
              </div>
            ))}
          </div>

          {spread(item) > 0.001 && (
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#475569", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", padding: "10px 14px" }}>
              💡 ส่วนต่างราคาต่ำสุด–สูงสุด <strong style={{ color: "#b45309" }}>{(spread(item) * 100).toFixed(0)}%</strong>
              {" "}— เลือก vendor ที่ถูกที่สุดประหยัดได้ <strong style={{ color: "#0f766e" }}>{baht(item.maxPrice - item.minPrice)}</strong>/หน่วย
            </p>
          )}

          <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: 800, color: "#1a3c6e" }}>เปรียบเทียบราคาต่อหน่วยแต่ละ Vendor ({unitLabel} · เรียงจากถูกสุด)</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "#f8faff" }}>
                {["Vendor", "ราคาล่าสุด", "ซื้อล่าสุด", "PO ล่าสุด", "เฉลี่ย", "ช่วงราคา", "จำนวนซื้อ", ""].map((h, i) => (
                  <th key={h || i} style={{ padding: "10px 12px", textAlign: i === 0 ? "left" : "right", fontSize: "11px", color: "#64748b", fontWeight: 700, borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const best = v.vendorCode === cheapest;
                const open = openVendor === v.vendorCode;
                const points = history?.get(v.vendorCode) ?? [];
                return (
                  <Fragment key={v.vendorCode}>
                    <tr style={{ background: best ? "#f0fdf4" : "white", borderBottom: open ? "none" : "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 12px" }}>
                        {best && <span style={{ background: "#16a34a", color: "white", fontSize: "9px", fontWeight: 800, padding: "1px 6px", borderRadius: "6px", marginRight: "6px" }}>ถูกสุด</span>}
                        <span style={{ fontWeight: 700, color: "#1a3c6e" }}>{v.vendorName || v.vendorCode}</span>
                        <span style={{ display: "block", fontSize: "10px", color: "#94a3b8" }}>{v.vendorCode}</span>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, color: best ? "#16a34a" : "#1a3c6e" }}>{baht(v.lastPrice)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#94a3b8", fontSize: "12px" }}>{v.lastDate || "-"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#94a3b8", fontSize: "12px", fontFamily: "monospace" }}>{v.lastPoNumber || "-"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#475569" }}>{baht(v.avgPrice)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#94a3b8", fontSize: "12px" }}>
                        {v.minPrice === v.maxPrice ? "-" : `${bahtShort(v.minPrice)}–${bahtShort(v.maxPrice)}`}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#475569" }}>{v.count}×</td>
                      <td style={{ padding: "10px 12px", textAlign: "right" }}>
                        <button onClick={() => toggleHistory(v.vendorCode)}
                          style={{ background: open ? "#1a3c6e" : "#eef2ff", color: open ? "white" : "#1a3c6e", border: "none", borderRadius: "8px", padding: "5px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                          📈 ประวัติ {open ? "▲" : "▼"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr style={{ background: best ? "#f0fdf4" : "#fafbff", borderBottom: "1px solid #f1f5f9" }}>
                        <td colSpan={8} style={{ padding: "4px 16px 16px" }}>
                          {loadingHistory && !history
                            ? <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#94a3b8" }}>กำลังโหลดประวัติราคา...</p>
                            : <PriceHistoryChart points={points} unit={item.unit} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {item.numVendors === 1 && (
            <p style={{ margin: "14px 0 0", fontSize: "12px", color: "#94a3b8" }}>ℹ️ สินค้านี้ซื้อจาก vendor รายเดียว — ยังไม่มีข้อมูลให้เปรียบเทียบ</p>
          )}
        </div>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "เมื่อสักครู่";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
  const days = Math.floor(hrs / 24);
  return `${days} วันที่แล้ว`;
}

function ImportHistoryModal({ onClose }: { onClose: () => void }) {
  const [history, setHistory] = useState<ImportHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "importHistory"), orderBy("timestamp", "desc")),
      (snap) => {
        setHistory(snap.docs.map((d) => d.data() as ImportHistoryEntry));
        setLoading(false);
      },
      (err) => { console.error("importHistory snapshot error:", err); setLoading(false); },
    );
    return () => unsub();
  }, []);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: "22px", width: "680px", maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 32px 80px rgba(26,60,110,0.3)" }}>
        <div style={{ background: "linear-gradient(135deg, #1a3c6e, #2d5a9e)", padding: "22px 28px", borderRadius: "22px 22px 0 0", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: "18px", right: "20px", background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: "32px", height: "32px", cursor: "pointer", color: "white", fontSize: "16px" }}>✕</button>
          <h2 style={{ margin: 0, color: "white", fontSize: "18px", fontWeight: 800 }}>🕐 ประวัติการนำเข้าข้อมูล PO</h2>
          <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.65)", fontSize: "12px" }}>ทุกครั้งที่มีการนำเข้าไฟล์ (แม้ไม่มี PO ใหม่) จะถูกบันทึกไว้ที่นี่</p>
        </div>
        <div style={{ padding: "20px 28px" }}>
          {loading && <p style={{ textAlign: "center", color: "#94a3b8", padding: "30px" }}>กำลังโหลด...</p>}
          {!loading && history.length === 0 && (
            <p style={{ textAlign: "center", color: "#94a3b8", padding: "30px" }}>ยังไม่มีประวัติการนำเข้า</p>
          )}
          {!loading && history.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f8faff" }}>
                  {["เมื่อไหร่", "โดย", "ไฟล์", "บริษัท", "PO ใหม่", "บรรทัดใหม่"].map((h, i) => (
                    <th key={h} style={{ padding: "9px 10px", textAlign: i >= 4 ? "right" : "left", fontSize: "11px", color: "#64748b", fontWeight: 700, borderBottom: "2px solid #e2e8f0" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "9px 10px" }}>
                      <div style={{ fontWeight: 700, color: "#1a3c6e" }}>{timeAgo(h.timestamp)}</div>
                      <div style={{ fontSize: "10px", color: "#94a3b8" }}>{h.timestamp.slice(0, 16).replace("T", " ")}</div>
                    </td>
                    <td style={{ padding: "9px 10px", color: "#475569" }}>{h.importedBy}</td>
                    <td style={{ padding: "9px 10px", color: "#94a3b8", fontSize: "12px", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.fileName || "-"}</td>
                    <td style={{ padding: "9px 10px", color: "#94a3b8", fontSize: "12px" }}>{h.companies.join(", ") || "-"}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 800, color: h.newPOs > 0 ? "#16a34a" : "#94a3b8" }}>{h.newPOs.toLocaleString()}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: "#475569" }}>{h.newLines.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ItemMasterPage() {
  const [items, setItems] = useState<ItemAgg[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("ทั้งหมด");
  const [comparableOnly, setComparableOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [detail, setDetail] = useState<ItemAgg | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "items"),
      (snap) => {
        setItems(snap.docs.map((d) => d.data() as ItemAgg));
        setLoading(false);
      },
      (err) => {
        // Don't hang on "loading" forever if the listener errors (e.g. rules).
        console.error("items snapshot error:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.category) set.add(it.category);
    return ["ทั้งหมด", ...[...set].sort()];
  }, [items]);

  const filtered = useMemo(() => {
    // Multi-token AND match across item code/name, category, and every vendor
    // that sells it — so "solar huawei" finds an item by combining a product
    // keyword with a supplier name, not just one exact-substring field.
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      let matchSearch = true;
      if (tokens.length) {
        const haystack = [
          it.itemNumber, it.productName, it.searchName, it.category,
          ...it.vendors.map((v) => v.vendorName),
          ...it.vendors.map((v) => v.vendorCode),
        ].join(" ").toLowerCase();
        matchSearch = tokens.every((t) => haystack.includes(t));
      }
      const matchCat = filterCat === "ทั้งหมด" || it.category === filterCat;
      const matchCmp = !comparableOnly || it.numVendors > 1;
      return matchSearch && matchCat && matchCmp;
    }).sort((a, b) => {
      if (sortKey === "name") return (a.productName || a.itemNumber).localeCompare(b.productName || b.itemNumber, "th");
      if (sortKey === "vendors") return b.numVendors - a.numVendors;
      if (sortKey === "qty") return b.totalQty - a.totalQty;
      return b.totalSpend - a.totalSpend;
    });
  }, [items, search, filterCat, comparableOnly, sortKey]);

  const comparableCount = useMemo(() => items.filter((it) => it.numVendors > 1).length, [items]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #f0f4ff 0%, #e8edf8 50%, #f5f0e8 100%)", fontFamily: "sans-serif" }}>
      {detail && <ItemDetailModal item={detail} onClose={() => setDetail(null)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showHistory && <ImportHistoryModal onClose={() => setShowHistory(false)} />}

      {/* HERO */}
      <div style={{ background: "linear-gradient(135deg, #0f2244 0%, #1a3c6e 45%, #2d5a9e 100%)", padding: "44px 40px 36px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-60px", right: "-60px", width: "240px", height: "240px", borderRadius: "50%", background: "rgba(226,201,126,0.08)" }} />
        <div style={{ maxWidth: "1200px", margin: "0 auto", position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "stretch", flexWrap: "wrap", gap: "20px" }}>
            <div style={{ flex: 1, minWidth: "300px", display: "flex", flexDirection: "column" }}>
              <span style={{ alignSelf: "flex-start", background: "rgba(226,201,126,0.2)", border: "1px solid rgba(226,201,126,0.4)", color: "#e2c97e", padding: "4px 14px", borderRadius: "999px", fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em" }}>PROCUREMENT</span>
              <h1 style={{ margin: "10px 0 8px", color: "white", fontSize: "clamp(24px, 4vw, 36px)", fontWeight: 800 }}>📦 Item Master</h1>
              <p style={{ margin: 0, color: "rgba(255,255,255,0.55)", fontSize: "15px" }}>เปรียบเทียบราคาสินค้าระหว่าง Vendor จากประวัติการสั่งซื้อจริง</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "auto", paddingTop: "24px" }}>
                {[
                  { label: "สินค้าทั้งหมด", count: items.length.toLocaleString(), icon: "📦" },
                  { label: "เทียบราคาได้ (>1 Vendor)", count: comparableCount.toLocaleString(), icon: "⚖️" },
                  { label: "หมวดหมู่", count: (categories.length - 1).toLocaleString(), icon: "🏷️" },
                ].map((s) => (
                  <div key={s.label} style={{ flex: "1 1 140px", background: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)", borderRadius: "14px", padding: "16px 20px", border: "1px solid rgba(255,255,255,0.12)" }}>
                    <p style={{ margin: "0 0 4px", color: "rgba(255,255,255,0.6)", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap" }}>{s.icon} {s.label}</p>
                    <p style={{ margin: 0, fontSize: "24px", fontWeight: 800, color: "white" }}>{s.count}</p>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "12px", width: "250px", flexShrink: 0 }}>
              <button onClick={() => setShowImport(true)} style={{ alignSelf: "flex-end", background: "rgba(226,201,126,0.2)", border: "1px solid rgba(226,201,126,0.5)", color: "#e2c97e", padding: "10px 20px", borderRadius: "12px", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}>
                📥 นำเข้าข้อมูล
              </button>
              <button onClick={() => setShowHistory(true)} style={{ alignSelf: "flex-end", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.85)", padding: "10px 20px", borderRadius: "12px", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}>
                🕐 ประวัติการนำเข้า
              </button>
              <CompanyUpdates />
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* FILTERS */}
        <div style={{ background: "white", borderRadius: "20px", padding: "22px", boxShadow: "0 4px 24px rgba(26,60,110,0.08)", marginBottom: "22px", border: "1px solid rgba(226,201,126,0.2)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "14px", alignItems: "end" }}>
            <div>
              <label style={{ display: "block", marginBottom: "7px", fontSize: "11px", fontWeight: 700, color: "#94a3b8" }}>🔍 ค้นหา</label>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="รหัสสินค้า, ชื่อ, Vendor, หมวดหมู่ — พิมพ์ได้หลายคำ"
                style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "2px solid #e2c97e", boxSizing: "border-box", fontSize: "14px", outline: "none", background: "#fffdf5", color: "#1a3c6e" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "7px", fontSize: "11px", fontWeight: 700, color: "#94a3b8" }}>หมวดหมู่</label>
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={{ width: "100%", padding: "11px 10px", borderRadius: "10px", border: "1.5px solid #e2e8f0", fontSize: "13px", color: "#1a3c6e", background: "white" }}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "7px", fontSize: "11px", fontWeight: 700, color: "#94a3b8" }}>เรียงตาม</label>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ width: "100%", padding: "11px 10px", borderRadius: "10px", border: "1.5px solid #e2e8f0", fontSize: "13px", color: "#1a3c6e", background: "white" }}>
                <option value="spend">ยอดซื้อสูงสุด</option>
                <option value="vendors">จำนวน Vendor</option>
                <option value="qty">จำนวนที่ซื้อ</option>
                <option value="name">ชื่อ A-Z</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #f1f5f9" }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8" }}>
              แสดง <strong style={{ color: "#1a3c6e" }}>{filtered.length}</strong> จาก <strong style={{ color: "#1a3c6e" }}>{items.length}</strong> รายการ
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#475569", cursor: "pointer", fontWeight: 700 }}>
              <input type="checkbox" checked={comparableOnly} onChange={(e) => setComparableOnly(e.target.checked)} />
              ⚖️ เฉพาะที่เทียบราคาได้
            </label>
          </div>
        </div>

        {loading && <p style={{ textAlign: "center", color: "#94a3b8", padding: "60px" }}>กำลังโหลด...</p>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 40px", background: "white", borderRadius: "20px", boxShadow: "0 4px 24px rgba(26,60,110,0.08)" }}>
            <div style={{ fontSize: "64px", marginBottom: "16px" }}>📦</div>
            <h3 style={{ margin: "0 0 8px", color: "#1a3c6e", fontSize: "20px", fontWeight: 700 }}>{items.length === 0 ? "ยังไม่มีข้อมูลสินค้า" : "ไม่พบสินค้า"}</h3>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "15px" }}>{items.length === 0 ? "กดปุ่ม “นำเข้าข้อมูล” เพื่ออัพโหลดไฟล์ PO" : "ลองเปลี่ยน keyword หรือ filter"}</p>
          </div>
        )}

        {/* TABLE */}
        {!loading && filtered.length > 0 && (
          <div style={{ background: "white", borderRadius: "20px", boxShadow: "0 4px 24px rgba(26,60,110,0.08)", overflow: "hidden", border: "1px solid rgba(226,201,126,0.15)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "linear-gradient(135deg, #1a3c6e, #2d5a9e)" }}>
                  {["รหัส", "ชื่อสินค้า", "หมวด", "Vendor", "ราคาเฉลี่ย", "ช่วงราคา", "ยอดซื้อ"].map((h, i) => (
                    <th key={h} style={{ padding: "13px 14px", textAlign: i >= 3 ? "right" : "left", fontWeight: 700, fontSize: "12px", color: "rgba(255,255,255,0.85)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((it, i) => (
                  <tr key={it.itemNumber} onClick={() => setDetail(it)}
                    onMouseEnter={() => setHoveredId(it.itemNumber)} onMouseLeave={() => setHoveredId(null)}
                    style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: hoveredId === it.itemNumber ? "#f8faff" : i % 2 === 0 ? "white" : "#fafbff" }}>
                    <td style={{ padding: "13px 14px", color: "#94a3b8", fontWeight: 700, fontSize: "12px", whiteSpace: "nowrap" }}>{highlight(it.itemNumber, search)}</td>
                    <td style={{ padding: "13px 14px", fontWeight: 700, color: "#1a3c6e", maxWidth: "300px" }}>{highlight(it.productName || it.itemNumber, search)}</td>
                    <td style={{ padding: "13px 14px", color: "#64748b", fontSize: "12px" }}>{it.category || "-"}</td>
                    <td style={{ padding: "13px 14px", textAlign: "right" }}>
                      <span style={{ background: it.numVendors > 1 ? "#dcfce7" : "#f1f5f9", color: it.numVendors > 1 ? "#16a34a" : "#94a3b8", padding: "2px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 800 }}>{it.numVendors}</span>
                    </td>
                    <td style={{ padding: "13px 14px", textAlign: "right", fontWeight: 700, color: "#1a3c6e" }}>{baht(it.avgPrice)}</td>
                    <td style={{ padding: "13px 14px", textAlign: "right", color: "#94a3b8", fontSize: "12px" }}>
                      {it.minPrice === it.maxPrice ? "-" : `${bahtShort(it.minPrice)}–${bahtShort(it.maxPrice)}`}
                    </td>
                    <td style={{ padding: "13px 14px", textAlign: "right", color: "#475569" }}>{bahtShort(it.totalSpend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 300 && (
              <p style={{ textAlign: "center", padding: "14px", color: "#94a3b8", fontSize: "13px", margin: 0 }}>แสดง 300 รายการแรก — ใช้ค้นหา/filter เพื่อดูที่เหลือ</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
