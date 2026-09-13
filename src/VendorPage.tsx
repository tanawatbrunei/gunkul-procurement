import { useState, useEffect, useMemo } from "react";
import {
  collection, onSnapshot, updateDoc, deleteDoc, doc,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, AreaChart, Area, CartesianGrid,
} from "recharts";
import { fetchVendorPOLines, countsAsSpend, type POLine } from "./data/procurement";
import { isAdmin } from "./config/admins";
import ImportModal from "./components/ImportModal";
import CompanyUpdates from "./components/CompanyUpdates";

type VendorStatus = "active" | "inactive";
type ViewMode = "card" | "table";
type SortKey = "spend" | "name" | "lastPurchase";

const CATEGORIES = [
  "สายไฟ AC", "สายไฟ DC", "แผงโซลาร์ (Solar Panel)", "Inverter & Optimizer",
  "Transformer", "Switchgear & MDB", "อุปกรณ์ป้องกัน (Surge, Breaker, Fuse)",
  "Battery & Energy Storage", "Mounting Structure", "โยธา & งานฐานราก",
  "นั่งร้าน (Scaffolding)", "รั้ว & งานภูมิทัศน์", "ขนส่ง & โลจิสติกส์",
  "ติดตั้ง & Commissioning", "ตรวจสอบ & Survey (วิศวกร)", "ประกันภัย",
  "Monitoring System", "SCADA & Software", "IT & Network",
  "เครื่องมือ & อุปกรณ์ช่าง", "PPE & Safety",
  "ค่าแรง", "งาน Subcontract", "งานบริการ & บำรุงรักษา (O&M)", "งานบริหารโครงการ",
  "ค่าเช่า", "อุปกรณ์/งานสำนักงาน", "สวัสดิการ & บุคคล",
  "ค่าธรรมเนียม & สาธารณูปโภค", "ยานพาหนะ", "อื่นๆ",
];

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  "สายไฟ AC": { bg: "#fef3c7", color: "#b45309" },
  "สายไฟ DC": { bg: "#fef9c3", color: "#a16207" },
  "แผงโซลาร์ (Solar Panel)": { bg: "#d1fae5", color: "#065f46" },
  "Inverter & Optimizer": { bg: "#dbeafe", color: "#1e40af" },
  "Transformer": { bg: "#ede9fe", color: "#6d28d9" },
  "Switchgear & MDB": { bg: "#fce7f3", color: "#9d174d" },
  "อุปกรณ์ป้องกัน (Surge, Breaker, Fuse)": { bg: "#fee2e2", color: "#991b1b" },
  "Battery & Energy Storage": { bg: "#ccfbf1", color: "#0f766e" },
  "Mounting Structure": { bg: "#e0f2fe", color: "#0369a1" },
  "โยธา & งานฐานราก": { bg: "#f3f4f6", color: "#374151" },
  "นั่งร้าน (Scaffolding)": { bg: "#fef3c7", color: "#92400e" },
  "รั้ว & งานภูมิทัศน์": { bg: "#ecfccb", color: "#3f6212" },
  "ขนส่ง & โลจิสติกส์": { bg: "#e0f2fe", color: "#075985" },
  "ติดตั้ง & Commissioning": { bg: "#d1fae5", color: "#064e3b" },
  "ตรวจสอบ & Survey (วิศวกร)": { bg: "#ede9fe", color: "#5b21b6" },
  "ประกันภัย": { bg: "#fce7f3", color: "#831843" },
  "Monitoring System": { bg: "#dbeafe", color: "#1d4ed8" },
  "SCADA & Software": { bg: "#e0e7ff", color: "#3730a3" },
  "IT & Network": { bg: "#f0fdf4", color: "#166534" },
  "เครื่องมือ & อุปกรณ์ช่าง": { bg: "#f3f4f6", color: "#1f2937" },
  "PPE & Safety": { bg: "#fff7ed", color: "#c2410c" },
  "ค่าแรง": { bg: "#fef2f2", color: "#b91c1c" },
  "งาน Subcontract": { bg: "#eef2ff", color: "#4338ca" },
  "งานบริการ & บำรุงรักษา (O&M)": { bg: "#f0fdfa", color: "#0d9488" },
  "งานบริหารโครงการ": { bg: "#faf5ff", color: "#7e22ce" },
  "ค่าเช่า": { bg: "#fffbeb", color: "#a16207" },
  "อุปกรณ์/งานสำนักงาน": { bg: "#f8fafc", color: "#475569" },
  "สวัสดิการ & บุคคล": { bg: "#fdf2f8", color: "#be185d" },
  "ค่าธรรมเนียม & สาธารณูปโภค": { bg: "#f1f5f9", color: "#334155" },
  "ยานพาหนะ": { bg: "#fef9c3", color: "#854d0e" },
  "อื่นๆ": { bg: "#f9fafb", color: "#6b7280" },
};
const catColor = (c: string) => CATEGORY_COLORS[c] || { bg: "#f3f4f6", color: "#374151" };
const GROUP_LABEL: Record<string, string> = {
  LOCAL: "🇹🇭 Local", GROUP: "🏢 ในเครือ", OVERSEA: "🌏 Oversea", EMP: "👤 Employee",
};

interface Vendor {
  id: string;
  vendorCode: string;
  name: string;
  vendorGroup: string;
  categories: string[];
  totalSpend: number;
  numPOs: number;
  lastPurchase: string;
  topPaymentTerms: string;
  topProject: string;
  categorySpend: Record<string, number>;
  monthlySpend: Record<string, number>;
  status: VendorStatus;
  note: string;
  source: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  companies: string[];
}

