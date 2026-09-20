import { useState } from "react";
import { signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from "firebase/auth";
import { auth } from "./firebase";
import ThemeToggle from "./ThemeToggle";
import { isCompanyEmail } from "./config/admins";

type Lang = "en" | "th";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [showForgot, setShowForgot] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  const t = {
    en: {
      title: "PROCUREMENT",
      signin: "Sign In",
      signup: "Create Account",
      switchToSignUp: "Don't have an account? Sign up",
      switchToSignIn: "Already have an account? Sign in",
      email: "Email Address",
      password: "Password",
      confirmPassword: "Confirm Password",
      button: "Sign In",
      signUpButton: "Create Account",
      loading: "Please wait...",
      error_invalid: "Invalid email or password",
      error_domain: "Only @gunkul.com or @gunkul.co.th emails are allowed",
      error_password_match: "Passwords do not match",
      error_password_length: "Password must be at least 6 characters",
      forgot: "Forgot password?",
      forgotTitle: "Reset Password",
      forgotDesc: "Enter your email and we'll send you a reset link.",
      forgotButton: "Send Reset Link",
      forgotSent: "Reset link sent! Please check your email.",
      back: "← Back to Sign In",
      signUpSuccess: "Account created! You can now sign in.",
    },
    th: {
      title: "ฝ่ายจัดซื้อ",
      signin: "เข้าสู่ระบบ",
      signup: "สร้างบัญชีใหม่",
      switchToSignUp: "ยังไม่มีบัญชี? สมัครสมาชิก",
      switchToSignIn: "มีบัญชีแล้ว? เข้าสู่ระบบ",
      email: "อีเมล",
      password: "รหัสผ่าน",
      confirmPassword: "ยืนยันรหัสผ่าน",
      button: "เข้าสู่ระบบ",
      signUpButton: "สร้างบัญชี",
      loading: "กรุณารอสักครู่...",
      error_invalid: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
      error_domain: "อนุญาตเฉพาะอีเมล @gunkul.com หรือ @gunkul.co.th เท่านั้น",
      error_password_match: "รหัสผ่านไม่ตรงกัน",
      error_password_length: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร",
      forgot: "ลืมรหัสผ่าน?",
      forgotTitle: "รีเซ็ตรหัสผ่าน",
      forgotDesc: "กรอกอีเมลของคุณ เราจะส่งลิงก์รีเซ็ตให้",
      forgotButton: "ส่งลิงก์รีเซ็ต",
      forgotSent: "ส่งลิงก์แล้ว! กรุณาตรวจสอบอีเมลของคุณ",
      back: "← กลับไปเข้าสู่ระบบ",
      signUpSuccess: "สร้างบัญชีสำเร็จ! กรุณาเข้าสู่ระบบ",
    },
  }[lang];

  const validateDomain = (e: string) => isCompanyEmail(e);

  const handleLogin = async () => {
    setError("");
    if (!validateDomain(email)) { setError(t.error_domain); return; }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      onLogin();
    } catch {
      setError(t.error_invalid);
    }
    setLoading(false);
  };

  const handleSignUp = async () => {
    setError("");
    if (!validateDomain(email)) { setError(t.error_domain); return; }
    if (password.length < 6) { setError(t.error_password_length); return; }
    if (password !== confirmPassword) { setError(t.error_password_match); return; }
    setLoading(true);
    try {
      const { createUserWithEmailAndPassword } = await import("firebase/auth");
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // Firestore rules only admit verified emails, so start verification right away.
      try { await sendEmailVerification(cred.user); } catch { /* the verify screen offers a resend */ }
      setSignUpSuccess(true);
      setShowSignUp(false);
      setEmail(""); setPassword(""); setConfirmPassword("");
    } catch {
      setError(t.error_invalid);
    }
    setLoading(false);
  };

  const handleForgot = async () => {
    if (!forgotEmail) return;
    // Show the same confirmation whether or not the address exists (don't reveal who has an account).
    try { await sendPasswordResetEmail(auth, forgotEmail.trim()); } catch { /* ignore */ }
    setForgotSent(true);
  };

  const inputStyle = {
    width: "100%", padding: "12px 14px", borderRadius: "var(--radius-sm)",
    border: "1.5px solid var(--border-strong)", boxSizing: "border-box" as const,
    fontSize: "14px", outline: "none", background: "var(--bg)", color: "var(--text)",
    fontFamily: "var(--font-sans)",
  };

  const labelStyle = {
    display: "block", marginBottom: "6px", fontSize: "13px",
    fontWeight: 600, color: "var(--text-muted)", fontFamily: "var(--font-sans)",
  };

  const buttonPrimary = {
    width: "100%", padding: "14px", backgroundColor: "var(--navy)", color: "white",
    border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer",
    fontWeight: 700, fontSize: "15px", letterSpacing: "0.03em", fontFamily: "var(--font-sans)",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: "url('/bg-financial.webp')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        padding: "var(--sp-4)",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(8, 20, 45, 0.62)" }} />

      <div
        style={{
          position: "absolute",
          top: "var(--sp-4)",
          right: "var(--sp-4)",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
        }}
      >
        <div style={{ display: "flex", gap: "8px" }}>
          {(["en", "th"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              style={{
                padding: "6px 16px",
                borderRadius: "var(--radius-full)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "13px",
                letterSpacing: "0.05em",
                background: lang === l ? "white" : "rgba(255,255,255,0.15)",
                color: lang === l ? "var(--navy)" : "white",
                border: lang === l ? "none" : "1px solid rgba(255,255,255,0.35)",
              }}
            >
              {l === "en" ? "EN" : "TH"}
            </button>
          ))}
        </div>
        <ThemeToggle />
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: "420px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginBottom: "var(--sp-6)",
          }}
        >
          <img
            src="/logo-default.svg"
            alt="Gunkul Logo"
            style={{
              height: "clamp(56px, 10vw, 96px)",
              width: "auto",
              filter: "brightness(0) invert(1)",
              marginBottom: "var(--sp-3)",
            }}
          />
          <h1
            style={{
              margin: 0,
              color: "white",
              fontWeight: 700,
              letterSpacing: lang === "en" ? "0.3em" : "0.05em",
              fontSize: lang === "en" ? "26px" : "34px",
              fontFamily: lang === "en" ? "var(--font-serif)" : "var(--font-sans)",
              textTransform: lang === "en" ? "uppercase" : "none",
              textShadow: "0 2px 16px rgba(0,0,0,0.4)",
            }}
          >
            {t.title}
          </h1>
        </div>

        <div
          style={{
            background: "var(--surface)",
            borderRadius: "var(--radius-lg)",
            padding: "36px 32px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          }}
        >
          {signUpSuccess && (
            <div style={{ background: "#d1fae5", color: "#065f46", padding: "12px", borderRadius: "var(--radius-sm)", fontSize: "13px", textAlign: "center", marginBottom: "16px" }}>
              {t.signUpSuccess}
            </div>
          )}

          {!showForgot ? (
            <>
              <h2 style={{ margin: "0 0 24px", color: "var(--text-strong)", fontSize: "18px", textAlign: "center", fontWeight: 700, fontFamily: "var(--font-sans)" }}>
                {showSignUp ? t.signup : t.signin}
              </h2>

              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>{t.email}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@gunkul.com"
                  style={inputStyle}
                  onKeyDown={(e) => !showSignUp && e.key === "Enter" && handleLogin()}
                />
              </div>

              <div style={{ marginBottom: showSignUp ? "16px" : "8px" }}>
                <label style={labelStyle}>{t.password}</label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{ ...inputStyle, paddingRight: "44px" }}
                    onKeyDown={(e) => !showSignUp && e.key === "Enter" && handleLogin()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "var(--text-muted)",
                    }}
                  >
                    {showPassword ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              {showSignUp && (
                <div style={{ marginBottom: "16px" }}>
                  <label style={labelStyle}>{t.confirmPassword}</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    style={inputStyle}
                  />
                </div>
              )}

              {!showSignUp && (
                <div style={{ textAlign: "right", marginBottom: "20px" }}>
                  <button
                    type="button"
                    onClick={() => setShowForgot(true)}
                    style={{ background: "none", border: "none", color: "var(--primary)", fontSize: "13px", cursor: "pointer", fontWeight: 600 }}
                  >
                    {t.forgot}
                  </button>
                </div>
              )}

              {error && (
                <div style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: "var(--radius-sm)", fontSize: "13px", marginBottom: "16px", textAlign: "center" }}>
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={showSignUp ? handleSignUp : handleLogin}
                disabled={loading}
                style={{ ...buttonPrimary, opacity: loading ? 0.7 : 1, marginBottom: "12px" }}
              >
                {loading ? t.loading : showSignUp ? t.signUpButton : t.button}
              </button>

              <button
                type="button"
                onClick={() => { setShowSignUp(!showSignUp); setError(""); setPassword(""); setConfirmPassword(""); }}
                style={{ width: "100%", padding: "11px", background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
              >
                {showSignUp ? t.switchToSignIn : t.switchToSignUp}
              </button>
            </>
          ) : (
            <>
              <h2 style={{ margin: "0 0 8px", color: "var(--text-strong)", fontSize: "18px", textAlign: "center", fontWeight: 700, fontFamily: "var(--font-sans)" }}>{t.forgotTitle}</h2>
              <p style={{ margin: "0 0 24px", color: "var(--text-muted)", fontSize: "13px", textAlign: "center", lineHeight: 1.6 }}>{t.forgotDesc}</p>
              {!forgotSent ? (
                <>
                  <div style={{ marginBottom: "16px" }}>
                    <label style={labelStyle}>{t.email}</label>
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="name@gunkul.com"
                      style={inputStyle}
                    />
                  </div>
                  <button type="button" onClick={handleForgot} style={{ ...buttonPrimary, marginBottom: "12px" }}>{t.forgotButton}</button>
                </>
              ) : (
                <div style={{ background: "#d1fae5", color: "#065f46", padding: "16px", borderRadius: "var(--radius-sm)", fontSize: "13px", textAlign: "center", marginBottom: "16px" }}>
                  {t.forgotSent}
                </div>
              )}
              <button
                type="button"
                onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); }}
                style={{ width: "100%", padding: "12px", background: "var(--bg-elevated)", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text-muted)", fontWeight: 600, fontSize: "13px" }}
              >
                {t.back}
              </button>
            </>
          )}
        </div>

        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.45)", fontSize: "12px", marginTop: "var(--sp-5)" }}>
          © 2026 Gunkul Engineering — Procurement Department
        </p>
      </div>
    </div>
  );
}
