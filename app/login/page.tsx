"use client";

import { useState, FormEvent, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { useIsMobile, useIsShort } from "@/lib/use-media-query";

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
  const headingSize = isMobile ? (tight ? 28 : 34) : 56;
  const subSize = isMobile ? (tight ? 16 : 18) : 26;
  const subMargin = isMobile ? (tight ? "4px 0 14px" : "6px 0 20px") : "8px 0 36px";
  const labelSize = isMobile ? (tight ? 13 : 15) : 18;
  const formGap = isMobile ? (tight ? 10 : 14) : 18;
  const btnFont = isMobile ? (tight ? 16 : 17) : 20;

  // Theme-derived colours (the page uses inline styles, so `dark:` utilities
  // don't apply — we branch on isDark instead). The yellow brand panel stays.
  const panelBg = isDark ? "#0b0f14" : "#ffffff";
  const textColor = isDark ? "#e5e7eb" : "#000";
  const inputBg = isDark ? "#1f2937" : "#ffffff";
  const inputBorder = isDark ? "#374151" : "#ccc";
  const errorColor = isDark ? "#e0353b" : "#e0353b";
  const baseInputStyle: React.CSSProperties = {
    padding: isMobile ? `${padY}px 16px` : "13px 20px",
    borderRadius: 24,
    border: `1.5px solid ${inputBorder}`,
    fontSize: isMobile ? 16 : 18,
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
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", width: "100%", overflowX: "hidden", ...(isMobile ? { height: "100dvh", overflowY: "hidden" } : { minHeight: "100dvh" }) }}>
      {/* Left Panel */}
      <div
        style={{
          flex: isMobile ? "0 0 auto" : "0 0 42%",
          background: "#FED42E",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: isMobile ? (tight ? "10px 0" : "16px 0") : 0,
        }}
      >
        <div style={{ position: "relative", width: isMobile ? (tight ? 64 : 84) : "55%", aspectRatio: "3 / 4" }}>
          <Image
            src="/Login Hydrant Logo.png"
            alt="Hydro-Scout Hydrant"
            fill
            style={{ objectFit: "contain" }}
            priority
          />
        </div>
      </div>

      {/* Right Panel */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: panelBg,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: isMobile ? "flex-start" : "center",
          overflowY: isMobile ? "auto" : "visible",
          padding: isMobile ? (tight ? "16px 22px 18px" : "24px 22px 30px") : "40px 48px",
        }}
      >
        {/* margin auto centres the form when it fits, yet stays scrollable when it doesn't */}
        <div style={{ width: "100%", maxWidth: 420, margin: isMobile ? "auto 0" : undefined }}>
          <h1 style={{ fontSize: headingSize, fontWeight: 700, margin: 0, lineHeight: 1.1, color: textColor }}>
            Hello Po!
          </h1>
          <p style={{ fontSize: subSize, color: textColor, margin: subMargin }}>
            Login Please
          </p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: formGap }}>
            {/* Email */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: labelSize, fontWeight: 500, color: textColor }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={baseInputStyle}
              />
            </div>

            {/* Password */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: labelSize, fontWeight: 500, color: textColor }}>Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
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
              <p style={{ color: errorColor, fontSize: 16, margin: 0 }}>{error}</p>
            )}

            {/* Login button */}
            <button
              type="submit"
              disabled={submitting}
              className="active:scale-[0.97]"
              style={{
                marginTop: tight ? 4 : 8,
                padding: isMobile ? (tight ? "11px 20px" : "13px 20px") : "16px 20px",
                borderRadius: 24,
                border: "2px solid #000",
                background: submitting ? "#e8b800" : "#FED42E",
                color: "#000",
                fontWeight: 700,
                fontSize: btnFont,
                cursor: submitting ? "default" : "pointer",
                width: "100%",
                fontFamily: "inherit",
                transition: "transform 0.1s, background 0.15s",
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
              className="active:scale-[0.97]"
              style={{
                padding: isMobile ? (tight ? "10px 20px" : "12px 20px") : "15px 20px",
                borderRadius: 24,
                border: `1.5px solid ${textColor}`,
                background: "transparent",
                color: textColor,
                fontWeight: 600,
                fontSize: btnFont,
                cursor: "pointer",
                width: "100%",
                fontFamily: "inherit",
                transition: "transform 0.1s, opacity 0.15s",
              }}
            >
              Sign Up
            </button>

            {/* Forgot password */}
            <p style={{ textAlign: "center", margin: tight ? "4px 0 0" : "8px 0 0" }}>
              <a
                href="/forgot-password"
                style={{ color: "#FFA500", fontSize: 16, fontWeight: 500, textDecoration: "none" }}
              >
                Forgot Password?
              </a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