function bahtFull(n: number) {
  return "฿" + (n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
}
function bahtShort(n: number) {
  const v = n || 0;
  if (Math.abs(v) >= 1_000_000) return "฿" + (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000) return "฿" + (v / 1_000).toFixed(0) + "K";
  return "฿" + v.toFixed(0);
}
function monthLabel(ym: string) {
  const TH = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const [y, m] = ym.split("-");
  return TH[parseInt(m)] + (parseInt(y) + 543 - 2500);
}
function highlight(text: string, search: string) {
  if (!search || !text) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${search})`, "gi"));
  return (
    <span>
      {parts.map((p, i) =>
        p.toLowerCase() === search.toLowerCase()
          ? <mark key={i} style={{ background: "#e2c97e", borderRadius: "2px", padding: "0 2px", color: "#1a3c6e" }}>{p}</mark>
          : p
      )}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div style={{ background: "white", borderRadius: "16px", padding: "24px", boxShadow: "0 2px 12px rgba(26,60,110,0.08)", borderTop: "3px solid #e2e8f0" }}>
      {[70, 40, 80, 60, 50].map((w, i) => (
        <div key={i} style={{ height: "11px", background: "linear-gradient(90deg, #f1f5f9, #e2e8f0, #f1f5f9)", backgroundSize: "200% 100%", borderRadius: "6px", width: `${w}%`, marginBottom: "14px", animation: "shimmer 1.5s infinite" }} />
      ))}
    </div>
  );
}

function CategoryChips({ cats, max, search }: { cats: string[]; max?: number; search?: string }) {
  const show = max ? cats.slice(0, max) : cats;
  const extra = max && cats.length > max ? cats.length - max : 0;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {show.map(c => {
        const cc = catColor(c);
        return <span key={c} style={{ background: cc.bg, color: cc.color, padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: "700" }}>
          {search ? highlight(c, search) : c}
        </span>;
      })}
      {extra > 0 && <span style={{ background: "#1a3c6e", color: "white", padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: "700" }}>+{extra}</span>}
    </div>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 20px rgba(26,60,110,0.07)", border: "1px solid #eef2f7" }}>
      <p style={{ margin: "0 0 2px", fontSize: "14px", fontWeight: "800", color: "#1a3c6e" }}>{title}</p>
      {hint && <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#94a3b8" }}>{hint}</p>}
      {children}
    </div>
  );
}

function VendorDetailModal({ vendor, onClose, onDelete, onToggleStatus, onSaveCategories, onSaveNote, onSaveContact }: {
  vendor: Vendor; onClose: () => void; onDelete: () => void; onToggleStatus: () => void;
  onSaveCategories: (cats: string[]) => void; onSaveNote: (note: string) => void;
  onSaveContact: (contact: { contactPerson: string; contactPhone: string; contactEmail: string }) => void;
}) {
  const [editingCats, setEditingCats] = useState(false);
  const [cats, setCats] = useState<string[]>(vendor.categories || []);
  const [note, setNote] = useState(vendor.note || "");
  const toggleCat = (c: string) => setCats(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c]);

  const [contactPerson, setContactPerson] = useState(vendor.contactPerson || "");
  const [contactPhone, setContactPhone] = useState(vendor.contactPhone || "");
  const [contactEmail, setContactEmail] = useState(vendor.contactEmail || "");
  const [contactSaved, setContactSaved] = useState(false);
  const saveContact = () => {
    onSaveContact({ contactPerson, contactPhone, contactEmail });
    setContactSaved(true);
    setTimeout(() => setContactSaved(false), 2000);
  };

  // PO drill-down: lazy-load this vendor's PO lines, grouped by PO number.
  const [poLines, setPoLines] = useState<POLine[] | null>(null);
  const [expandedPO, setExpandedPO] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchVendorPOLines(vendor.vendorCode).then(ls => { if (alive) setPoLines(ls); });
    return () => { alive = false; };
  }, [vendor.vendorCode]);

  const poGroups = useMemo(() => {
    if (!poLines) return [];
    const map = new Map<string, { poNumber: string; date: string; status: string; amount: number; lines: POLine[] }>();
    for (const l of poLines) {
      let g = map.get(l.poNumber);
      if (!g) { g = { poNumber: l.poNumber, date: l.poDate, status: l.status, amount: 0, lines: [] }; map.set(l.poNumber, g); }
      g.lines.push(l);
      if (countsAsSpend(l.status)) g.amount += l.amountTHB;
      if (l.poDate > g.date) g.date = l.poDate;
    }
    return [...map.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [poLines]);

  const catData = useMemo(() =>
    Object.entries(vendor.categorySpend || {})
      .map(([name, value]) => ({ name, value: Math.max(value, 0) }))
      .filter(d => d.value > 0).sort((a, b) => b.value - a.value),
    [vendor]);
  const monthData = useMemo(() =>
    Object.entries(vendor.monthlySpend || {}).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, v]) => ({ m: monthLabel(ym), v })),
    [vendor]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: "24px", width: "600px", maxWidth: "94vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 32px 80px rgba(26,60,110,0.3)" }} onClick={e => e.stopPropagation()}>
        <div style={{ background: "linear-gradient(135deg, #1a3c6e 0%, #2d5a9e 100%)", padding: "30px 32px", borderRadius: "24px 24px 0 0", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "-20px", right: "-20px", width: "120px", height: "120px", borderRadius: "50%", background: "rgba(226,201,126,0.12)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
            <div style={{ flex: 1, marginRight: "12px" }}>
              <p style={{ margin: "0 0 4px", color: "rgba(226,201,126,0.9)", fontSize: "12px", fontWeight: "700" }}>{vendor.vendorCode} · {GROUP_LABEL[vendor.vendorGroup] || vendor.vendorGroup}</p>
              <h2 style={{ margin: "0 0 8px", color: "white", fontSize: "20px", fontWeight: "700", lineHeight: "1.3" }}>{vendor.name}</h2>
              {(vendor.companies || []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {vendor.companies.map((c) => (
                    <span key={c} style={{ background: "rgba(255,255,255,0.15)", color: "white", padding: "2px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: "700" }}>{c}</span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: "36px", height: "36px", cursor: "pointer", color: "white", fontSize: "18px", flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ marginTop: "16px" }}>
            <button onClick={onToggleStatus} style={{
              padding: "6px 18px", borderRadius: "999px", border: "2px solid",
              borderColor: vendor.status === "active" ? "rgba(226,201,126,0.6)" : "rgba(255,255,255,0.3)",
              background: vendor.status === "active" ? "rgba(226,201,126,0.2)" : "rgba(255,255,255,0.1)",
              color: vendor.status === "active" ? "#e2c97e" : "rgba(255,255,255,0.7)", cursor: "pointer", fontWeight: "700", fontSize: "13px",
            }}>{vendor.status === "active" ? "✅ Active — คลิกเพื่อเปลี่ยน" : "❌ Inactive — คลิกเพื่อเปลี่ยน"}</button>
          </div>
        </div>

        <div style={{ padding: "26px 32px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "22px" }}>
            {[
              { label: "ยอดซื้อสะสม", value: bahtFull(vendor.totalSpend) },
              { label: "จำนวน PO", value: vendor.numPOs?.toLocaleString() },
              { label: "ซื้อล่าสุด", value: vendor.lastPurchase },
            ].map(s => (
              <div key={s.label} style={{ background: "linear-gradient(135deg, #f8faff, #eef2ff)", borderRadius: "12px", padding: "14px", textAlign: "center", border: "1px solid #e0e7ff" }}>
                <p style={{ margin: "0 0 4px", fontSize: "10px", color: "#94a3b8", fontWeight: "700" }}>{s.label}</p>
                <p style={{ margin: 0, fontSize: "15px", color: "#1a3c6e", fontWeight: "800" }}>{s.value}</p>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "20px", marginBottom: "22px", fontSize: "13px", color: "#475569" }}>
            <div><span style={{ color: "#94a3b8" }}>เงื่อนไขชำระ: </span><strong>{vendor.topPaymentTerms || "-"}</strong></div>
            <div><span style={{ color: "#94a3b8" }}>โปรเจกต์หลัก: </span><strong>{vendor.topProject || "-"}</strong></div>
          </div>

          <div style={{ marginBottom: "22px", background: "#f8faff", borderRadius: "14px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8", fontWeight: "700" }}>📇 ข้อมูลติดต่อ — แก้ไขได้ทุกคน</p>
              {contactSaved && <span style={{ fontSize: "11px", color: "#16a34a", fontWeight: "700" }}>✓ บันทึกแล้ว</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "10px", color: "#94a3b8", fontWeight: "700" }}>ชื่อผู้ติดต่อ</label>
                <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="เช่น คุณสมชาย"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0", fontSize: "13px", boxSizing: "border-box", color: "#1a3c6e", background: "white" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "10px", color: "#94a3b8", fontWeight: "700" }}>เบอร์โทร</label>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="08X-XXX-XXXX"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0", fontSize: "13px", boxSizing: "border-box", color: "#1a3c6e", background: "white" }} />
              </div>
            </div>
            <div style={{ marginBottom: "10px" }}>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "10px", color: "#94a3b8", fontWeight: "700" }}>อีเมล</label>
              <input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="name@company.com"
                style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0", fontSize: "13px", boxSizing: "border-box", color: "#1a3c6e", background: "white" }} />
            </div>
            <button onClick={saveContact} style={{ width: "100%", padding: "9px", background: "linear-gradient(135deg, #1a3c6e, #2d5a9e)", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "700", color: "white", fontSize: "13px" }}>
              💾 บันทึกข้อมูลติดต่อ
            </button>
          </div>

          {catData.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: monthData.length > 1 ? "1fr 1fr" : "1fr", gap: "16px", marginBottom: "22px" }}>
              <div style={{ background: "#f8faff", borderRadius: "14px", padding: "16px" }}>
                <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: "800", color: "#1a3c6e" }}>ยอดซื้อแยกหมวด</p>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={catData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={32} outerRadius={60} paddingAngle={2}>
                      {catData.map((d, i) => <Cell key={i} fill={catColor(d.name).color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => bahtFull(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" }}>
                  {catData.slice(0, 4).map(d => (
                    <div key={d.name} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "#475569" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: catColor(d.name).color }} />{d.name}
                      </span>
                      <strong style={{ color: "#1a3c6e" }}>{bahtShort(d.value)}</strong>
                    </div>
                  ))}
                </div>
              </div>
              {monthData.length > 1 && (
                <div style={{ background: "#f8faff", borderRadius: "14px", padding: "16px" }}>
                  <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: "800", color: "#1a3c6e" }}>ยอดซื้อรายเดือน</p>
                  <ResponsiveContainer width="100%" height={170}>
                    <AreaChart data={monthData} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1a3c6e" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#1a3c6e" stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                      <XAxis dataKey="m" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                      <YAxis tickFormatter={(v: any) => bahtShort(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} width={48} />
                      <Tooltip formatter={(v: any) => bahtFull(v)} />
                      <Area type="linear" dataKey="v" stroke="#1a3c6e" strokeWidth={2} fill="url(#vg)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8", fontWeight: "700" }}>หมวดหมู่ ({cats.length})</p>
              {!editingCats
                ? <button onClick={() => setEditingCats(true)} style={{ background: "none", border: "1px solid #bfdbfe", color: "#1a3c6e", borderRadius: "8px", padding: "4px 12px", cursor: "pointer", fontSize: "12px", fontWeight: "700" }}>✏️ แก้หมวด</button>
                : <button onClick={() => { onSaveCategories(cats); setEditingCats(false); }} style={{ background: "linear-gradient(135deg, #1a3c6e, #2d5a9e)", border: "none", color: "white", borderRadius: "8px", padding: "4px 14px", cursor: "pointer", fontSize: "12px", fontWeight: "700" }}>💾 บันทึก</button>}
            </div>
            {!editingCats ? (
              cats.length ? <CategoryChips cats={cats} /> : <p style={{ margin: 0, color: "#cbd5e1", fontSize: "13px" }}>ยังไม่มีหมวด</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", maxHeight: "200px", overflowY: "auto", padding: "4px" }}>
                {CATEGORIES.map(c => {
                  const on = cats.includes(c); const cc = catColor(c);
                  return <button key={c} onClick={() => toggleCat(c)} style={{
                    padding: "5px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: "700", cursor: "pointer",
                    border: on ? `2px solid ${cc.color}` : "1.5px solid #e2e8f0",
                    background: on ? cc.bg : "white", color: on ? cc.color : "#94a3b8",
                  }}>{on ? "✓ " : ""}{c}</button>;
                })}
              </div>
            )}
          </div>

          {/* PO HISTORY */}
          <div style={{ marginBottom: "22px" }}>
            <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#94a3b8", fontWeight: "700" }}>
              🧾 ประวัติใบสั่งซื้อ {poGroups.length > 0 && `(${poGroups.length} PO)`}
            </p>
            {poLines === null ? (
              <p style={{ margin: 0, color: "#cbd5e1", fontSize: "13px" }}>กำลังโหลด...</p>
            ) : poGroups.length === 0 ? (
              <p style={{ margin: 0, color: "#cbd5e1", fontSize: "13px" }}>ยังไม่มีข้อมูล PO — นำเข้าไฟล์ All_Purchase orders ก่อน</p>
            ) : (
              <div style={{ maxHeight: "260px", overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: "12px" }}>
                {poGroups.map(g => {
                  const open = expandedPO === g.poNumber;
                  return (
                    <div key={g.poNumber} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <button onClick={() => setExpandedPO(open ? null : g.poNumber)} style={{
                        width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 14px", border: "none", background: open ? "#f8faff" : "white", cursor: "pointer", textAlign: "left",
                      }}>
                        <span style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: "#1a3c6e" }}>{open ? "▼" : "▶"} {g.poNumber}</span>
                          <span style={{ fontSize: "11px", color: "#94a3b8" }}>{g.date || "-"} · {g.lines.length} รายการ{g.status === "Canceled" ? " · ยกเลิก" : ""}</span>
                        </span>
                        <strong style={{ fontSize: "13px", color: "#1a3c6e" }}>{bahtFull(g.amount)}</strong>
                      </button>
                      {open && (
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", background: "#fafbff" }}>
                          <tbody>
                            {g.lines.map((l, i) => (
                              <tr key={i} style={{ borderTop: "1px solid #eef2f7" }}>
                                <td style={{ padding: "7px 14px", color: "#475569" }}>
                                  {l.itemNumber && <span style={{ color: "#94a3b8", marginRight: "6px" }}>{l.itemNumber}</span>}
                                  {l.productName || l.category || "-"}
                                </td>
                                <td style={{ padding: "7px 10px", textAlign: "right", color: "#94a3b8", whiteSpace: "nowrap" }}>{l.qty ? `${l.qty.toLocaleString()} ${l.unit}` : ""}</td>
                                <td style={{ padding: "7px 14px", textAlign: "right", fontWeight: "700", color: "#1a3c6e", whiteSpace: "nowrap" }}>{bahtFull(l.amountTHB)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ marginBottom: "22px" }}>
            <p style={{ margin: "0 0 8px", fontSize: "11px", color: "#94a3b8", fontWeight: "700" }}>💬 หมายเหตุ</p>
            <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={() => onSaveNote(note)} rows={2}
              placeholder="พิมพ์หมายเหตุ แล้วคลิกที่อื่นเพื่อบันทึก..."
              style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1.5px solid #e2e8f0", boxSizing: "border-box", resize: "vertical", fontSize: "14px", color: "#1a3c6e", background: "white" }} />
          </div>

          {isAdmin(auth.currentUser?.email) ? (
            <button onClick={onDelete} style={{ width: "100%", padding: "13px", background: "linear-gradient(135deg, #fff5f5, #fee2e2)", border: "1px solid #fecaca", borderRadius: "12px", cursor: "pointer", fontWeight: "700", color: "#dc2626", fontSize: "14px" }}>🗑️ ลบ Vendor นี้</button>
          ) : (
            <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8", textAlign: "center" }}>🔒 การลบ Vendor ทำได้เฉพาะ admin — ติดต่อผู้ดูแลระบบถ้าต้องการลบ</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VendorPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("ทั้งหมด");
  const [filterStatus, setFilterStatus] = useState("ทั้งหมด");
  const [filterGroup, setFilterGroup] = useState("ทั้งหมด");
  const [filterCompany, setFilterCompany] = useState("ทั้งหมด");
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [detailVendor, setDetailVendor] = useState<Vendor | undefined>();
  const [showCharts, setShowCharts] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "vendors"), (snap) => {
      setVendors(snap.docs.map(d => {
        const r = d.data() as any;
        return {
          id: d.id, vendorCode: r.vendorCode || d.id, name: r.name || "",
          vendorGroup: r.vendorGroup || "", categories: r.categories || [],
          totalSpend: r.totalSpend || 0, numPOs: r.numPOs || 0,
          lastPurchase: r.lastPurchase || "", topPaymentTerms: r.topPaymentTerms || "",
          topProject: r.topProject || "", categorySpend: r.categorySpend || {},
          monthlySpend: r.monthlySpend || {}, status: r.status || "active",
          note: r.note || "", source: r.source || "",
          contactPerson: r.contactPerson || "", contactPhone: r.contactPhone || "", contactEmail: r.contactEmail || "",
          companies: r.companies || [],
        } as Vendor;
      }));
      setLoading(false);
    }, (err) => {
      console.error("vendors snapshot error:", err);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const overview = useMemo(() => {
    const cat: Record<string, number> = {};
    const mon: Record<string, number> = {};
    for (const v of vendors) {
      for (const [k, val] of Object.entries(v.categorySpend || {})) cat[k] = (cat[k] || 0) + val;
      for (const [k, val] of Object.entries(v.monthlySpend || {})) mon[k] = (mon[k] || 0) + val;
    }
    const catData = Object.entries(cat).map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value).slice(0, 10);
    const monData = Object.entries(mon)
      .filter(([ym]) => ym >= "2025-01") // start the chart at Jan 2025 (2568) — older months are noise, mostly empty
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, v]) => ({ m: monthLabel(ym), v }));
    const topVendors = [...vendors].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 10)
      .map(v => ({ name: v.name.replace(/^บจก\.|^บมจ\.|^หจก\./, "").trim().slice(0, 18), value: v.totalSpend }));
    return { catData, monData, topVendors };
  }, [vendors]);

  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of vendors) for (const c of v.companies || []) set.add(c);
    return ["ทั้งหมด", ...[...set].sort()];
  }, [vendors]);

  const filtered = vendors.filter(v => {
    const s = search.toLowerCase();
    const matchSearch = s === "" || v.name.toLowerCase().includes(s) ||
      v.vendorCode.toLowerCase().includes(s) ||
      v.categories.some(c => c.toLowerCase().includes(s)) ||
      v.note.toLowerCase().includes(s) ||
      v.contactPerson.toLowerCase().includes(s) ||
      (v.companies || []).some(c => c.toLowerCase().includes(s));
    const matchCat = filterCategory === "ทั้งหมด" || v.categories.includes(filterCategory);
    const matchStatus = filterStatus === "ทั้งหมด" || v.status === filterStatus;
    const matchGroup = filterGroup === "ทั้งหมด" || v.vendorGroup === filterGroup;
    const matchCompany = filterCompany === "ทั้งหมด" || (v.companies || []).includes(filterCompany);
    return matchSearch && matchCat && matchStatus && matchGroup && matchCompany;
  }).sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name, "th");
    if (sortKey === "lastPurchase") return (b.lastPurchase || "").localeCompare(a.lastPurchase || "");
    return b.totalSpend - a.totalSpend;
  });

  const totalSpendAll = vendors.reduce((s, v) => s + v.totalSpend, 0);

  const exportToExcel = () => {
    const data = filtered.map((v) => ({
      "รหัส": v.vendorCode,
      "ชื่อบริษัท": v.name,
      "กลุ่ม": GROUP_LABEL[v.vendorGroup] || v.vendorGroup,
      "บริษัทในเครือ": (v.companies || []).join(", "),
      "หมวดหมู่": v.categories.join(", "),
      "ยอดซื้อสะสม": v.totalSpend,
      "จำนวน PO": v.numPOs,
      "ซื้อล่าสุด": v.lastPurchase,
      "เงื่อนไขชำระ": v.topPaymentTerms,
      "โปรเจกต์หลัก": v.topProject,
      "สถานะ": v.status === "active" ? "Active" : "Inactive",
      "ผู้ติดต่อ": v.contactPerson,
      "เบอร์โทร": v.contactPhone,
      "อีเมล": v.contactEmail,
      "หมายเหตุ": v.note,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vendors");
    XLSX.writeFile(wb, "vendors.xlsx");
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("ต้องการลบ Vendor นี้มั้ย?")) {
      await deleteDoc(doc(db, "vendors", id));
      setDetailVendor(undefined);
    }
  };
  const handleToggleStatus = async (v: Vendor) => {
    const ns: VendorStatus = v.status === "active" ? "inactive" : "active";
    await updateDoc(doc(db, "vendors", v.id), { status: ns });
    if (detailVendor?.id === v.id) setDetailVendor({ ...detailVendor, status: ns });
  };
  const handleSaveCategories = async (v: Vendor, cats: string[]) => {
    await updateDoc(doc(db, "vendors", v.id), { categories: cats });
    if (detailVendor?.id === v.id) setDetailVendor({ ...detailVendor, categories: cats });
  };
  const handleSaveNote = async (v: Vendor, note: string) => {
    await updateDoc(doc(db, "vendors", v.id), { note });
  };
  const handleSaveContact = async (v: Vendor, contact: { contactPerson: string; contactPhone: string; contactEmail: string }) => {
    await updateDoc(doc(db, "vendors", v.id), contact);
    if (detailVendor?.id === v.id) setDetailVendor({ ...detailVendor, ...contact });
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #f0f4ff 0%, #e8edf8 50%, #f5f0e8 100%)", fontFamily: "sans-serif" }}>
      <style>{`
        @keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
        .vendor-card { transition: transform 0.28s cubic-bezier(0.22,1,0.36,1), box-shadow 0.28s cubic-bezier(0.22,1,0.36,1); cursor: pointer; animation: fadeInUp 0.4s ease both; }
        .vendor-card:hover { transform: translateY(-6px); box-shadow: 0 20px 48px rgba(26,60,110,0.16) !important; }
      `}</style>

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}

      {detailVendor && (
        <VendorDetailModal vendor={detailVendor}
          onClose={() => setDetailVendor(undefined)}
          onDelete={() => handleDelete(detailVendor.id)}
          onToggleStatus={() => handleToggleStatus(detailVendor)}
          onSaveCategories={(c) => handleSaveCategories(detailVendor, c)}
          onSaveNote={(n) => handleSaveNote(detailVendor, n)}
          onSaveContact={(c) => handleSaveContact(detailVendor, c)} />
      )}

      {/* HERO */}
      <div style={{ background: "linear-gradient(135deg, #0f2244 0%, #1a3c6e 45%, #2d5a9e 100%)", padding: "44px 40px 36px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-60px", right: "-60px", width: "240px", height: "240px", borderRadius: "50%", background: "rgba(226,201,126,0.08)" }} />
        <div style={{ maxWidth: "1200px", margin: "0 auto", position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "stretch", flexWrap: "wrap", gap: "20px" }}>
            <div style={{ flex: 1, minWidth: "300px", display: "flex", flexDirection: "column" }}>
              <span style={{ alignSelf: "flex-start", background: "rgba(226,201,126,0.2)", border: "1px solid rgba(226,201,126,0.4)", color: "#e2c97e", padding: "4px 14px", borderRadius: "999px", fontSize: "12px", fontWeight: "700", letterSpacing: "0.08em" }}>PROCUREMENT</span>
              <h1 style={{ margin: "10px 0 8px", color: "white", fontSize: "clamp(24px, 4vw, 36px)", fontWeight: "800" }}>🏢 Vendor Directory</h1>
              <p style={{ margin: 0, color: "rgba(255,255,255,0.55)", fontSize: "15px" }}>ฐานข้อมูล Vendor จากประวัติการสั่งซื้อจริง</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "auto", paddingTop: "24px" }}>
                {[
                  { label: "Vendor ทั้งหมด", count: vendors.length.toLocaleString(), icon: "🏢" },
                  { label: "Active", count: vendors.filter(v => v.status === "active").length.toLocaleString(), icon: "✅" },
                  { label: "Inactive", count: vendors.filter(v => v.status === "inactive").length.toLocaleString(), icon: "⏸️" },
                  { label: "มูลค่าซื้อรวม", count: bahtShort(totalSpendAll), icon: "💰" },
                ].map(s => (
                  <div key={s.label} style={{ flex: "1 1 140px", background: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)", borderRadius: "14px", padding: "16px 20px", border: "1px solid rgba(255,255,255,0.12)" }}>
                    <p style={{ margin: "0 0 4px", color: "rgba(255,255,255,0.6)", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap" }}>{s.icon} {s.label}</p>
                    <p style={{ margin: 0, fontSize: "26px", fontWeight: "800", color: "white" }}>{s.count}</p>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "12px", width: "250px", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: "8px", alignSelf: "flex-end" }}>
                <button onClick={exportToExcel} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", color: "white", padding: "10px 16px", borderRadius: "12px", cursor: "pointer", fontWeight: "700", fontSize: "14px", whiteSpace: "nowrap" }}>
                  📊 Export
                </button>
                <button onClick={() => setShowImport(true)} style={{ background: "rgba(226,201,126,0.2)", border: "1px solid rgba(226,201,126,0.5)", color: "#e2c97e", padding: "10px 20px", borderRadius: "12px", cursor: "pointer", fontWeight: "700", fontSize: "14px", whiteSpace: "nowrap" }}>
                  📥 นำเข้าข้อมูล
                </button>
              </div>
              <CompanyUpdates />
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* OVERVIEW CHARTS */}
        {!loading && vendors.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: "800", color: "#1a3c6e" }}>📊 ภาพรวมการจัดซื้อ</h2>
              <button onClick={() => setShowCharts(s => !s)} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "6px 14px", cursor: "pointer", fontSize: "13px", fontWeight: "700", color: "#64748b" }}>{showCharts ? "ซ่อน ▲" : "แสดง ▼"}</button>
            </div>
            {showCharts && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <ChartCard title="ยอดซื้อรายเดือน" hint="มูลค่าการสั่งซื้อรวมทุก vendor แยกตามเดือน">
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={overview.monData} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
                      <defs>
                        <linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#e2c97e" stopOpacity={0.6} />
                          <stop offset="100%" stopColor="#e2c97e" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                      <XAxis dataKey="m" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <YAxis tickFormatter={(v: any) => bahtShort(v)} tick={{ fontSize: 11, fill: "#94a3b8" }} width={56} />
                      <Tooltip formatter={(v: any) => bahtFull(v)} />
                      <Area type="linear" dataKey="v" stroke="#c9a84c" strokeWidth={2.5} fill="url(#og)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <ChartCard title="ยอดซื้อแยกหมวด (Top 10)" hint="หมวดที่ใช้งบมากสุด">
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={overview.catData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                        <XAxis type="number" tickFormatter={(v: any) => bahtShort(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#475569" }} width={130} />
                        <Tooltip formatter={(v: any) => bahtFull(v)} />
                        <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                          {overview.catData.map((d, i) => <Cell key={i} fill={catColor(d.name).color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                  <ChartCard title="Top 10 Vendor" hint="vendor ที่มียอดซื้อสะสมสูงสุด">
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={overview.topVendors} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                        <XAxis type="number" tickFormatter={(v: any) => bahtShort(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#475569" }} width={120} />
                        <Tooltip formatter={(v: any) => bahtFull(v)} />
                        <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="#1a3c6e" />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>
              </div>
            )}
          </div>
        )}

        {/* FILTERS */}
        <div style={{ background: "white", borderRadius: "20px", padding: "22px", boxShadow: "0 4px 24px rgba(26,60,110,0.08)", marginBottom: "22px", border: "1px solid rgba(226,201,126,0.2)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr", gap: "14px", alignItems: "end" }}>
            <div>
              <label style={{ display: "block", marginBottom: "7px", fontSize: "11px", fontWeight: "700", color: "#94a3b8" }}>🔍 ค้นหา</label>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ชื่อบริษัท, รหัส, หมวดหมู่..."
                style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "2px solid #e2c97e", boxSizing: "border-box", fontSize: "14px", outline: "none", background: "#fffdf5", color: "#1a3c6e" }}
                onFocus={e => { e.target.style.borderColor = "#1a3c6e"; }}
                onBlur={e => { e.target.style.borderColor = "#e2c97e"; }} />
            </div>
            {[
              { label: "🏢 บริษัท", value: filterCompany, setter: setFilterCompany, options: companyOptions },
              { label: "หมวดหมู่", value: filterCategory, setter: setFilterCategory, options: ["ทั้งหมด", ...CATEGORIES] },
              { label: "กลุ่ม", value: filterGroup, setter: setFilterGroup, options: ["ทั้งหมด", "LOCAL", "GROUP", "OVERSEA", "EMP"] },
              { label: "สถานะ", value: filterStatus, setter: setFilterStatus, options: ["ทั้งหมด", "active", "inactive"] },
            ].map(f => (
              <div key={f.label}>
                <label style={{ display: "block", marginBottom: "7px", fontSize: "11px", fontWeight: "700", color: "#94a3b8" }}>{f.label}</label>
                <select value={f.value} onChange={e => f.setter(e.target.value)} style={{ width: "100%", padding: "11px 10px", borderRadius: "10px", border: "1.5px solid #e2e8f0", fontSize: "13px", color: "#1a3c6e", background: "white" }}>
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label style={{ display: "block", marginBottom: "7px", fontSize: "11px", fontWeight: "700", color: "#94a3b8" }}>เรียงตาม</label>
              <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} style={{ width: "100%", padding: "11px 10px", borderRadius: "10px", border: "1.5px solid #e2e8f0", fontSize: "13px", color: "#1a3c6e", background: "white" }}>
                <option value="spend">ยอดซื้อสูงสุด</option>
                <option value="lastPurchase">ซื้อล่าสุด</option>
                <option value="name">ชื่อ A-Z</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #f1f5f9" }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8" }}>
              แสดง <strong style={{ color: "#1a3c6e" }}>{filtered.length}</strong> จาก <strong style={{ color: "#1a3c6e" }}>{vendors.length}</strong> Vendor
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              {(["card", "table"] as ViewMode[]).map(m => (
                <button key={m} onClick={() => setViewMode(m)} style={{
                  padding: "7px 16px", borderRadius: "8px", border: "1.5px solid",
                  borderColor: viewMode === m ? "#1a3c6e" : "#e2e8f0",
                  background: viewMode === m ? "#1a3c6e" : "white",
                  color: viewMode === m ? "white" : "#94a3b8",
                  cursor: "pointer", fontWeight: "700", fontSize: "13px",
                }}>{m === "card" ? "⊞ Card" : "☰ Table"}</button>
              ))}
            </div>
          </div>
        </div>

        {loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
            {[1, 2, 3, 4, 5, 6].map(i => <SkeletonCard key={i} />)}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 40px", background: "white", borderRadius: "20px", boxShadow: "0 4px 24px rgba(26,60,110,0.08)" }}>
            <div style={{ fontSize: "64px", marginBottom: "16px" }}>🏢</div>
            <h3 style={{ margin: "0 0 8px", color: "#1a3c6e", fontSize: "20px", fontWeight: "700" }}>
              {vendors.length === 0 ? "ยังไม่มีข้อมูล Vendor" : "ไม่พบ Vendor"}
            </h3>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "15px" }}>
              {vendors.length === 0 ? "ยังไม่มีข้อมูลในระบบ" : "ลองเปลี่ยน keyword หรือ filter"}
            </p>
          </div>
        )}

        {/* CARD VIEW */}
        {!loading && filtered.length > 0 && viewMode === "card" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: "18px" }}>
            {filtered.map((v, idx) => (
              <div key={v.id} className="vendor-card" onClick={() => setDetailVendor(v)}
                style={{ animationDelay: `${Math.min(idx, 12) * 0.04}s`, background: "white", borderRadius: "18px", padding: "22px", boxShadow: "0 4px 16px rgba(26,60,110,0.08)", borderTop: `3px solid ${v.status === "active" ? "#e2c97e" : "#e2e8f0"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                  <div style={{ flex: 1, marginRight: "10px" }}>
                    <p style={{ margin: "0 0 4px", fontSize: "11px", color: "#94a3b8", fontWeight: "700" }}>
                      {v.vendorCode} · {GROUP_LABEL[v.vendorGroup] || v.vendorGroup}
                      {(v.companies || []).length > 0 && <> · <span style={{ color: "#1a3c6e" }}>{v.companies.join(", ")}</span></>}
                    </p>
                    <h3 style={{ margin: 0, color: "#1a3c6e", fontSize: "15px", fontWeight: "700", lineHeight: "1.35" }}>{highlight(v.name, search)}</h3>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleToggleStatus(v); }} style={{
                    background: v.status === "active" ? "linear-gradient(135deg, #fefce8, #fef9c3)" : "#f1f5f9",
                    color: v.status === "active" ? "#92400e" : "#94a3b8",
                    padding: "4px 12px", borderRadius: "999px", fontSize: "11px", fontWeight: "700",
                    border: v.status === "active" ? "1px solid #e2c97e" : "1px solid #e2e8f0",
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}>{v.status === "active" ? "✅ Active" : "⏸ Inactive"}</button>
                </div>
                <div style={{ height: "1px", background: "linear-gradient(90deg, #e2c97e33, transparent)", margin: "12px 0" }} />
                <div style={{ marginBottom: "14px" }}><CategoryChips cats={v.categories} max={3} search={search} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {[
                    { label: "ยอดซื้อ", value: bahtShort(v.totalSpend) },
                    { label: "PO", value: v.numPOs.toLocaleString() },
                    { label: "ล่าสุด", value: v.lastPurchase ? v.lastPurchase.slice(2) : "-" },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#f8faff", borderRadius: "10px", padding: "9px 6px", textAlign: "center" }}>
                      <p style={{ margin: "0 0 2px", fontSize: "9px", color: "#94a3b8", fontWeight: "700" }}>{s.label}</p>
                      <p style={{ margin: 0, fontSize: "13px", color: "#1a3c6e", fontWeight: "800" }}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: "12px", color: "#cbd5e1" }}>คลิกดูกราฟ / แก้หมวด →</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TABLE VIEW */}
        {!loading && filtered.length > 0 && viewMode === "table" && (
          <div style={{ background: "white", borderRadius: "20px", boxShadow: "0 4px 24px rgba(26,60,110,0.08)", overflow: "hidden", border: "1px solid rgba(226,201,126,0.15)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "linear-gradient(135deg, #1a3c6e, #2d5a9e)" }}>
                  {["รหัส", "ชื่อบริษัท", "บริษัทในเครือ", "หมวดหมู่", "ยอดซื้อ", "PO", "ล่าสุด", "สถานะ"].map((h, i) => (
                    <th key={i} style={{ padding: "14px 16px", textAlign: i >= 4 && i <= 5 ? "right" : "left", fontWeight: "700", fontSize: "12px", color: "rgba(255,255,255,0.85)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, i) => (
                  <tr key={v.id} onClick={() => setDetailVendor(v)}
                    onMouseEnter={() => setHoveredId(v.id)} onMouseLeave={() => setHoveredId(null)}
                    style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: hoveredId === v.id ? "#f8faff" : i % 2 === 0 ? "white" : "#fafbff" }}>
                    <td style={{ padding: "14px 16px", color: "#94a3b8", fontWeight: "700", fontSize: "12px" }}>{v.vendorCode}</td>
                    <td style={{ padding: "14px 16px", fontWeight: "700", color: "#1a3c6e" }}>{highlight(v.name, search)}</td>
                    <td style={{ padding: "14px 16px", color: "#64748b", fontSize: "12px" }}>{(v.companies || []).join(", ") || "-"}</td>
                    <td style={{ padding: "14px 16px" }}><CategoryChips cats={v.categories} max={2} /></td>
                    <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: "700", color: "#1a3c6e" }}>{bahtShort(v.totalSpend)}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#475569" }}>{v.numPOs}</td>
                    <td style={{ padding: "14px 16px", color: "#475569" }}>{v.lastPurchase}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <button onClick={e => { e.stopPropagation(); handleToggleStatus(v); }} style={{
                        background: v.status === "active" ? "linear-gradient(135deg, #fefce8, #fef9c3)" : "#f1f5f9",
                        color: v.status === "active" ? "#92400e" : "#94a3b8",
                        padding: "4px 12px", borderRadius: "999px", fontSize: "11px", fontWeight: "700",
                        border: v.status === "active" ? "1px solid #e2c97e" : "1px solid #e2e8f0", cursor: "pointer",
                      }}>{v.status === "active" ? "✅" : "⏸"}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
