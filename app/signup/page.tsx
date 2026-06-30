"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { useIsMobile, useIsShort } from "@/lib/use-media-query";

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
      router.replace("/dashboard");
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
      router.push("/dashboard");
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
  const headingSize = isMobile ? (tight ? 28 : 34) : 56;
  const subSize = isMobile ? (tight ? 16 : 18) : 26;
  const subMargin = isMobile ? (tight ? "4px 0 12px" : "6px 0 18px") : "8px 0 28px";
  const labelSize = isMobile ? (tight ? 13 : 15) : 18;
  const formGap = isMobile ? (tight ? 9 : 12) : 16;
  const btnFont = isMobile ? (tight ? 16 : 17) : 20;

  const panelBg     = isDark ? "#0b0f14" : "#ffffff";
  const textColor   = isDark ? "#e5e7eb" : "#000";
  const inputBg     = isDark ? "#1f2937" : "#ffffff";
  const inputBorder = isDark ? "#374151" : "#ccc";

  const inputStyle: React.CSSProperties = {
    padding: isMobile ? `${padY}px 16px` : "13px 20px", borderRadius: 24,
    border: `1.5px solid ${inputBorder}`, fontSize: isMobile ? 16 : 18, outline: "none",
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

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", width: "100%", overflowX: "hidden", ...(isMobile ? { height: "100dvh", overflowY: "hidden" } : { minHeight: "100dvh" }) }}>
      {/* Left yellow panel */}
      <div style={{ flex: isMobile ? "0 0 auto" : "0 0 42%", background: "#FED42E", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? (tight ? "8px 0" : "14px 0") : 0 }}>
        <div style={{ position: "relative", width: isMobile ? (tight ? 58 : 78) : "55%", aspectRatio: "3 / 4" }}>
          <Image src="/Login Hydrant Logo.png" alt="Hydro-Scout Hydrant" fill style={{ objectFit: "contain" }} priority />
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, minHeight: 0, background: panelBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: isMobile ? "flex-start" : "center", padding: isMobile ? (tight ? "14px 22px 16px" : "24px 22px 30px") : "40px 48px", overflowY: "auto" }}>
        {/* margin auto centres the form when it fits, yet stays scrollable when it doesn't */}
        <div style={{ width: "100%", maxWidth: 420, margin: isMobile ? "auto 0" : undefined }}>
          <h1 style={{ fontSize: headingSize, fontWeight: 700, margin: 0, lineHeight: 1.1, color: textColor }}>Join Us!</h1>
          <p style={{ fontSize: subSize, color: textColor, margin: subMargin }}>Create an Account</p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: formGap }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: labelSize, fontWeight: 500, color: textColor }}>Display Name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" placeholder="e.g. Juan dela Cruz" style={inputStyle} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: labelSize, fontWeight: 500, color: textColor }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" style={inputStyle} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: labelSize, fontWeight: 500, color: textColor }}>Password</label>
              <div style={{ position: "relative" }}>
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" placeholder="At least 6 characters" style={pwInputStyle} />
                <button type="button" onClick={() => setShowPassword((v) => !v)} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: "#888" }}>
                  {showPassword ? eyeOff : eyeOpen}
                </button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: labelSize, fontWeight: 500, color: textColor }}>Confirm Password</label>
              <div style={{ position: "relative" }}>
                <input type={showConfirm ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" style={pwInputStyle} />
                <button type="button" onClick={() => setShowConfirm((v) => !v)} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: "#888" }}>
                  {showConfirm ? eyeOff : eyeOpen}
                </button>
              </div>
            </div>

            {error && <p style={{ color: "#e0353b", fontSize: 16, margin: 0 }}>{error}</p>}

            <button type="submit" disabled={submitting} style={{ marginTop: tight ? 4 : 8, padding: isMobile ? (tight ? "11px 20px" : "13px 20px") : "16px 20px", borderRadius: 24, border: "2px solid #000", background: submitting ? "#e8b800" : "#FED42E", color: "#000", fontWeight: 700, fontSize: btnFont, cursor: submitting ? "default" : "pointer", width: "100%", fontFamily: "inherit" }}>
              {submitting ? "Creating account…" : "Create Account"}
            </button>
            <button type="button" onClick={() => router.push("/login")} style={{ padding: isMobile ? (tight ? "10px 20px" : "12px 20px") : "15px 20px", borderRadius: 24, border: `1.5px solid ${textColor}`, background: "transparent", color: textColor, fontWeight: 600, fontSize: btnFont, cursor: "pointer", width: "100%", fontFamily: "inherit" }}>
              Back to Login
            </button>
            <p style={{ textAlign: "center", fontSize: isMobile ? 14 : 15, color: textColor, margin: "4px 0 0" }}>
              New accounts start as <strong>General User</strong>.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
