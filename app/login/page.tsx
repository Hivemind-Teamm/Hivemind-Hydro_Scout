"use client";

import { useState, FormEvent, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { useIsMobile, useIsShort } from "@/lib/use-media-query";
import AuthShell, { AccentTicks, BRAND } from "../src/components/AuthShell";

export default function LoginPage() {
  // useSearchParams() needs a Suspense boundary to prerender (Next.js 16).
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const { login, user, loading, refreshSession } = useAuth();
  const { isDark } = useTheme();
  const isMobile = useIsMobile();
  const isShort = useIsShort();
  const router = useRouter();
  const searchParams = useSearchParams();

  // iPhone-SE-class screens: phone width AND short height. We compress spacing
  // here so the whole form fits the viewport without feeling cramped.
  const tight = isMobile && isShort;
  // Mobile input vertical padding (kept at 16px font min to avoid iOS focus-zoom).
  const padY = tight ? 9 : 11;
  const headingSize = isMobile ? (tight ? 26 : 32) : 46;
  const subSize = isMobile ? (tight ? 14 : 16) : 18;
  const subMargin = isMobile ? (tight ? "4px 0 14px" : "6px 0 20px") : "10px 0 34px";
  const labelSize = isMobile ? (tight ? 12 : 13) : 14;
  const formGap = isMobile ? (tight ? 10 : 14) : 18;
  const btnFont = isMobile ? (tight ? 16 : 17) : 18;

  // Theme-derived colours (the page uses inline styles, so `dark:` utilities
  // don't apply — we branch on isDark instead). The brand panel stays black.
  const textColor = isDark ? "#e5e7eb" : "#0b0f14";
  const mutedColor = isDark ? "#8b93a1" : "#6b7280";
  const inputBg = isDark ? "#151b23" : "#ffffff";
  const inputBorder = isDark ? "#2b333f" : "#d7dbe0";
  const labelStyle: React.CSSProperties = {
    fontSize: labelSize,
    fontWeight: 600,
    color: mutedColor,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
  };
  const baseInputStyle: React.CSSProperties = {
    padding: isMobile ? `${padY}px 16px` : "13px 20px",
    borderRadius: 24,
    border: `1.5px solid ${inputBorder}`,
    fontSize: isMobile ? 16 : 17,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    color: textColor,
    background: inputBg,
    fontFamily: "inherit",
  };
  const passwordInputStyle: React.CSSProperties = { ...baseInputStyle, padding: isMobile ? `${padY}px 44px ${padY}px 16px` : "13px 48px 13px 20px" };

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      const next = searchParams.get("next") || "/";
      // Refresh the session cookie in case it's missing/stale, then navigate.
      refreshSession().finally(() => router.replace(next));
    }
  }, [user, loading, router, searchParams, refreshSession]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      const next = searchParams.get("next") || "/";
      router.push(next);
    } catch (err) {
      setError("Invalid email or password.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || user) return null; // useEffect above handles redirect

  const eyeOpen = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );

  const eyeOff = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );

  return (
    <AuthShell>
      <AccentTicks style={{ marginBottom: tight ? 10 : 16 }} />

      <h1 style={{ fontSize: headingSize, fontWeight: 800, margin: 0, lineHeight: 1.05, letterSpacing: "-0.02em", color: textColor }}>
        Every Second <span style={{ color: BRAND.red }}>Counts.</span>
      </h1>
      <p style={{ fontSize: subSize, color: mutedColor, margin: subMargin }}>
        Login Please
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: formGap }}>
        {/* Email */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="auth-input"
            style={baseInputStyle}
          />
        </div>

        {/* Password */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <label style={labelStyle}>Password</label>
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="auth-input"
              style={passwordInputStyle}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{
                position: "absolute",
                right: 14,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                color: "#888",
              }}
            >
              {showPassword ? eyeOff : eyeOpen}
            </button>
          </div>
        </div>

        {error && (
          <p className="anim-shake" style={{ color: BRAND.red, fontSize: 15, fontWeight: 500, margin: 0 }}>{error}</p>
        )}

        {/* Login button */}
        <button
          type="submit"
          disabled={submitting}
          className="auth-btn"
          style={{
            marginTop: tight ? 4 : 8,
            padding: isMobile ? (tight ? "11px 20px" : "13px 20px") : "16px 20px",
            borderRadius: 24,
            border: "none",
            background: submitting ? "#e8b800" : BRAND.yellow,
            color: "#000",
            fontWeight: 700,
            fontSize: btnFont,
            letterSpacing: "0.01em",
            cursor: submitting ? "default" : "pointer",
            width: "100%",
            fontFamily: "inherit",
            boxShadow: submitting ? "none" : "0 6px 18px -8px rgba(254, 212, 46, 0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          {submitting && (
            <svg className="anim-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          )}
          {submitting ? "Logging in..." : "Login"}
        </button>

        {/* Sign Up button */}
        <button
          type="button"
          onClick={() => router.push("/signup")}
          className="auth-btn auth-btn-ghost"
          style={{
            padding: isMobile ? (tight ? "10px 20px" : "12px 20px") : "15px 20px",
            borderRadius: 24,
            border: `1.5px solid ${inputBorder}`,
            background: "transparent",
            color: textColor,
            fontWeight: 600,
            fontSize: btnFont,
            cursor: "pointer",
            width: "100%",
            fontFamily: "inherit",
          }}
        >
          Sign Up
        </button>

        {/* Forgot password */}
        <p style={{ textAlign: "center", margin: tight ? "4px 0 0" : "8px 0 0" }}>
          <a
            href="/forgot-password"
            className="auth-link"
            style={{ color: BRAND.red, fontSize: 15, fontWeight: 600 }}
          >
            Forgot Password?
          </a>
        </p>
      </form>
    </AuthShell>
  );
}
