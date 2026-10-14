import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { Section, HoverCard, grid, tint } from "./PageKit";
import { IconPlus, IconPencil, IconTrash, IconX } from "@tabler/icons-react";

/* ============================================================
   Project Farm — the editable "current portfolio" cards, backed by the
   `homeProjects` Firestore collection. Lifted out of HomePage so it can
   live as its own section under the main project list on the Project page.
   Self-contained: its own state, snapshot, CRUD and edit modal — kept
   separate from ProjectPage's `kickoffProjects` register so nothing collides.
   ============================================================ */

type FarmType = "EPC" | "PPA";

type FarmStage = "construction" | "cod";

interface FarmProject {
  id: string;
  name: string;
  type: FarmType;
  note: string;
  owners: string[];
  /** Optional — older docs don't have these; see stageOf() / the card's fallback. */
  stage?: FarmStage;
  progress?: number | null;
}

type FarmInput = Omit<FarmProject, "id">;

/* Phase of a farm. Stored value wins; otherwise PPA farms are operating (COD)
   and EPC farms are still being built. */
const stageOf = (p: { type: FarmType; stage?: FarmStage }): FarmStage =>
  p.stage ?? (p.type === "PPA" ? "cod" : "construction");

const STAGE_LABEL: Record<FarmStage, string> = { construction: "กำลังสร้าง", cod: "COD แล้ว" };

type FarmFilter = "all" | "PPA" | "EPC" | FarmStage;
const FILTER_TABS: { key: FarmFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "PPA", label: "PPA" },
  { key: "EPC", label: "EPC" },
  { key: "construction", label: "กำลังสร้าง" },
  { key: "cod", label: "COD แล้ว" },
];

const matchesFilter = (p: FarmProject, f: FarmFilter) =>
  f === "all" ? true : f === "PPA" || f === "EPC" ? p.type === f : stageOf(p) === f;

