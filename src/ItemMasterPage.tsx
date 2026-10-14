import { useState, useEffect, useMemo, Fragment } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  IconX, IconChartLine, IconClock, IconPackage, IconSearch,
  IconScale, IconTag, IconUpload,
} from "@tabler/icons-react";
import { db } from "./firebase";
import { fetchItemPriceHistory } from "./data/procurement";
import type { ItemAgg, ItemVendorStat, PricePoint, ImportHistoryEntry } from "./data/procurement";
import ImportModal from "./components/ImportModal";
import CompanyUpdates from "./components/CompanyUpdates";

type SortKey = "spend" | "vendors" | "name" | "qty" | "variance" | "price";
type QuickFilter = "all" | "multi" | "variance";

/** Master switch for every price figure on this page (unit price, variance,
 *  lowest/highest badges, price chart). Prices were hidden for a presentation
 *  and are shown again on request — flip to false to hide them all at once. */
const SHOW_PRICES = true;
/** An item counts as a "high price variance" above this spread (max vs min, %). */
const HIGH_VARIANCE_PCT = 10;
// All price data on this page is THB only: aggregateItems/fetchItemPriceHistory
// drop non-THB lines so every comparison is like-for-like.
const CURRENCY = "THB";

const baht = (n: number) => "฿" + (n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
/** Spread of min→max price as a percentage of the min (0 when not comparable). */
const variancePct = (min: number, max: number) => (min > 0 && max > min ? ((max - min) / min) * 100 : 0);
/** "+12%"; absurd spreads (usually a mistyped ฿1 price in the source data) are capped so they don't blow out the column. */
const fmtPct = (v: number) => (v > 999 ? ">+999%" : `+${v.toFixed(0)}%`);
const itemVariance = (it: ItemAgg) => variancePct(it.minPrice, it.maxPrice);
const normKey = (t: string) => t.toLowerCase().replace(/[^0-9a-z\u0E00-\u0E7F]+/g, "");

// Price history is one Firestore query per item — keep it for the session so
// re-opening the same item (or its vendor "ประวัติ" rows) costs no extra reads.
const historyCache = new Map<string, Map<string, PricePoint[]>>();
const VENDOR_COLORS = ["#7CA6D8", "#E58E7A", "#8FCBAE", "#D6B8E0", "#F4D58D", "#9AD0D6", "#C9B7A0", "#A8B8D8"];

function highlight(text: string, search: string) {
  if (!search || !text) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return <span>{parts.map((p, i) => p.toLowerCase() === search.toLowerCase()
    ? <mark key={i} style={{ background: "var(--accent-soft)", borderRadius: "2px", padding: "0 2px", color: "var(--navy)" }}>{p}</mark> : p)}</span>;
}


function PurchaseHistoryTable({ points, unit }: { points: PricePoint[]; unit: string }) {
  const newestFirst = [...points].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <div style={{ marginTop: "8px" }}>
      {points.length > 0 ? (
        <>
          <p style={{ margin: "0 0 6px", fontSize: "11px", color: "var(--text-muted)", fontWeight: 700 }}>
            อ้างอิงเลข PO ต่อครั้งที่ซื้อ (ใหม่สุดก่อน)
          </p>
          <div style={{ maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <tbody>
                {newestFirst.map((p, i) => (
                  <tr key={`${p.poNumber}-${i}`} style={{ borderBottom: i < newestFirst.length - 1 ? "1px solid var(--surface-2)" : "none" }}>
                    <td style={{ padding: "6px 10px", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{p.date}</td>
                    <td style={{ padding: "6px 10px", color: "var(--primary)", fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap", userSelect: "all" }}>{p.poNumber || "-"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{p.qty ? `${p.qty.toLocaleString()} ${unit}` : ""}</td>
                    {SHOW_PRICES && <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: "var(--primary)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{baht(p.price)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--text-faint)" }}>ไม่มีประวัติการซื้อ</p>
      )}
    </div>
  );
}

/** Mini price-over-time chart: one line per vendor, x = PO date. */
function PriceTrendChart({ history, vendors }: { history: Map<string, PricePoint[]>; vendors: ItemVendorStat[] }) {
  const { data, lines, total } = useMemo(() => {
    const lines = vendors.filter((v) => (history.get(v.vendorCode)?.length ?? 0) > 0)
      .map((v, i) => ({ code: v.vendorCode, name: v.vendorName || v.vendorCode, color: VENDOR_COLORS[i % VENDOR_COLORS.length] }));
    const byDate = new Map<string, Record<string, number | string>>();
    let total = 0;
    for (const l of lines) {
      for (const p of history.get(l.code) ?? []) {
        total++;
        const row = byDate.get(p.date) ?? { date: p.date };
        row[l.code] = p.price; // same vendor, same date: the later PO wins
        byDate.set(p.date, row);
      }
    }
    return { data: [...byDate.values()].sort((a, b) => (a.date as string < (b.date as string) ? -1 : 1)), lines, total };
  }, [history, vendors]);

  return (
    <div style={{ background: "var(--surface-2)", borderRadius: "12px", padding: "12px 14px", marginBottom: "18px" }}>
      <p style={{ margin: "0 0 6px", fontSize: "12px", fontWeight: 800, color: "var(--primary)" }}>แนวโน้มราคาต่อหน่วยย้อนหลัง (ตาม PO Date)</p>
      {total < 2 ? (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--text-faint)" }}>มีประวัติการซื้อเพียง {total} ครั้ง — ยังไม่พอวาดกราฟแนวโน้ม</p>
      ) : (
        <ResponsiveContainer width="100%" height={170}>
          <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-faint)" }} />
            <YAxis tick={{ fontSize: 10, fill: "var(--text-faint)" }} width={56} domain={["auto", "auto"]} tickFormatter={(v) => Number(v).toLocaleString("th-TH")} />
            <Tooltip formatter={(v, name) => [baht(Number(v)), String(name)]} />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {lines.map((l) => (
              <Line key={l.code} type="linear" dataKey={l.code} name={l.name} stroke={l.color} strokeWidth={2} connectNulls dot={{ r: 3 }} activeDot={{ r: 5 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function PriceBadge({ kind }: { kind: "low" | "high" }) {
  const c = kind === "low" ? "var(--success)" : "var(--danger)";
  return (
    <span style={{
      display: "inline-block", marginRight: 6, fontSize: "9px", fontWeight: 800, padding: "1px 7px", borderRadius: "999px", whiteSpace: "nowrap",
      color: c, background: `color-mix(in srgb, ${c} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
    }}>{kind === "low" ? "🟢 Lowest Price" : "🔴 Highest Price"}</span>
  );
}

function ItemDetailModal({ item, onClose }: { item: ItemAgg; onClose: () => void }) {
  // Cheapest (latest price) first, so the comparison reads top-down.
  const vendors: ItemVendorStat[] = useMemo(() => [...item.vendors].sort((a, b) => a.lastPrice - b.lastPrice), [item]);
  const lowest = vendors[0];
  const highest = vendors[vendors.length - 1];
  const comparable = vendors.length > 1 && highest.lastPrice > lowest.lastPrice;
  const spreadPct = comparable ? variancePct(lowest.lastPrice, highest.lastPrice) : 0;

  const [history, setHistory] = useState<Map<string, PricePoint[]> | null>(() => historyCache.get(item.itemNumber) ?? null);
  const [openVendor, setOpenVendor] = useState<string | null>(null);

  // Loaded on open (it feeds the trend chart); cached for the session.
  useEffect(() => {
    if (!SHOW_PRICES && history) return;
    if (historyCache.has(item.itemNumber)) { setHistory(historyCache.get(item.itemNumber)!); return; }
    let alive = true;
    fetchItemPriceHistory(item.itemNumber)
      .then((h) => { historyCache.set(item.itemNumber, h); if (alive) setHistory(h); })
      .catch((e) => { console.error("price history error:", e); if (alive) setHistory(new Map()); });
    return () => { alive = false; };
  }, [item.itemNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const colCount = SHOW_PRICES ? 7 : 5;
  const heads = SHOW_PRICES
    ? ["Vendor", "ราคาต่อหน่วย", "สกุลเงิน", "ซื้อล่าสุด", "PO ล่าสุด", "จำนวนซื้อ", ""]
    : ["Vendor", "ซื้อล่าสุด", "PO ล่าสุด", "จำนวนซื้อ", ""];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "22px", width: "820px", maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ background: "linear-gradient(135deg, var(--navy), var(--navy-mid))", padding: "26px 30px", borderRadius: "22px 22px 0 0", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: "20px", right: "22px", background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: "34px", height: "34px", cursor: "pointer", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}><IconX size={18} stroke={2} /></button>
          <p style={{ margin: "0 0 4px", color: "rgba(226,201,126,0.9)", fontSize: "12px", fontWeight: 700 }}>{item.itemNumber} · {item.category || "ไม่ระบุหมวด"}{item.unit ? ` · หน่วย: ${item.unit}` : ""}</p>
          <h2 style={{ margin: "0 0 8px", color: "white", fontSize: "19px", fontWeight: 700, lineHeight: 1.35, marginRight: "40px" }}>{item.productName || item.itemNumber}</h2>
          {(item.companies || []).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {item.companies.map((c) => (
                <span key={c} style={{ background: "rgba(255,255,255,0.15)", color: "white", padding: "2px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 700 }}>{c}</span>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "24px 30px" }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${SHOW_PRICES ? 4 : 1}, 1fr)`, gap: "10px", marginBottom: "18px" }}>
            {[
              { label: "Vendor ที่ขาย", value: item.numVendors.toLocaleString(), color: "var(--primary)" },
              ...(SHOW_PRICES ? [
                { label: "ราคาต่ำสุด (ล่าสุด)", value: baht(lowest.lastPrice), color: "var(--success)" },
                { label: "ราคาสูงสุด (ล่าสุด)", value: comparable ? baht(highest.lastPrice) : "—", color: "var(--danger)" },
                { label: "ส่วนต่างราคา", value: comparable ? fmtPct(spreadPct) : "—", color: "var(--warning)" },
              ] : []),
            ].map((c) => (
              <div key={c.label} style={{ background: "var(--surface-2)", borderRadius: "12px", padding: "12px", textAlign: "center", border: "1px solid var(--border)" }}>
                <p style={{ margin: "0 0 4px", fontSize: "10px", color: "var(--text-faint)", fontWeight: 700 }}>{c.label}</p>
                <p style={{ margin: 0, fontSize: "15px", color: c.color, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{c.value}</p>
              </div>
            ))}
          </div>

          {SHOW_PRICES && (history
            ? <PriceTrendChart history={history} vendors={vendors} />
            : <p style={{ margin: "0 0 18px", fontSize: "12px", color: "var(--text-faint)" }}>กำลังโหลดกราฟแนวโน้มราคา...</p>)}

          <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: 800, color: "var(--primary)" }}>Vendor ที่เคยขายสินค้านี้{SHOW_PRICES ? " (เรียงจากราคาถูกสุด)" : ""}</p>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                {heads.map((h, i) => (
                  <th key={h || i} style={{ padding: "10px 12px", textAlign: i === 0 ? "left" : "right", fontSize: "11px", color: "var(--text-muted)", fontWeight: 700, borderBottom: "2px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const open = openVendor === v.vendorCode;
                const points = history?.get(v.vendorCode) ?? [];
                const isLow = SHOW_PRICES && comparable && v.lastPrice === lowest.lastPrice;
                const isHigh = SHOW_PRICES && comparable && v.lastPrice === highest.lastPrice;
                const rowBg = isLow ? "color-mix(in srgb, var(--success) 9%, var(--surface))" : isHigh ? "color-mix(in srgb, var(--danger) 7%, var(--surface))" : "var(--surface)";
                return (
                  <Fragment key={v.vendorCode}>
                    <tr style={{ background: rowBg, borderBottom: open ? "none" : "1px solid var(--surface-2)" }}>
                      <td style={{ padding: "10px 12px", minWidth: "170px" }}>
                        {isLow && <PriceBadge kind="low" />}
                        {isHigh && <PriceBadge kind="high" />}
                        <a href={`#/vendor/${encodeURIComponent(v.vendorCode)}`} title="เปิดหน้าข้อมูล Vendor นี้"
                          style={{ fontWeight: 700, color: "var(--primary)", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "3px" }}>
                          {v.vendorName || v.vendorCode}
                        </a>
                        <span style={{ display: "block", fontSize: "10px", color: "var(--text-faint)" }}>{v.vendorCode}</span>
                      </td>
                      {SHOW_PRICES && (
                        <>
                          <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: isLow ? "var(--success)" : isHigh ? "var(--danger)" : "var(--primary)" }}>
                            {baht(v.lastPrice)}
                            {comparable && !isLow && (
                              <span style={{ display: "block", fontSize: "10px", fontWeight: 600, color: "var(--text-faint)" }}>{fmtPct(variancePct(lowest.lastPrice, v.lastPrice))} จากต่ำสุด</span>
                            )}
                          </td>
                          <td style={{ padding: "10px 8px", textAlign: "right", color: "var(--text-muted)", fontSize: "12px" }}>{CURRENCY}</td>
                        </>
                      )}
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "var(--text-faint)", fontSize: "12px" }}>{v.lastDate || "-"}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "var(--text-faint)", fontSize: "12px", fontFamily: "monospace", whiteSpace: "nowrap", userSelect: "all" }}>{v.lastPoNumber || "-"}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "var(--text-muted)" }}>{v.count}×</td>
                      <td style={{ padding: "10px 8px", textAlign: "right" }}>
                        <button onClick={() => setOpenVendor(open ? null : v.vendorCode)}
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: open ? "var(--navy)" : "var(--surface-2)", color: open ? "white" : "var(--primary)", border: "none", borderRadius: "8px", padding: "5px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                          <IconChartLine size={13} stroke={2} /> ประวัติ {open ? "▲" : "▼"}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                        <td colSpan={colCount} style={{ padding: "4px 16px 16px" }}>
                          {!history
                            ? <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--text-faint)" }}>กำลังโหลดประวัติ...</p>
                            : <PurchaseHistoryTable points={points} unit={item.unit} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
          {item.numVendors === 1 && (
            <p style={{ margin: "14px 0 0", fontSize: "12px", color: "var(--text-faint)" }}>ℹ️ สินค้านี้ซื้อจาก vendor รายเดียว — ยังไม่มีข้อมูลให้เปรียบเทียบ</p>
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
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "22px", width: "680px", maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ background: "linear-gradient(135deg, var(--navy), var(--navy-mid))", padding: "22px 28px", borderRadius: "22px 22px 0 0", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: "18px", right: "20px", background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: "32px", height: "32px", cursor: "pointer", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}><IconX size={16} stroke={2} /></button>
          <h2 style={{ margin: 0, color: "white", fontSize: "18px", fontWeight: 800, display: "flex", alignItems: "center", gap: "8px" }}><IconClock size={20} stroke={1.75} /> ประวัติการนำเข้าข้อมูล PO</h2>
          <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.65)", fontSize: "12px" }}>ทุกครั้งที่มีการนำเข้าไฟล์ (แม้ไม่มี PO ใหม่) จะถูกบันทึกไว้ที่นี่</p>
        </div>
        <div style={{ padding: "20px 28px" }}>
          {loading && <p style={{ textAlign: "center", color: "var(--text-faint)", padding: "30px" }}>กำลังโหลด...</p>}
          {!loading && history.length === 0 && (
            <p style={{ textAlign: "center", color: "var(--text-faint)", padding: "30px" }}>ยังไม่มีประวัติการนำเข้า</p>
          )}
          {!loading && history.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "var(--surface-2)" }}>
                  {["เมื่อไหร่", "โดย", "ไฟล์", "บริษัท", "PO ใหม่", "บรรทัดใหม่"].map((h, i) => (
                    <th key={h} style={{ padding: "9px 10px", textAlign: i >= 4 ? "right" : "left", fontSize: "11px", color: "var(--text-muted)", fontWeight: 700, borderBottom: "2px solid var(--border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 10px" }}>
                      <div style={{ fontWeight: 700, color: "var(--primary)" }}>{timeAgo(h.timestamp)}</div>
                      <div style={{ fontSize: "10px", color: "var(--text-faint)" }}>{h.timestamp.slice(0, 16).replace("T", " ")}</div>
                    </td>
                    <td style={{ padding: "9px 10px", color: "var(--text-muted)" }}>{h.importedBy}</td>
                    <td style={{ padding: "9px 10px", color: "var(--text-faint)", fontSize: "12px", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.fileName || "-"}</td>
                    <td style={{ padding: "9px 10px", color: "var(--text-faint)", fontSize: "12px" }}>{h.companies.join(", ") || "-"}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 800, color: h.newPOs > 0 ? "var(--success)" : "var(--text-faint)" }}>{h.newPOs.toLocaleString()}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: "var(--text-muted)" }}>{h.newLines.toLocaleString()}</td>
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
  const [filterCompany, setFilterCompany] = useState("ทั้งหมด");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
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

  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) for (const c of it.companies || []) set.add(c);
    return ["ทั้งหมด", ...[...set].sort()];
  }, [items]);

  // Search + category/company first (so the quick-filter chip counters reflect
  // them), then the quick filter and the sort.
  const baseFiltered = useMemo(() => {
    // Flexible multi-token AND match across Part No., product name, category,
    // vendor name/code, company — "solar huawei" combines a product keyword with
    // a supplier. Each token also matches ignoring punctuation/spaces/case, so
    // a Part No. typed as "1CSMS-000600" or "1csms 000600" still finds 1CSMS000600.
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    const normTokens = tokens.map(normKey).filter(Boolean);
    return items.filter((it) => {
      if (tokens.length) {
        const haystack = [
          it.itemNumber, it.productName, it.searchName, it.category, it.lastPoNumber,
          ...it.vendors.map((v) => v.vendorName),
          ...it.vendors.map((v) => v.vendorCode),
          ...(it.companies || []),
        ].join(" ").toLowerCase();
        const normHay = normKey(haystack);
        const ok = tokens.every((t, i) => haystack.includes(t) || (normTokens[i] ? normHay.includes(normTokens[i]) : true));
        if (!ok) return false;
      }
      const matchCat = filterCat === "ทั้งหมด" || it.category === filterCat;
      const matchCompany = filterCompany === "ทั้งหมด" || (it.companies || []).includes(filterCompany);
      return matchCat && matchCompany;
    });
  }, [items, search, filterCat, filterCompany]);

  const quickCounts = useMemo(() => ({
    all: baseFiltered.length,
    multi: baseFiltered.filter((it) => it.numVendors > 1).length,
    variance: baseFiltered.filter((it) => itemVariance(it) > HIGH_VARIANCE_PCT).length,
  }), [baseFiltered]);

  const filtered = useMemo(() => {
    const list = baseFiltered.filter((it) =>
      quickFilter === "multi" ? it.numVendors > 1
        : quickFilter === "variance" ? itemVariance(it) > HIGH_VARIANCE_PCT
        : true);
    return [...list].sort((a, b) => {
      if (sortKey === "name") return (a.productName || a.itemNumber).localeCompare(b.productName || b.itemNumber, "th");
      if (sortKey === "vendors") return b.numVendors - a.numVendors;
      if (sortKey === "qty") return b.totalQty - a.totalQty;
      if (sortKey === "variance") return itemVariance(b) - itemVariance(a) || b.numVendors - a.numVendors;
      if (sortKey === "price") return b.lastPrice - a.lastPrice;
      return b.totalSpend - a.totalSpend;
    });
  }, [baseFiltered, quickFilter, sortKey]);

  // Picking a comparison chip ranks the list by price spread, so the items
  // with the biggest price gaps are on top (header + cells light up to match).
  const pickQuick = (q: QuickFilter) => {
    setQuickFilter(q);
    if (q !== "all" && sortKey === "spend") setSortKey("variance");
    if (q === "all" && sortKey === "variance") setSortKey("spend");
  };

  const comparableCount = useMemo(() => items.filter((it) => it.numVendors > 1).length, [items]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", fontFamily: "sans-serif" }}>
      {detail && <ItemDetailModal item={detail} onClose={() => setDetail(null)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showHistory && <ImportHistoryModal onClose={() => setShowHistory(false)} />}

      {/* HERO */}
      <div style={{ background: "linear-gradient(135deg, var(--navy-deep) 0%, var(--navy) 45%, var(--navy-mid) 100%)", padding: "44px 40px 36px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-60px", right: "-60px", width: "240px", height: "240px", borderRadius: "50%", background: "rgba(226,201,126,0.08)" }} />
        <div style={{ maxWidth: "1200px", margin: "0 auto", position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "stretch", flexWrap: "wrap", gap: "20px" }}>
            <div style={{ flex: 1, minWidth: "300px", display: "flex", flexDirection: "column" }}>
              <span style={{ alignSelf: "flex-start", background: "rgba(226,201,126,0.2)", border: "1px solid rgba(226,201,126,0.4)", color: "var(--accent-soft)", padding: "4px 14px", borderRadius: "999px", fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em" }}>PROCUREMENT</span>
              <h1 style={{ margin: "10px 0 8px", color: "white", fontSize: "clamp(24px, 4vw, 36px)", fontWeight: 800, display: "flex", alignItems: "center", gap: "12px" }}><IconPackage size={32} stroke={1.75} /> Item Master</h1>
              <p style={{ margin: "0 0 16px", color: "rgba(255,255,255,0.55)", fontSize: "15px" }}>เปรียบเทียบราคาสินค้าระหว่าง Vendor จากประวัติการสั่งซื้อจริง</p>
              <div style={{ position: "relative" }}>
                <IconSearch size={16} stroke={2} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--navy)" }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา Part No., ชื่อสินค้า, ชื่อ Vendor — พิมพ์หลายคำได้ เช่น huawei inverter"
                  style={{ width: "100%", padding: "13px 14px 13px 38px", borderRadius: "12px", border: "2px solid var(--accent-soft)", boxSizing: "border-box", fontSize: "14px", outline: "none", background: "#fffdf5", color: "var(--navy)" }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "20px" }}>
                {[
                  { label: "สินค้าทั้งหมด", count: items.length.toLocaleString(), icon: IconPackage },
                  { label: "เทียบราคาได้ (>1 Vendor)", count: comparableCount.toLocaleString(), icon: IconScale },
                  { label: "หมวดหมู่", count: (categories.length - 1).toLocaleString(), icon: IconTag },
                ].map((s) => (
                  <div key={s.label} style={{ flex: "1 1 140px", background: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)", borderRadius: "14px", padding: "16px 20px", border: "1px solid rgba(255,255,255,0.12)" }}>
                    <p style={{ margin: "0 0 4px", color: "rgba(255,255,255,0.6)", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "6px" }}><s.icon size={14} stroke={1.75} /> {s.label}</p>
                    <p style={{ margin: 0, fontSize: "24px", fontWeight: 800, color: "white" }}>{s.count}</p>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "12px", width: "250px", flexShrink: 0 }}>
              <button onClick={() => setShowImport(true)} style={{ alignSelf: "flex-end", display: "flex", alignItems: "center", gap: "8px", background: "rgba(226,201,126,0.2)", border: "1px solid rgba(226,201,126,0.5)", color: "var(--accent-soft)", padding: "10px 20px", borderRadius: "12px", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}>
                <IconUpload size={16} stroke={1.75} /> นำเข้าข้อมูล
              </button>
              <button onClick={() => setShowHistory(true)} style={{ alignSelf: "flex-end", display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.85)", padding: "10px 20px", borderRadius: "12px", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}>
                <IconClock size={16} stroke={1.75} /> ประวัติการนำเข้า
              </button>
              <CompanyUpdates />
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* FILTERS */}
        <div style={{ background: "var(--surface)", borderRadius: "20px", padding: "22px", boxShadow: "var(--shadow)", marginBottom: "22px", border: "1px solid rgba(226,201,126,0.2)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "14px", alignItems: "end" }}>
            <div>
              <label style={{ display: "block", marginBottom: "7px", fontSize: "11px", fontWeight: 700, color: "var(--text-faint)" }}>บริษัท</label>
              <select value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)} style={{ width: "100%", padding: "11px 10px", borderRadius: "10px", border: "1.5px solid var(--border)", fontSize: "13px", color: "var(--primary)", background: "var(--surface)" }}>
                {companyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "7px", fontSize: "11px", fontWeight: 700, color: "var(--text-faint)" }}>หมวดหมู่</label>
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={{ width: "100%", padding: "11px 10px", borderRadius: "10px", border: "1.5px solid var(--border)", fontSize: "13px", color: "var(--primary)", background: "var(--surface)" }}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "7px", fontSize: "11px", fontWeight: 700, color: "var(--text-faint)" }}>เรียงตาม</label>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ width: "100%", padding: "11px 10px", borderRadius: "10px", border: "1.5px solid var(--border)", fontSize: "13px", color: "var(--primary)", background: "var(--surface)" }}>
                <option value="spend">ยอดซื้อสูงสุด</option>
                {SHOW_PRICES && <option value="variance">ส่วนต่างราคาสูงสุด</option>}
                {SHOW_PRICES && <option value="price">ราคาล่าสุดสูงสุด</option>}
                <option value="vendors">จำนวน Vendor</option>
                <option value="qty">จำนวนที่ซื้อ</option>
                <option value="name">ชื่อ A-Z</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-faint)" }}>
              แสดง <strong style={{ color: "var(--primary)" }}>{filtered.length}</strong> จาก <strong style={{ color: "var(--primary)" }}>{items.length}</strong> รายการ
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {([
                { key: "all", label: "ทั้งหมด" },
                { key: "multi", label: "มีหลาย Vendor (เปรียบเทียบได้)" },
                ...(SHOW_PRICES ? [{ key: "variance", label: `ส่วนต่างราคาสูง (>${HIGH_VARIANCE_PCT}%)` }] : []),
              ] as { key: QuickFilter; label: string }[]).map((c) => {
                const on = quickFilter === c.key;
                return (
                  <button key={c.key} type="button" onClick={() => pickQuick(c.key)} style={{
                    display: "inline-flex", alignItems: "center", gap: "6px", font: "inherit", fontSize: "12px", fontWeight: on ? 700 : 600, cursor: "pointer",
                    padding: "5px 12px", borderRadius: "999px",
                    border: `1.5px solid ${on ? "var(--accent)" : "var(--border)"}`,
                    background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--text-strong)" : "var(--text-muted)",
                  }}>
                    {c.key === "multi" && <IconScale size={13} stroke={1.75} />}
                    {c.label}
                    <span style={{ minWidth: 18, textAlign: "center", fontSize: "10px", fontWeight: 700, borderRadius: "999px", padding: "0 6px", background: "var(--surface-2)", color: "var(--text-muted)" }}>
                      {quickCounts[c.key].toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {loading && <p style={{ textAlign: "center", color: "var(--text-faint)", padding: "60px" }}>กำลังโหลด...</p>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 40px", background: "var(--surface)", borderRadius: "20px", boxShadow: "var(--shadow)" }}>
            <div style={{ marginBottom: "16px", display: "flex", justifyContent: "center", color: "var(--text-faint)" }}><IconPackage size={56} stroke={1.25} /></div>
            <h3 style={{ margin: "0 0 8px", color: "var(--primary)", fontSize: "20px", fontWeight: 700 }}>{items.length === 0 ? "ยังไม่มีข้อมูลสินค้า" : "ไม่พบสินค้า"}</h3>
            <p style={{ margin: 0, color: "var(--text-faint)", fontSize: "15px" }}>{items.length === 0 ? "กดปุ่ม “นำเข้าข้อมูล” เพื่ออัพโหลดไฟล์ PO" : "ลองเปลี่ยน keyword หรือ filter"}</p>
          </div>
        )}

        {/* TABLE */}
        {!loading && filtered.length > 0 && (
          <div style={{ background: "var(--surface)", borderRadius: "20px", boxShadow: "var(--shadow)", overflow: "hidden", border: "1px solid rgba(226,201,126,0.15)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "linear-gradient(135deg, var(--navy), var(--navy-mid))" }}>
                  {([
                    { h: "รหัส" }, { h: "ชื่อสินค้า" }, { h: "PO ล่าสุด" }, { h: "บริษัท" }, { h: "Vendor" },
                    ...(SHOW_PRICES ? [{ h: "ราคาต่อหน่วยล่าสุด", right: true, sort: "price" }, { h: "ส่วนต่างราคา", right: true, sort: "variance" }] : []),
                    { h: "PO date", right: true },
                  ] as { h: string; right?: boolean; sort?: SortKey }[]).map((c) => {
                    const active = !!c.sort && sortKey === c.sort;
                    return (
                      <th key={c.h} onClick={c.sort ? () => setSortKey(c.sort!) : undefined}
                        style={{
                          padding: "13px 14px", textAlign: c.right ? "right" : "left", fontWeight: 700, fontSize: "12px", whiteSpace: "nowrap",
                          color: active ? "var(--accent-soft)" : "rgba(255,255,255,0.85)", cursor: c.sort ? "pointer" : "default",
                          boxShadow: active ? "inset 0 -3px 0 var(--accent)" : undefined,
                        }}>
                        {c.h}{active ? " ▼" : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((it, i) => (
                  <tr key={it.itemNumber} onClick={() => setDetail(it)}
                    onMouseEnter={() => setHoveredId(it.itemNumber)} onMouseLeave={() => setHoveredId(null)}
                    style={{ borderBottom: "1px solid var(--border)", cursor: "pointer", background: hoveredId === it.itemNumber ? "var(--surface-2)" : i % 2 === 0 ? "var(--surface)" : "var(--surface-2)" }}>
                    <td style={{ padding: "13px 14px", color: "var(--text-faint)", fontWeight: 700, fontSize: "12px", whiteSpace: "nowrap" }}>{highlight(it.itemNumber, search)}</td>
                    <td style={{ padding: "13px 14px", fontWeight: 700, color: "var(--primary)", maxWidth: "300px" }}>{highlight(it.productName || it.itemNumber, search)}</td>
                    <td style={{ padding: "13px 14px", color: "var(--text-faint)", fontSize: "12px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{it.lastPoNumber || "-"}</td>
                    <td style={{ padding: "13px 14px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {(it.companies || []).length === 0 && <span style={{ color: "var(--text-faint)", fontSize: "12px" }}>-</span>}
                        {(it.companies || []).map((c) => (
                          <span key={c} style={{ background: "var(--surface-2)", color: "var(--primary)", padding: "1px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 700 }}>{c}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: "13px 14px", maxWidth: "260px", color: "var(--text-muted)", fontSize: "12px" }}
                      title={it.vendors.map((v) => v.vendorName).filter(Boolean).join(", ") || "-"}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {it.numVendors > 1 && (
                          <span style={{ flexShrink: 0, background: "color-mix(in srgb, var(--info) 16%, transparent)", color: "var(--info)", borderRadius: "999px", padding: "1px 8px", fontSize: "10.5px", fontWeight: 800, whiteSpace: "nowrap" }}>
                            {it.numVendors} Vendors
                          </span>
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {it.vendors.map((v) => v.vendorName).filter(Boolean).join(", ") || "-"}
                        </span>
                      </div>
                    </td>
                    {SHOW_PRICES && (() => {
                      const vp = itemVariance(it);
                      const hot = vp > HIGH_VARIANCE_PCT;
                      const sortedByVar = sortKey === "variance";
                      return (
                        <>
                          <td style={{ padding: "13px 14px", textAlign: "right", fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", background: sortKey === "price" ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined }}>
                            {it.lastPrice > 0 ? baht(it.lastPrice) : "—"}
                          </td>
                          <td style={{ padding: "13px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", background: sortedByVar ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined }}>
                            {vp > 0 ? (
                              <>
                                <span style={{
                                  display: "inline-block", fontWeight: 800, fontSize: "12px", borderRadius: "999px", padding: "1px 9px",
                                  color: hot ? "var(--danger)" : "var(--text-muted)",
                                  background: hot ? "color-mix(in srgb, var(--danger) 14%, transparent)" : "var(--surface-2)",
                                }}>{fmtPct(vp)}</span>
                                <div style={{ fontSize: "10.5px", color: "var(--text-faint)", marginTop: 2 }}>{baht(it.minPrice)} – {baht(it.maxPrice)}</div>
                              </>
                            ) : <span style={{ color: "var(--text-faint)" }}>—</span>}
                          </td>
                        </>
                      );
                    })()}
                    <td style={{ padding: "13px 14px", textAlign: "right", color: "var(--text-faint)", fontSize: "12px", whiteSpace: "nowrap" }}>{it.lastDate || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 300 && (
              <p style={{ textAlign: "center", padding: "14px", color: "var(--text-faint)", fontSize: "13px", margin: 0 }}>แสดง 300 รายการแรก — ใช้ค้นหา/filter เพื่อดูที่เหลือ</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
