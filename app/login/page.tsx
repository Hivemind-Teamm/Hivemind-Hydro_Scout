"use client";

import { useState, FormEvent, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

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
  const router = useRouter();
  const searchParams = useSearchParams();

  // Theme-derived colours (the page uses inline styles, so `dark:` utilities
  // don't apply — we branch on isDark instead). The yellow brand panel stays.
  const panelBg = isDark ? "#0b0f14" : "#ffffff";
  const textColor = isDark ? "#e5e7eb" : "#000";
  const inputBg = isDark ? "#1f2937" : "#ffffff";
  const inputBorder = isDark ? "#374151" : "#ccc";
  const errorColor = isDark ? "#f87171" : "#c00";
  const baseInputStyle: React.CSSProperties = {
    padding: "13px 20px",
    borderRadius: 24,
    border: `1.5px solid ${inputBorder}`,
    fontSize: 18,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    color: textColor,
    background: inputBg,
    fontFamily: "inherit",
  };
  const passwordInputStyle: React.CSSProperties = { ...baseInputStyle, padding: "13px 48px 13px 20px" };

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
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      {/* Left Panel */}
      <div
        style={{
          flex: "0 0 42%",
          background: "#FED42E",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ position: "relative", width: "55%", aspectRatio: "3 / 4" }}>
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
          background: panelBg,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 48px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 420 }}>
          <h1 style={{ fontSize: 56, fontWeight: 700, margin: 0, lineHeight: 1.1, color: textColor }}>
            Hello Po!
          </h1>
          <p style={{ fontSize: 26, color: textColor, margin: "8px 0 36px" }}>
            Login Please
          </p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Email */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 18, fontWeight: 500, color: textColor }}>Email</label>
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
              <label style={{ fontSize: 18, fontWeight: 500, color: textColor }}>Password</label>
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
              style={{
                marginTop: 8,
                padding: "16px 20px",
                borderRadius: 24,
                border: "2px solid #000",
                background: submitting ? "#e8b800" : "#FED42E",
                color: "#000",
                fontWeight: 700,
                fontSize: 20,
                cursor: submitting ? "default" : "pointer",
                width: "100%",
                fontFamily: "inherit",
              }}
            >
              {submitting ? "Logging in..." : "Login"}
            </button>

            {/* Sign Up button */}
            <button
              type="button"
              onClick={() => router.push("/signup")}
              style={{
                padding: "15px 20px",
                borderRadius: 24,
                border: `1.5px solid ${textColor}`,
                background: "transparent",
                color: textColor,
                fontWeight: 600,
                fontSize: 20,
                cursor: "pointer",
                width: "100%",
                fontFamily: "inherit",
              }}
            >
              Sign Up
            </button>

            {/* Forgot password */}
            <p style={{ textAlign: "center", margin: "8px 0 0" }}>
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
