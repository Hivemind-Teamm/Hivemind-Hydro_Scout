"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { useIsMobile, useIsShort } from "@/lib/use-media-query";
import AuthShell, { AccentTicks, BRAND } from "../src/components/AuthShell";

export default function SignUpPage() {
  const { signup, user, loading } = useAuth();
  const { isDark } = useTheme();
  const isMobile = useIsMobile();
  const isShort = useIsShort();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  if (!loading && user) {
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setSubmitting(true);
    try {
      await signup(email, password, displayName.trim() || email.split("@")[0]);
      router.push("/");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/email-already-in-use") setError("An account with this email already exists.");
      else if (code === "auth/invalid-email") setError("Invalid email address.");
      else setError("Could not create account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // iPhone-SE-class screens (phone width AND short height): the 4-field form is
  // tall, so we compress spacing to keep it on-screen without feeling cramped.
  const tight = isMobile && isShort;
  const padY = tight ? 9 : 11; // mobile input vertical padding (16px font min avoids iOS zoom)
  const headingSize = isMobile ? (tight ? 28 : 34) : 52;
  const subSize = isMobile ? (tight ? 14 : 16) : 18;
  const subMargin = isMobile ? (tight ? "4px 0 12px" : "6px 0 18px") : "10px 0 28px";
  const labelSize = isMobile ? (tight ? 12 : 13) : 14;
  const formGap = isMobile ? (tight ? 9 : 12) : 16;
  const btnFont = isMobile ? (tight ? 16 : 17) : 18;

  const textColor   = isDark ? "#e5e7eb" : "#0b0f14";
  const mutedColor  = isDark ? "#8b93a1" : "#6b7280";
  const inputBg     = isDark ? "#151b23" : "#ffffff";
  const inputBorder = isDark ? "#2b333f" : "#d7dbe0";

  const labelStyle: React.CSSProperties = {
    fontSize: labelSize, fontWeight: 600, color: mutedColor,
    letterSpacing: "0.07em", textTransform: "uppercase",
  };
  const inputStyle: React.CSSProperties = {
    padding: isMobile ? `${padY}px 16px` : "13px 20px", borderRadius: 24,
    border: `1.5px solid ${inputBorder}`, fontSize: isMobile ? 16 : 17, outline: "none",
    width: "100%", boxSizing: "border-box", color: textColor,
    background: inputBg, fontFamily: "inherit",
  };
  const pwInputStyle: React.CSSProperties = { ...inputStyle, padding: isMobile ? `${padY}px 44px ${padY}px 16px` : "13px 48px 13px 20px" };

  const eyeOpen = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  );
  const eyeOff = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );

  const eyeToggleStyle: React.CSSProperties = {
    position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
    background: "none", border: "none", cursor: "pointer", padding: 0,
    display: "flex", alignItems: "center", color: "#888",
  };

  return (
    <AuthShell>
      <AccentTicks style={{ marginBottom: tight ? 10 : 16 }} />

      <h1 style={{ fontSize: headingSize, fontWeight: 800, margin: 0, lineHeight: 1.05, letterSpacing: "-0.02em", color: textColor }}>
        Join <span style={{ color: BRAND.red }}>Us!</span>
      </h1>
      <p style={{ fontSize: subSize, color: mutedColor, margin: subMargin }}>Create an Account</p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: formGap }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <label style={labelStyle}>Display Name</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" placeholder="e.g. Juan dela Cruz" className="auth-input" style={inputStyle} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <label style={labelStyle}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" className="auth-input" style={inputStyle} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <label style={labelStyle}>Password</label>
          <div style={{ position: "relative" }}>
            <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" placeholder="At least 6 characters" className="auth-input" style={pwInputStyle} />
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} style={eyeToggleStyle}>
              {showPassword ? eyeOff : eyeOpen}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <label style={labelStyle}>Confirm Password</label>
          <div style={{ position: "relative" }}>
            <input type={showConfirm ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" className="auth-input" style={pwInputStyle} />
            <button type="button" onClick={() => setShowConfirm((v) => !v)} aria-label={showConfirm ? "Hide password" : "Show password"} style={eyeToggleStyle}>
              {showConfirm ? eyeOff : eyeOpen}
            </button>
          </div>
        </div>

        {error && <p className="anim-shake" style={{ color: BRAND.red, fontSize: 15, fontWeight: 500, margin: 0 }}>{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="auth-btn"
          style={{
            marginTop: tight ? 4 : 8, padding: isMobile ? (tight ? "11px 20px" : "13px 20px") : "16px 20px",
            borderRadius: 24, border: "none", background: submitting ? "#e8b800" : BRAND.yellow,
            color: "#000", fontWeight: 700, fontSize: btnFont, letterSpacing: "0.01em",
            cursor: submitting ? "default" : "pointer", width: "100%", fontFamily: "inherit",
            boxShadow: submitting ? "none" : "0 6px 18px -8px rgba(254, 212, 46, 0.9)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}
        >
          {submitting && (
            <svg className="anim-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          )}
          {submitting ? "Creating account…" : "Create Account"}
        </button>

        <button
          type="button"
          onClick={() => router.push("/login")}
          className="auth-btn auth-btn-ghost"
          style={{
            padding: isMobile ? (tight ? "10px 20px" : "12px 20px") : "15px 20px", borderRadius: 24,
            border: `1.5px solid ${inputBorder}`, background: "transparent", color: textColor,
            fontWeight: 600, fontSize: btnFont, cursor: "pointer", width: "100%", fontFamily: "inherit",
          }}
        >
          Back to Login
        </button>

        <p style={{ textAlign: "center", fontSize: isMobile ? 13 : 14, color: mutedColor, margin: "4px 0 0" }}>
          New accounts start as <strong style={{ color: textColor, fontWeight: 700 }}>General User</strong>.
        </p>
      </form>
    </AuthShell>
  );
}
