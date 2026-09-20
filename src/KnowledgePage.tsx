import { useEffect, useState } from "react";
import {
  collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  IconFileText,
  IconShieldCheck,
  IconDeviceDesktop,
  IconFolders,
  IconSearch,
  IconDownload,
  IconX,
  IconSquare,
  IconSquareCheck,
  IconCheck,
  IconAlertTriangle,
  IconPencil,
  IconTrash,
  IconPlus,
  IconLink,
} from "@tabler/icons-react";
import { Reveal, IconBadge, Section, HoverCard, grid, tint } from "./components/PageKit";

/* Google Drive share links (".../file/d/FILE_ID/view") don't embed in an
   <iframe> directly — Drive's dedicated ".../preview" path does. Converts
   when a file id is recognized; otherwise returns the url unchanged (e.g.
   the seeded docs below, which point at static PDFs under public/). */
function driveEmbedUrl(url: string): string {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/preview` : url;
}

type DocType = "wi" | "manual" | "scope";

interface Doc {
  id: string;
  title: string;
  description: string;
  type: DocType;
  pages: string;
  url: string;
}


const TYPE_ICON: Record<DocType, typeof IconFileText> = {
  wi: IconShieldCheck,
  manual: IconDeviceDesktop,
  scope: IconFolders,
};

const STEPS = [
  { name: "รับ PR / RFQ จากทีม PM", detail: "Project Manager ส่ง Purchase Requisition มาให้ฝ่ายจัดซื้อ" },
  { name: "เชิญ Supplier เข้าร่วม RFQ", detail: "ชี้แจง TOR กำหนด Bid Submission ให้ Supplier ส่งเอกสาร 3 ชุด" },
  { name: "คัดเลือก Supplier เหลือ 3 ราย", detail: "ประเมินร่วมกับ Engineer → เสนอ CEO พร้อมวิเคราะห์ ค.เสี่ยง + Breakeven" },
  { name: "ทำ Contract", detail: "จัดทำสัญญากับ Supplier ที่ CEO เลือก" },
  { name: "เปิด PA ใน D365", detail: "<100k: Manager | 100k–499k: VP | ≥500k: CEO" },
  { name: "เปิด PO ใน D365", detail: "สร้าง Purchase Order และส่งให้ Supplier" },
  { name: "ติดตามการส่งมอบ", detail: "Align กับหน้างาน เรื่อง Laydown, Layout, วันส่งของ" },
  { name: "ทำ Good Receive", detail: "ใช้ Invoice + Delivery Order → รอ Admin / PM / Supervisor Approve" },
  { name: "ติดตามการจ่ายเงิน", detail: "บัญชีโอนเงินให้ Supplier หลัง GR Approve ครบ" },
];

const KICKOFF_CHECKLIST = [
  { item: "เอกสารโครงการ & Layout หน้างาน", detail: "ผัง Site Plan, พื้นที่ Laydown, เส้นทางขนส่งเข้าหน้างาน" },
  { item: "Spec อุปกรณ์หลัก", detail: "แผงโซลาร์ (กำลังวัตต์, ยี่ห้อที่ Engineer อนุมัติ), Inverter & Optimizer, โครงสร้างรับแผง (Racking)" },
  { item: "Spec อุปกรณ์ไฟฟ้า", detail: "สายไฟ, หม้อแปลง, อุปกรณ์ไฟฟ้า, อุปกรณ์ต่อสาย ตาม BOQ ของ Engineer" },
  { item: "งบประมาณเริ่มต้น (Budget)", detail: "ตัวเลขจาก Tender ใช้เทียบกับราคาที่ได้จาก RFQ" },
  { item: "Timeline โครงการ", detail: "วันที่ต้องส่งของหน้างาน เทียบกับ Lead time ของ Supplier แต่ละราย" },
  { item: "รายชื่อ Vendor ที่เกี่ยวข้อง", detail: "ตรวจสอบใน Vendor Master ว่ามี Vendor ที่ทำของประเภทนี้แล้วหรือยัง" },
  { item: "ผู้ติดต่อหน้างาน", detail: "PM / Engineer ผู้รับผิดชอบโครงการ เพื่อประสาน Spec และวันส่งมอบ" },
];

/* Interactive kick-off checklist — ticks are local UI only (reset on reload),
   meant as a quick scratch tool, not a saved record. */
function KickoffChecklist() {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
      {KICKOFF_CHECKLIST.map((c, i) => {
        const on = checked.has(i);
        return (
          <button
            key={c.item}
            type="button"
            onClick={() => toggle(i)}
            aria-pressed={on}
            style={{
              display: "flex", gap: "var(--sp-3)", alignItems: "flex-start", textAlign: "left",
              padding: "var(--sp-3)", borderRadius: "var(--radius)", width: "100%", cursor: "pointer",
              border: on ? "1px solid var(--accent)" : "1px solid transparent",
              background: "var(--surface-2)", fontFamily: "inherit",
              transition: "border-color var(--transition), opacity var(--transition)",
            }}
          >
            {on
              ? <IconSquareCheck size={18} stroke={1.75} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
              : <IconSquare size={18} stroke={1.75} style={{ color: "var(--text-faint)", flexShrink: 0, marginTop: 2 }} />}
            <div>
              <p style={{ margin: "0 0 2px", fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-strong)", textDecoration: on ? "line-through" : "none", opacity: on ? 0.65 : 1 }}>{c.item}</p>
              <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{c.detail}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

const INCOTERM_GROUPS: { group: string; terms: { code: string; name: string; transfer: string }[] }[] = [
  {
    group: "ขนส่งทางใดก็ได้ (Any Mode)",
    terms: [
      { code: "EXW", name: "Ex Works", transfer: "ผู้ขายส่งมอบของที่หน้าโรงงาน/คลังตัวเอง — ผู้ซื้อรับผิดชอบขนส่งและความเสี่ยงทั้งหมดตั้งแต่จุดนั้น" },
      { code: "FCA", name: "Free Carrier", transfer: "ผู้ขายส่งของให้ผู้ขนส่งที่ผู้ซื้อกำหนด ณ จุดที่ตกลงไว้ — ความเสี่ยงโอนตอนส่งมอบให้ผู้ขนส่ง" },
      { code: "CPT", name: "Carriage Paid To", transfer: "ผู้ขายจ่ายค่าขนส่งถึงปลายทาง แต่ความเสี่ยงโอนให้ผู้ซื้อตั้งแต่ส่งมอบให้ผู้ขนส่งรายแรก" },
      { code: "CIP", name: "Carriage & Insurance Paid To", transfer: "เหมือน CPT แต่ผู้ขายต้องทำประกันภัยให้ด้วย (ระดับคุ้มครองสูงสุด)" },
      { code: "DPU", name: "Delivered at Place Unloaded", transfer: "ผู้ขายส่งและขนของลงที่ปลายทาง — ความเสี่ยงโอนหลังขนของลงเรียบร้อย" },
      { code: "DAP", name: "Delivered at Place", transfer: "ผู้ขายส่งของถึงปลายทางที่ตกลงไว้ (ยังไม่ขนลง) ผู้ซื้อรับผิดชอบพิธีการนำเข้า/ภาษีเอง" },
      { code: "DDP", name: "Delivered Duty Paid", transfer: "ผู้ขายรับผิดชอบทุกอย่างถึงปลายทาง รวมพิธีการนำเข้าและภาษีให้ผู้ซื้อแล้ว" },
    ],
  },
  {
    group: "ขนส่งทางเรือเท่านั้น (Sea & Inland Waterway)",
    terms: [
      { code: "FAS", name: "Free Alongside Ship", transfer: "ผู้ขายส่งของไปวางข้างเรือที่ท่าต้นทาง — ความเสี่ยงโอนตอนของถึงข้างเรือ" },
      { code: "FOB", name: "Free on Board", transfer: "ผู้ขายรับผิดชอบจนของขึ้นเรือที่ท่าต้นทาง — ความเสี่ยงโอนให้ผู้ซื้อหลังของขึ้นเรือ" },
      { code: "CFR", name: "Cost & Freight", transfer: "ผู้ขายจ่ายค่าขนส่งถึงท่าปลายทาง แต่ความเสี่ยงโอนให้ผู้ซื้อตั้งแต่ของขึ้นเรือ" },
      { code: "CIF", name: "Cost, Insurance & Freight", transfer: "เหมือน CFR แต่ผู้ขายต้องทำประกันภัยให้ด้วย — Incoterm ที่ใช้บ่อยที่สุดในการนำเข้าอุปกรณ์" },
    ],
  },
];

const OVERSEA_STEPS = [
  { name: "ตรวจสอบ Incoterm กับ Supplier", detail: "ตกลงให้ชัดว่าใครรับผิดชอบขนส่ง, ประกันภัย, และพิธีการนำเข้า-ส่งออกช่วงใดบ้าง" },
  { name: "เตรียมเอกสารนำเข้า", detail: "Invoice, Packing List, Bill of Lading / Airway Bill, Certificate of Origin ตามที่กรมศุลกากรกำหนด" },
  { name: "ประสาน Shipping / Customs Broker", detail: "แจ้งกำหนดวันเรือ/เครื่องบินถึง เพื่อเคลียร์สินค้าออกจากท่า/สนามบินให้ทันหน้างาน" },
  { name: "ตรวจรับของหลังเคลียร์ศุลกากร", detail: "ตรวจสภาพสินค้าและจำนวนเทียบกับ Packing List ก่อนส่งต่อ Warehouse" },
];

const TYPE_BADGE: Record<string, { color: string; label: string }> = {
  wi: { color: "var(--primary)", label: "WI Document" },
  manual: { color: "var(--success)", label: "Manual" },
  scope: { color: "var(--warning)", label: "Scope Guide" },
};

function DocEditModal({
  doc,
  onSave,
  onClose,
}: {
  doc: Doc | null;
  onSave: (data: { title: string; description: string; type: DocType; pages: string; url: string }) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = doc === null;
  const [title, setTitle] = useState(doc?.title ?? "");
  const [description, setDescription] = useState(doc?.description ?? "");
  const [type, setType] = useState<DocType>(doc?.type ?? "wi");
  const [pages, setPages] = useState(doc?.pages ?? "");
  const [url, setUrl] = useState(doc?.url ?? "");
  const [saving, setSaving] = useState(false);
  const inputStyle: React.CSSProperties = {
    font: "inherit", fontSize: "var(--fs-sm)", color: "var(--text)", background: "var(--surface)",
    border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", padding: "8px 10px", width: "100%",
  };

  const handleSave = async () => {
    if (!title.trim() || !url.trim()) return;
    setSaving(true);
    try {
      await onSave({ title: title.trim(), description: description.trim(), type, pages: pages.trim(), url: url.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 320, padding: "var(--sp-4)" }}
    >
      <div style={{ background: "var(--surface)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", width: "min(480px, 100%)", padding: "var(--sp-5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-4)" }}>
          <h3 style={{ margin: 0, color: "var(--text-strong)" }}>{isNew ? "เพิ่มเอกสารใหม่" : "แก้ไขข้อมูลเอกสาร"}</h3>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)" }}>
            <IconX size={20} stroke={1.75} />
          </button>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-3)" }}>
          ชื่อเอกสาร
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-3)" }}>
          คำอธิบาย
          <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div style={{ display: "flex", gap: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", flex: 1 }}>
            ประเภท
            <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value as DocType)}>
              <option value="wi">WI Document</option>
              <option value="manual">Manual</option>
              <option value="scope">Scope Guide</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", flex: 1 }}>
            จำนวนหน้า (ไม่บังคับ)
            <input style={inputStyle} value={pages} onChange={(e) => setPages(e.target.value)} placeholder="เช่น 19 หน้า" />
          </label>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-4)" }}>
          ลิงก์ไฟล์ PDF (Google Drive — ตั้งค่าแชร์เป็น "ทุกคนที่มีลิงก์" ก่อน)
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <IconLink size={16} stroke={1.75} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/file/d/.../view" style={inputStyle} />
          </div>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-2)" }}>
          <button type="button" onClick={onClose} style={{ border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", borderRadius: "var(--radius)", padding: "8px 16px", fontSize: "var(--fs-sm)", cursor: "pointer" }}>
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={saving || !title.trim() || !url.trim()}
            onClick={handleSave}
            style={{ border: "none", background: "var(--primary)", color: "var(--primary-contrast)", borderRadius: "var(--radius)", padding: "8px 16px", fontSize: "var(--fs-sm)", fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "wi" | "manual" | "scope">("all");
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [doneSteps, setDoneSteps] = useState<boolean[]>(Array(9).fill(false));
  const [docs, setDocs] = useState<Doc[]>([]);
  const [editingDoc, setEditingDoc] = useState<Doc | null>(null);
  const [addingDoc, setAddingDoc] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const colRef = collection(db, "knowledgeDocs");
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        setLoadError(null);
        setDocs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Doc, "id">) })));
      },
      (err) => setLoadError(err.message)
    );
    return unsub;
  }, []);

  const saveDocEdit = async (data: { title: string; description: string; type: DocType; pages: string; url: string }) => {
    if (!editingDoc) return;
    await updateDoc(doc(db, "knowledgeDocs", editingDoc.id), data);
    setEditingDoc(null);
  };

  const addNewDoc = async (data: { title: string; description: string; type: DocType; pages: string; url: string }) => {
    await addDoc(collection(db, "knowledgeDocs"), data);
    setAddingDoc(false);
  };

  const deleteDocItem = async (id: string) => {
    if (!window.confirm("ยืนยันการลบเอกสารนี้?")) return;
    await deleteDoc(doc(db, "knowledgeDocs", id));
    setSelectedDoc(null);
  };

  const filtered = docs.filter((d) => {
    const matchSearch =
      search === "" ||
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.description.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || d.type === filter;
    return matchSearch && matchFilter;
  });

  const toggleStep = (i: number) => {
    setDoneSteps((prev) => {
      const n = [...prev];
      n[i] = !n[i];
      return n;
    });
  };

  const doneCount = doneSteps.filter(Boolean).length;
  const progressPct = Math.round((doneCount / 9) * 100);

  return (
    <div>
      {editingDoc && (
        <DocEditModal
          doc={editingDoc}
          onClose={() => setEditingDoc(null)}
          onSave={saveDocEdit}
        />
      )}

      {addingDoc && (
        <DocEditModal
          doc={null}
          onClose={() => setAddingDoc(false)}
          onSave={addNewDoc}
        />
      )}

      {/* PDF Viewer Modal */}
      {selectedDoc && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.75)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--sp-4)",
          }}
          onClick={() => setSelectedDoc(null)}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "var(--radius-lg)",
              width: "100%",
              maxWidth: "900px",
              height: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "var(--shadow-lg)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                background: "linear-gradient(135deg, var(--navy-deep), var(--navy-mid))",
                padding: "var(--sp-4) var(--sp-5)",
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-4)",
                flexShrink: 0,
              }}
            >
              <IconBadge icon={TYPE_ICON[selectedDoc.type]} color="#fffdf8" size={40} />
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, color: "#fffdf8", fontSize: "var(--fs-body)", fontWeight: 700 }}>
                  {selectedDoc.title}
                </p>
                <p style={{ margin: 0, color: "rgba(255,255,255,0.55)", fontSize: "var(--fs-xs)" }}>
                  {TYPE_BADGE[selectedDoc.type].label}
                  {selectedDoc.pages ? ` • ${selectedDoc.pages}` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <a
                  href={selectedDoc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-2)",
                    padding: "var(--sp-2) var(--sp-4)",
                    background: "var(--accent)",
                    color: "var(--navy-deep)",
                    borderRadius: "var(--radius)",
                    textDecoration: "none",
                    fontSize: "var(--fs-sm)",
                    fontWeight: 700,
                  }}
                >
                  <IconDownload size={16} stroke={2} />
                  เปิดใน Drive
                </a>
                <button
                  onClick={() => deleteDocItem(selectedDoc.id)}
                  title="ลบเอกสาร"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "var(--radius-full)",
                    border: "none",
                    background: "rgba(255,255,255,0.15)",
                    color: "white",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <IconTrash size={18} stroke={2} />
                </button>
                <button
                  onClick={() => setSelectedDoc(null)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "var(--radius-full)",
                    border: "none",
                    background: "rgba(255,255,255,0.15)",
                    color: "white",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <IconX size={18} stroke={2} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: "hidden", background: "#525659" }}>
              <iframe src={driveEmbedUrl(selectedDoc.url)} style={{ width: "100%", height: "100%", border: "none" }} title={selectedDoc.title} />
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <header
        style={{
          position: "relative",
          background: "linear-gradient(135deg, var(--navy-deep) 0%, var(--navy-mid) 100%)",
          color: "#fffdf8",
          padding: "var(--sp-8) var(--sp-6)",
          overflow: "hidden",
        }}
      >
        <div className="hero-aurora" aria-hidden />
        <div style={{ position: "relative", maxWidth: "1100px", margin: "0 auto", zIndex: 1 }}>
          <Reveal>
            <span
              style={{
                display: "inline-block",
                background: "rgba(226,201,126,0.18)",
                border: "1px solid rgba(226,201,126,0.4)",
                color: "var(--accent)",
                padding: "4px 14px",
                borderRadius: "var(--radius-full)",
                fontSize: "var(--fs-xs)",
                fontWeight: 700,
                letterSpacing: "0.08em",
                marginBottom: "var(--sp-3)",
              }}
            >
              PROCUREMENT
            </span>
            <h1 style={{ margin: "0 0 var(--sp-2)", color: "#fffdf8", fontSize: "clamp(22px, 4vw, 34px)", fontWeight: 800 }}>
              Knowledge Base
            </h1>
            <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: "var(--fs-body)" }}>
              คู่มือและเอกสารสำหรับพนักงานฝ่ายจัดซื้อ
            </p>
          </Reveal>

          <Reveal delay={120} style={{ marginTop: "var(--sp-5)" }}>
            <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
              {[
                { label: "เอกสารทั้งหมด", count: docs.length },
                { label: "WI Documents", count: docs.filter((d) => d.type === "wi").length },
                { label: "Manuals & Guides", count: docs.filter((d) => d.type !== "wi").length },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    borderRadius: "var(--radius)",
                    padding: "var(--sp-3) var(--sp-5)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <p style={{ margin: "0 0 4px", color: "rgba(255,255,255,0.6)", fontSize: "var(--fs-xs)" }}>{s.label}</p>
                  <p style={{ margin: 0, color: "white", fontSize: "var(--fs-h2)", fontWeight: 800 }}>{s.count}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </header>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "var(--sp-7) var(--sp-5)" }}>
        {/* Documents */}
        <Section
          eyebrow="เอกสารอ้างอิง"
          title="เอกสารทั้งหมด"
          right={
            <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap", alignItems: "center" }}>
              {(["all", "wi", "manual", "scope"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: "6px 16px",
                    borderRadius: "var(--radius-full)",
                    border: "1.5px solid",
                    borderColor: filter === f ? "var(--primary)" : "var(--border)",
                    background: filter === f ? "var(--primary)" : "var(--surface)",
                    color: filter === f ? "var(--primary-contrast)" : "var(--text-muted)",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "var(--fs-xs)",
                    transition: "all var(--transition)",
                  }}
                >
                  {f === "all" ? "ทั้งหมด" : f === "wi" ? "WI Documents" : f === "manual" ? "Manual" : "Scope & Guide"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAddingDoc(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 16px",
                  borderRadius: "var(--radius-full)",
                  border: "1.5px solid var(--primary)",
                  background: "var(--primary)",
                  color: "var(--primary-contrast)",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "var(--fs-xs)",
                }}
              >
                <IconPlus size={14} stroke={2} />
                เพิ่มเอกสาร
              </button>
            </div>
          }
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-3)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "var(--sp-3) var(--sp-4)",
              marginBottom: "var(--sp-5)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <IconSearch size={18} stroke={1.75} style={{ color: "var(--text-faint)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาเอกสาร, ขั้นตอน, คำศัพท์..."
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                fontSize: "var(--fs-body)",
                background: "transparent",
                color: "var(--text)",
                fontFamily: "var(--font-sans)",
              }}
            />
          </div>

          {loadError ? (
            <div style={{ textAlign: "center", padding: "var(--sp-8)", color: "var(--danger)" }}>
              โหลดเอกสารไม่สำเร็จ: {loadError}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "var(--sp-8)", color: "var(--text-faint)" }}>
              {docs.length === 0 ? "ยังไม่มีเอกสาร กดปุ่ม “เพิ่มเอกสาร” เพื่อเริ่มต้น" : "ไม่พบเอกสารที่ตรงกับการค้นหา"}
            </div>
          ) : (
            <div style={grid(280)}>
              {filtered.map((doc) => {
                const badge = TYPE_BADGE[doc.type];
                return (
                  <HoverCard key={doc.id} onClick={() => setSelectedDoc(doc)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <IconBadge icon={TYPE_ICON[doc.type]} color="var(--primary)" />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditingDoc(doc); }}
                          title="แก้ไขข้อมูลเอกสาร"
                          style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", borderRadius: "var(--radius-sm)", padding: 5, cursor: "pointer", display: "inline-flex" }}
                        >
                          <IconPencil size={14} stroke={1.75} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); deleteDocItem(doc.id); }}
                          title="ลบเอกสาร"
                          style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", borderRadius: "var(--radius-sm)", padding: 5, cursor: "pointer", display: "inline-flex" }}
                        >
                          <IconTrash size={14} stroke={1.75} />
                        </button>
                      </div>
                    </div>
                    <div style={{ fontWeight: 600, color: "var(--text-strong)", marginTop: "var(--sp-3)" }}>{doc.title}</div>
                    <p style={{ margin: "var(--sp-1) 0 var(--sp-3)", color: "var(--text-muted)", fontSize: "var(--fs-sm)", lineHeight: 1.55 }}>
                      {doc.description}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span
                        style={{
                          fontSize: "var(--fs-xs)",
                          fontWeight: 700,
                          color: badge.color,
                          background: tint(badge.color),
                          padding: "3px 10px",
                          borderRadius: "var(--radius-full)",
                        }}
                      >
                        {badge.label}
                      </span>
                      {doc.pages && <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>{doc.pages}</span>}
                    </div>
                  </HoverCard>
                );
              })}
            </div>
          )}
        </Section>

        {/* Step-by-step */}
        <Section
          eyebrow="กระบวนการหลัก"
          title="Step-by-step: กระบวนการจัดซื้อ"
          intro="กดติ๊กแต่ละขั้นเพื่อติดตามความคืบหน้าของงานคุณเอง"
          right={<span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>{doneCount} / 9 เสร็จแล้ว</span>}
        >
          <HoverCard interactive={false}>
            <div style={{ height: 6, background: "var(--surface-2)", borderRadius: "var(--radius-full)", marginBottom: "var(--sp-5)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progressPct}%`,
                  background: "linear-gradient(90deg, var(--primary), var(--accent))",
                  borderRadius: "var(--radius-full)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              {STEPS.map((step, i) => {
                const done = doneSteps[i];
                const current = !done && i === doneSteps.indexOf(false);
                return (
                  <div
                    key={step.name}
                    onClick={() => toggleStep(i)}
                    style={{
                      display: "flex",
                      gap: "var(--sp-3)",
                      alignItems: "flex-start",
                      padding: "var(--sp-3)",
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      border: "1px solid",
                      borderColor: done ? "color-mix(in srgb, var(--success) 35%, transparent)" : "transparent",
                      background: done ? tint("var(--success)") : "transparent",
                      transition: "background var(--transition)",
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "var(--radius-full)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "var(--fs-xs)",
                        fontWeight: 700,
                        flexShrink: 0,
                        background: done ? "var(--success)" : current ? "var(--primary)" : "var(--surface-2)",
                        color: done || current ? "var(--primary-contrast)" : "var(--text-faint)",
                      }}
                    >
                      {done ? <IconCheck size={14} stroke={2.5} /> : i + 1}
                    </span>
                    <div>
                      <p style={{ margin: "0 0 2px", fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-strong)" }}>{step.name}</p>
                      <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{step.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </HoverCard>
        </Section>

        {/* Kick-off Checklist */}
        <Section eyebrow="เริ่มโครงการ" title="Kick-off Checklist">
          <HoverCard interactive={false}>
            <KickoffChecklist />
          </HoverCard>
        </Section>

        {/* OVERSEA & Incoterm */}
        <Section
          eyebrow="นำเข้าต่างประเทศ"
          title="OVERSEA & Incoterm"
          intro="ความรู้พื้นฐานการนำเข้าสินค้าจากต่างประเทศ ตามมาตรฐาน Incoterms 2020"
        >
          <HoverCard interactive={false}>
            <div style={{ borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "var(--sp-5)", border: "1px solid var(--border)" }}>
              <img src="/incoterms-2020.png" alt="Incoterms 2020 — Point of Delivery and Transfer of Risk" style={{ width: "100%", display: "block" }} />
            </div>

            <div style={{ display: "flex", gap: "var(--sp-4)", marginBottom: "var(--sp-5)", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, background: "var(--success)", display: "inline-block" }} /> ผู้ขายรับผิดชอบ (Seller's obligation)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, background: "var(--info)", display: "inline-block" }} /> ผู้ซื้อรับผิดชอบ (Buyer's obligation)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
                <IconAlertTriangle size={14} stroke={2} style={{ color: "var(--warning)" }} /> จุดโอนความเสี่ยง (Transfer of risk)
              </div>
            </div>

            {INCOTERM_GROUPS.map((g) => (
              <div key={g.group} style={{ marginBottom: "var(--sp-5)" }}>
                <p style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-xs)", fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {g.group}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                  {g.terms.map((t) => (
                    <div key={t.code} style={{ display: "flex", gap: "var(--sp-3)", alignItems: "flex-start", padding: "var(--sp-3)", borderRadius: "var(--radius)", background: "var(--surface-2)", borderLeft: "3px solid var(--accent)" }}>
                      <span style={{ flexShrink: 0, fontSize: "var(--fs-xs)", fontWeight: 800, color: "var(--primary)", background: tint("var(--primary)"), borderRadius: "var(--radius-sm)", padding: "4px 8px", minWidth: 44, textAlign: "center" }}>
                        {t.code}
                      </span>
                      <div>
                        <p style={{ margin: "0 0 2px", fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--text-strong)" }}>{t.name}</p>
                        <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)", lineHeight: 1.5 }}>{t.transfer}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <p style={{ margin: "0 0 var(--sp-3)", fontSize: "var(--fs-xs)", fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              ขั้นตอนการสั่งซื้อจากต่างประเทศ (OVERSEA)
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              {OVERSEA_STEPS.map((s, i) => (
                <div key={s.name} style={{ display: "flex", gap: "var(--sp-3)", alignItems: "flex-start", padding: "var(--sp-3)", borderRadius: "var(--radius)", background: "var(--surface-2)" }}>
                  <span style={{ width: 28, height: 28, borderRadius: "var(--radius-full)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-xs)", fontWeight: 700, flexShrink: 0, background: "var(--primary)", color: "var(--primary-contrast)" }}>
                    {i + 1}
                  </span>
                  <div>
                    <p style={{ margin: "0 0 2px", fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-strong)" }}>{s.name}</p>
                    <p style={{ margin: 0, fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </HoverCard>
        </Section>
      </div>
    </div>
  );
}
