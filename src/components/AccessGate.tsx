import { useEffect, useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import type { User } from "firebase/auth";
import { IconMailCheck, IconLock, IconLoader2 } from "@tabler/icons-react";

const wrap: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "var(--bg)", padding: "var(--sp-4)", fontFamily: "var(--font-sans)",
};
const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow)", padding: "var(--sp-6)", width: "min(460px, 100%)", textAlign: "center",
};
const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "12px", background: "var(--navy)", color: "white", border: "none",
  borderRadius: "var(--radius-sm)", fontWeight: 700, fontSize: "14px", cursor: "pointer",
};
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: "var(--primary)", fontSize: "13px", fontWeight: 600,
  cursor: "pointer", padding: "6px",
};

export function CheckingScreen() {
  return (
    <div style={wrap}>
      <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
        <IconLoader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
        กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );
}

/** Firestore only lets verified emails in, so an unverified account is asked to confirm first. */
export function VerifyEmailScreen({
  user, onChecked, onSignOut,
}: { user: User; onChecked: () => void; onSignOut: () => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true); setMsg("");
    try {
      await sendEmailVerification(user);
      setMsg(`ส่งลิงก์ยืนยันไปที่ ${user.email} แล้ว (ถ้าไม่เห็น ให้ดูในกล่อง Junk/Spam)`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setMsg(code === "auth/too-many-requests" ? "ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" : "ส่งอีเมลไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
    setBusy(false);
  };

  const recheck = async () => {
    setBusy(true); setMsg("");
    try {
      await user.reload();
      await user.getIdToken(true);
      if (user.emailVerified) onChecked();
      else setMsg("ยังไม่พบการยืนยัน กรุณากดลิงก์ในอีเมลก่อน");
    } catch {
      setMsg("ตรวจสอบไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
    setBusy(false);
  };

  // Send one automatically the first time this screen appears in a browser
  // session, and keep checking in the background so it moves on by itself.
  useEffect(() => {
    const key = `verify-sent-${user.uid}`;
    if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, "1"); void send(); }
    const t = setInterval(async () => {
      try { await user.reload(); if (user.emailVerified) { await user.getIdToken(true); onChecked(); } } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <div style={wrap}>
      <div style={card}>
        <IconMailCheck size={40} stroke={1.5} style={{ color: "var(--primary)" }} />
        <h2 style={{ margin: "12px 0 6px", color: "var(--text-strong)" }}>ยืนยันอีเมลก่อนใช้งาน</h2>
        <p style={{ margin: "0 0 var(--sp-4)", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>
          เพื่อความปลอดภัยของข้อมูล ระบบต้องยืนยันว่าอีเมล <b>{user.email}</b> เป็นของคุณจริง
          กดลิงก์ในอีเมลที่ส่งให้ แล้วกลับมาที่หน้านี้ (หน้าจะเข้าต่อให้อัตโนมัติ)
        </p>
        <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={recheck}>
          ฉันกดยืนยันแล้ว — ตรวจสอบอีกครั้ง
        </button>
        <div style={{ marginTop: 10 }}>
          <button type="button" style={linkBtn} disabled={busy} onClick={send}>ส่งอีเมลยืนยันอีกครั้ง</button>
          <button type="button" style={linkBtn} onClick={onSignOut}>ออกจากระบบ</button>
        </div>
        {msg && <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{msg}</p>}
      </div>
    </div>
  );
}

export function NotAllowedScreen({
  email, onRecheck, onSignOut, error,
}: { email: string; onRecheck: () => void; onSignOut: () => void; error?: string }) {
  return (
    <div style={wrap}>
      <div style={card}>
        <IconLock size={40} stroke={1.5} style={{ color: "var(--danger)" }} />
        <h2 style={{ margin: "12px 0 6px", color: "var(--text-strong)" }}>{error ? "ตรวจสอบสิทธิ์ไม่สำเร็จ" : "ยังไม่ได้รับอนุญาตให้เข้าใช้งาน"}</h2>
        <p style={{ margin: "0 0 var(--sp-4)", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>
          {error
            ? error
            : <>ระบบนี้เปิดให้เฉพาะทีมจัดซื้อที่ผู้ดูแลระบบอนุญาต อีเมล <b>{email}</b> ยังไม่อยู่ในรายชื่อ กรุณาแจ้งผู้ดูแลระบบ (admin) ให้เพิ่มอีเมลนี้ แล้วกดตรวจสอบอีกครั้ง</>}
        </p>
        <button type="button" style={primaryBtn} onClick={onRecheck}>ตรวจสอบอีกครั้ง</button>
        <div style={{ marginTop: 10 }}>
          <button type="button" style={linkBtn} onClick={onSignOut}>ออกจากระบบ</button>
        </div>
      </div>
    </div>
  );
}
