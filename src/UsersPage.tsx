import { useEffect, useMemo, useState } from "react";
import {
  collection, onSnapshot, doc, deleteDoc, updateDoc, writeBatch, getDocs, serverTimestamp,
} from "firebase/firestore";
import { IconShieldLock, IconTrash, IconUserPlus, IconUsersGroup } from "@tabler/icons-react";
import { auth, db } from "./firebase";
import { BOOTSTRAP_ADMIN_EMAILS, isBootstrapAdmin, allowlistId } from "./config/admins";

interface AllowedUser {
  email: string;
  role: "admin" | "member";
  addedBy?: string;
  addedAt?: { toDate: () => Date };
}

const EMAIL_RE = /^[^\s@]+@gunkul\.com$/;
const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--sp-4)",
};
const field: React.CSSProperties = {
  font: "inherit", fontSize: "var(--fs-sm)", color: "var(--text)", background: "var(--bg)",
  border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", padding: "8px 10px",
};
const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, background: "var(--navy)", color: "white", border: "none",
  borderRadius: "var(--radius)", padding: "9px 16px", fontWeight: 700, fontSize: "var(--fs-sm)", cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius)", padding: "8px 12px", fontSize: "var(--fs-xs)", cursor: "pointer",
};

/** Admin-only: who may use this system. Writes `allowedUsers/{email}`; firestore.rules enforces it. */
export default function UsersPage() {
  const me = (auth.currentUser?.email ?? "").toLowerCase();
  const [users, setUsers] = useState<AllowedUser[]>([]);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return onSnapshot(
      collection(db, "allowedUsers"),
      (snap) => {
        setLoadError("");
        setUsers(snap.docs.map((d) => ({ email: d.id, ...(d.data() as Omit<AllowedUser, "email">) }))
          .sort((a, b) => a.email.localeCompare(b.email)));
      },
      (err) => setLoadError(err.message),
    );
  }, []);

  const existing = useMemo(() => new Set(users.map((u) => u.email)), [users]);

  const parsed = useMemo(() => {
    const all = [...new Set(text.split(/[\s,;]+/).map((s) => allowlistId(s)).filter(Boolean))];
    return {
      valid: all.filter((e) => EMAIL_RE.test(e) && !existing.has(e)),
      already: all.filter((e) => existing.has(e)),
      invalid: all.filter((e) => !EMAIL_RE.test(e)),
    };
  }, [text, existing]);

  const add = async () => {
    if (!parsed.valid.length) return;
    setBusy(true); setMsg(null);
    try {
      const batch = writeBatch(db);
      for (const email of parsed.valid) {
        batch.set(doc(db, "allowedUsers", email), { email, role, addedBy: me, addedAt: serverTimestamp() });
      }
      await batch.commit();
      setMsg({ kind: "ok", text: `เพิ่มแล้ว ${parsed.valid.length} อีเมล` });
      setText("");
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  const loadFromStaff = async () => {
    setBusy(true); setMsg(null);
    try {
      const snap = await getDocs(collection(db, "staffDirectory"));
      const emails = snap.docs.map((d) => allowlistId(String(d.data().email ?? ""))).filter((e) => EMAIL_RE.test(e) && !existing.has(e));
      setText((t) => [...new Set([...t.split(/[\s,;]+/).filter(Boolean), ...emails])].join("\n"));
      setMsg({ kind: "ok", text: `ดึงจากรายชื่อพนักงาน ${emails.length} อีเมล — ตรวจดูให้ครบถ้วนก่อนกด "เพิ่มเข้ารายชื่อ"` });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  const setUserRole = async (email: string, r: "member" | "admin") => {
    try { await updateDoc(doc(db, "allowedUsers", email), { role: r }); }
    catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) }); }
  };

  const remove = async (email: string) => {
    if (!window.confirm(`ลบ ${email} ออกจากรายชื่อ? คนนี้จะเข้าระบบไม่ได้อีก`)) return;
    try { await deleteDoc(doc(db, "allowedUsers", email)); }
    catch (e) { setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) }); }
  };

  const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 700, fontSize: "var(--fs-xs)", color: "var(--text-muted)" };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: "var(--fs-sm)" };
  const bootstrapOnly = BOOTSTRAP_ADMIN_EMAILS.filter((e) => !existing.has(e));

  return (
    <div style={{ maxWidth: "980px", margin: "0 auto", padding: "var(--sp-7) var(--sp-5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--fs-xs)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent)", marginBottom: "var(--sp-2)" }}>
        <IconShieldLock size={16} stroke={1.75} /> ADMIN
      </div>
      <h1 style={{ margin: "0 0 var(--sp-2)", color: "var(--text-strong)" }}>จัดการผู้ใช้</h1>
      <p style={{ margin: "0 0 var(--sp-5)", fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.6 }}>
        เฉพาะอีเมล @gunkul.com ที่อยู่ในรายชื่อนี้เท่านั้นที่เข้าข้อมูลได้ (บังคับที่ฐานข้อมูล ไม่ใช่แค่หน้าเว็บ)
        คนที่เพิ่มแล้วต้องยืนยันอีเมลผ่านลิงก์ที่ระบบส่งให้ในครั้งแรกที่เข้า การลบชื่อออกจะตัดสิทธิ์ตั้งแต่คำขอถัดไป
      </p>

      <div style={{ ...card, marginBottom: "var(--sp-4)" }}>
        <h2 style={{ margin: "0 0 var(--sp-3)", fontSize: "1.05rem", color: "var(--text-strong)", display: "flex", alignItems: "center", gap: 8 }}>
          <IconUserPlus size={18} stroke={1.75} /> เพิ่มผู้ใช้
        </h2>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
          placeholder={"วางอีเมลได้หลายอัน คั่นด้วยบรรทัดใหม่ , หรือช่องว่าง\nname@gunkul.com"}
          style={{ ...field, width: "100%", boxSizing: "border-box", resize: "vertical" }} />
        {(parsed.invalid.length > 0 || parsed.already.length > 0) && (
          <p style={{ margin: "6px 0 0", fontSize: "var(--fs-xs)", color: "var(--warning)" }}>
            {parsed.invalid.length > 0 && <>ไม่ใช่อีเมล @gunkul.com (จะไม่ถูกเพิ่ม): {parsed.invalid.join(", ")}. </>}
            {parsed.already.length > 0 && <>มีในรายชื่ออยู่แล้ว: {parsed.already.join(", ")}</>}
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", alignItems: "center", marginTop: "var(--sp-3)" }}>
          <select value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")} style={field}>
            <option value="member">สมาชิก</option>
            <option value="admin">admin (จัดการผู้ใช้ / ลบ Vendor ได้)</option>
          </select>
          <button type="button" style={{ ...primaryBtn, opacity: busy || !parsed.valid.length ? 0.5 : 1 }} disabled={busy || !parsed.valid.length} onClick={add}>
            เพิ่มเข้ารายชื่อ ({parsed.valid.length})
          </button>
          <button type="button" style={ghostBtn} disabled={busy} onClick={loadFromStaff}>ดึงอีเมลจากรายชื่อพนักงาน (Staff Directory)</button>
        </div>
        {msg && <p style={{ margin: "10px 0 0", fontSize: "var(--fs-sm)", color: msg.kind === "ok" ? "var(--success)" : "var(--danger)" }}>{msg.text}</p>}
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--sp-4) var(--sp-4) var(--sp-2)", display: "flex", alignItems: "center", gap: 8 }}>
          <IconUsersGroup size={18} stroke={1.75} />
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--text-strong)" }}>รายชื่อที่ได้รับอนุญาต ({(users.length + bootstrapOnly.length).toLocaleString()})</h2>
        </div>
        {loadError && <p style={{ margin: 0, padding: "0 var(--sp-4) var(--sp-3)", color: "var(--danger)", fontSize: "var(--fs-sm)" }}>โหลดรายชื่อไม่สำเร็จ: {loadError}</p>}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-elevated)" }}>
                <th style={th}>อีเมล</th><th style={th}>สิทธิ์</th><th style={th}>เพิ่มโดย</th><th style={th}>เมื่อ</th><th style={th} />
              </tr>
            </thead>
            <tbody>
              {bootstrapOnly.map((e) => (
                <tr key={e} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--text-strong)" }}>{e}</td>
                  <td style={td}>admin</td>
                  <td style={{ ...td, color: "var(--text-faint)" }} colSpan={3}>ผู้ดูแลหลัก (กำหนดในโค้ด เข้าได้เสมอ ลบไม่ได้)</td>
                </tr>
              ))}
              {users.map((u) => {
                const locked = u.email === me || isBootstrapAdmin(u.email);
                return (
                  <tr key={u.email} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 700, color: "var(--text-strong)" }}>
                      {u.email}{u.email === me && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> (คุณ)</span>}
                    </td>
                    <td style={td}>
                      <select value={u.role} disabled={locked} onChange={(e) => setUserRole(u.email, e.target.value as "member" | "admin")} style={{ ...field, padding: "4px 8px" }}>
                        <option value="member">สมาชิก</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td style={{ ...td, color: "var(--text-muted)" }}>{u.addedBy ?? "—"}</td>
                    <td style={{ ...td, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{u.addedAt ? u.addedAt.toDate().toLocaleDateString("th-TH") : "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {!locked && (
                        <button type="button" title="ลบออกจากรายชื่อ" onClick={() => remove(u.email)}
                          style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", display: "inline-flex", padding: 4 }}>
                          <IconTrash size={17} stroke={1.75} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length + bootstrapOnly.length === 0 && (
                <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "var(--text-faint)" }}>ยังไม่มีรายชื่อ</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