function ProgressBar({ project }: { project: FarmProject }) {
  const stage = stageOf(project);
  const isCod = stage === "cod";
  const pct = isCod ? 100 : typeof project.progress === "number" ? Math.max(0, Math.min(100, project.progress)) : null;
  const color = isCod ? "var(--success)" : "var(--accent)";
  return (
    <div style={{ marginTop: "var(--sp-3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-xs)", marginBottom: 4 }}>
        <span style={{ color, fontWeight: 600 }}>{STAGE_LABEL[stage]}</span>
        <span style={{ color: "var(--text-muted)" }}>{pct === null ? "ยังไม่ระบุ %" : `${pct}%`}</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ width: `${pct ?? 0}%`, height: "100%", background: color, borderRadius: 999, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

/* One-time seed for the "homeProjects" collection — only written if the
   collection is empty on first load. */
const SEED_PROJECTS: FarmInput[] = [
  { name: "กำแพงเพชร (GPD)", type: "EPC", note: "ส่วนหนึ่งของโครงการ 900+ MW ร่วมกับ Gulf", owners: [] },
  { name: "สุพรรณบุรี SPB1", type: "EPC", note: "ดูแลโดยทีม SPB1", owners: [] },
  { name: "สุพรรณบุรี SPB8", type: "EPC", note: "ดูแลโดยทีม SPB8", owners: [] },
  { name: "นราธิวาส", type: "PPA", note: "Gunkul O&M ทั้งหมด", owners: [] },
  { name: "ปัตตานี", type: "PPA", note: "พื้นที่ 400–500 ไร่ (~78.59 MW) Gunkul O&M ทั้งหมด", owners: [] },
  { name: "สตูล", type: "PPA", note: "(91 MW) Gunkul O&M ทั้งหมด", owners: [] },
];

function FarmEditModal({
  project,
  onSave,
  onClose,
}: {
  project: FarmProject | null;
  onSave: (data: FarmInput) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [type, setType] = useState<FarmType>(project?.type ?? "EPC");
  const [note, setNote] = useState(project?.note ?? "");
  const [ownersText, setOwnersText] = useState(project?.owners.join(", ") ?? "");
  const [stage, setStage] = useState<FarmStage>(project ? stageOf(project) : "construction");
  const [progressText, setProgressText] = useState(project?.progress != null ? String(project.progress) : "");
  const [saving, setSaving] = useState(false);

  const inputStyle: React.CSSProperties = {
    font: "inherit", fontSize: "var(--fs-sm)", color: "var(--text)", background: "var(--surface)",
    border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", padding: "8px 10px", width: "100%",
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const owners = ownersText.split(",").map((o) => o.trim()).filter(Boolean);
      const parsed = progressText.trim() === "" ? NaN : Number(progressText);
      const progress = stage === "cod" || !Number.isFinite(parsed) ? null : Math.max(0, Math.min(100, Math.round(parsed)));
      await onSave({ name: name.trim(), type, note: note.trim(), owners, stage, progress });
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
          <h3 style={{ margin: 0, color: "var(--text-strong)" }}>{project ? "แก้ไขโครงการ" : "เพิ่มโครงการใหม่"}</h3>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)" }}>
            <IconX size={20} stroke={1.75} />
          </button>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-3)" }}>
          ชื่อโครงการ
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-3)" }}>
          ประเภท
          <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value as FarmType)}>
            <option value="EPC">EPC</option>
            <option value="PPA">PPA</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>
          <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>
            สถานะโครงการ
            <select style={inputStyle} value={stage} onChange={(e) => setStage(e.target.value as FarmStage)}>
              <option value="construction">กำลังสร้าง</option>
              <option value="cod">COD แล้ว</option>
            </select>
          </label>
          <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", opacity: stage === "cod" ? 0.5 : 1 }}>
            ความคืบหน้า (%)
            <input style={inputStyle} type="number" min={0} max={100} disabled={stage === "cod"} value={stage === "cod" ? "100" : progressText}
              onChange={(e) => setProgressText(e.target.value)} placeholder="0–100" />
          </label>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-3)" }}>
          รายละเอียด
          <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: "var(--sp-4)" }}>
          ผู้รับผิดชอบโครงการ (คั่นด้วยจุลภาค หากมีมากกว่า 1 คน)
          <input style={inputStyle} value={ownersText} onChange={(e) => setOwnersText(e.target.value)} placeholder="เช่น พี่เจมส์, พี่มอส, พี่พลอย" />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--sp-2)" }}>
          <button type="button" onClick={onClose} style={{ border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", borderRadius: "var(--radius)", padding: "8px 16px", fontSize: "var(--fs-sm)", cursor: "pointer" }}>
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={saving || !name.trim()}
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

export default function ProjectFarm() {
  const [projects, setProjects] = useState<FarmProject[]>([]);
  const [editingProject, setEditingProject] = useState<FarmProject | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FarmFilter>("all");

  useEffect(() => {
    let seeded = false;
    const colRef = collection(db, "homeProjects");
    const unsub = onSnapshot(
      colRef,
      async (snap) => {
        setProjectsError(null);
        if (snap.empty && !seeded) {
          seeded = true;
          try {
            const batch = writeBatch(db);
            SEED_PROJECTS.forEach((p) => batch.set(doc(colRef), p));
            await batch.commit();
          } catch (err) {
            setProjectsError(err instanceof Error ? err.message : String(err));
          }
          return;
        }
        setProjects(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FarmProject, "id">) })));
      },
      (err) => setProjectsError(err.message)
    );
    return unsub;
  }, []);

  const visibleProjects = projects.filter((p) => matchesFilter(p, filter));

  const saveProjectEdit = async (data: FarmInput) => {
    if (!editingProject) return;
    await updateDoc(doc(db, "homeProjects", editingProject.id), data);
    setEditingProject(null);
  };

  const addNewProject = async (data: FarmInput) => {
    await addDoc(collection(db, "homeProjects"), data);
    setAddingProject(false);
  };

  const deleteProject = async (id: string) => {
    if (!window.confirm("ยืนยันการลบโครงการนี้?")) return;
    await deleteDoc(doc(db, "homeProjects", id));
  };

  return (
    <>
      <Section
        eyebrow="พอร์ตงานปัจจุบัน"
        title="Project Farm ที่ดำเนินอยู่"
        right={
          <button
            type="button"
            onClick={() => setAddingProject(true)}
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
            เพิ่มโครงการ
          </button>
        }
      >
        {projectsError ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)", color: "var(--danger)" }}>
            โหลดโครงการไม่สำเร็จ: {projectsError}
          </div>
        ) : projects.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)", color: "var(--text-faint)" }}>
            ยังไม่มีโครงการ กดปุ่ม "เพิ่มโครงการ" เพื่อเริ่มต้น
          </div>
        ) : (
          <>
          <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
            {FILTER_TABS.map((t) => {
              const active = filter === t.key;
              const count = projects.filter((p) => matchesFilter(p, t.key)).length;
              return (
                <button
                  key={t.key} type="button" role="tab" aria-selected={active}
                  onClick={() => setFilter(t.key)}
                  style={{
                    padding: "6px 14px", borderRadius: "var(--radius-full)", cursor: "pointer", font: "inherit",
                    fontSize: "var(--fs-xs)", fontWeight: 600,
                    border: `1.5px solid ${active ? "var(--primary)" : "var(--border-strong)"}`,
                    background: active ? "var(--primary)" : "var(--surface)",
                    color: active ? "var(--primary-contrast)" : "var(--text-muted)",
                  }}
                >
                  {t.label} <span style={{ opacity: 0.7, fontWeight: 500 }}>{count}</span>
                </button>
              );
            })}
          </div>
          {visibleProjects.length === 0 ? (
            <div style={{ textAlign: "center", padding: "var(--sp-6)", color: "var(--text-faint)" }}>ไม่มีโครงการในหมวดนี้</div>
          ) : (
          <div style={grid(320)}>
            {visibleProjects.map((p) => {
              const isEpc = p.type === "EPC";
              const c = isEpc ? "var(--primary)" : "var(--accent)";
              return (
                <HoverCard key={p.id} style={{ padding: "var(--sp-4)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--sp-3)" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: "var(--text-strong)" }}>{p.name}</div>
                      <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", marginTop: "var(--sp-1)" }}>{p.note}</div>
                      {p.owners.length > 0 && (
                        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: "var(--sp-2)" }}>
                          ผู้รับผิดชอบ: {p.owners.join(", ")}
                        </div>
                      )}
                      <ProgressBar project={p} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--sp-2)", flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: "var(--fs-xs)",
                          fontWeight: 800,
                          letterSpacing: "0.06em",
                          color: c,
                          background: tint(c),
                          padding: "3px 10px",
                          borderRadius: "var(--radius-full)",
                        }}
                      >
                        {p.type}
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => setEditingProject(p)}
                          title="แก้ไขโครงการ"
                          style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", borderRadius: "var(--radius-sm)", padding: 5, cursor: "pointer", display: "inline-flex" }}
                        >
                          <IconPencil size={14} stroke={1.75} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteProject(p.id)}
                          title="ลบโครงการ"
                          style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", borderRadius: "var(--radius-sm)", padding: 5, cursor: "pointer", display: "inline-flex" }}
                        >
                          <IconTrash size={14} stroke={1.75} />
                        </button>
                      </div>
                    </div>
                  </div>
                </HoverCard>
              );
            })}
          </div>
          )}
          </>
        )}
      </Section>

      {editingProject && (
        <FarmEditModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSave={saveProjectEdit}
        />
      )}
      {addingProject && (
        <FarmEditModal
          project={null}
          onClose={() => setAddingProject(false)}
          onSave={addNewProject}
        />
      )}
    </>
  );
}
