"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useTheme } from "@/lib/theme-context";
import { useIsMobile, useIsShort } from "@/lib/use-media-query";

/** Brand palette, lifted from the Hydro-Scout deck. */
export const BRAND = {
  yellow: "#FED42E",
  red: "#E0353B",
  /** Brand-panel canvas. Not pure black — the logo's scope-arcs are #000 and
      would otherwise disappear into the background. */
  canvas: "#1A1B1D",
  /** Headline grey used for the wordmark on the canvas. */
  chrome: "#D2D2D2",
} as const;

/** The yellow + red bars that edge every deck slide. */
function AccentStripes({ vertical }: { vertical: boolean }) {
  const base: React.CSSProperties = vertical
    ? { position: "absolute", top: 0, bottom: 0, right: 0, display: "flex" }
    : { position: "absolute", left: 0, right: 0, bottom: 0, display: "flex" };

  return (
    <div style={base} aria-hidden>
      <div style={vertical ? { width: 10, background: BRAND.yellow } : { flex: "0 0 38%", height: 5, background: BRAND.yellow }} />
      <div style={vertical ? { width: 14, background: BRAND.red } : { flex: 1, height: 5, background: BRAND.red }} />
    </div>
  );
}

/**
 * Shared chrome for /login and /signup: a dark brand panel (logo, wordmark,
 * tagline, Hivemind footer) beside a theme-aware form panel.
 *
 * The brand panel keeps its dark canvas regardless of theme — it is the brand
 * surface, the way the old panel was always yellow. Only the form side follows
 * the light/dark toggle.
 */
export default function AuthShell({ children }: { children: ReactNode }) {
  const { isDark } = useTheme();
  const isMobile = useIsMobile();
  const isShort = useIsShort();
  const tight = isMobile && isShort;

  const panelBg = isDark ? "#0b0f14" : "#ffffff";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        width: "100%",
        overflowX: "hidden",
        ...(isMobile ? { height: "100dvh", overflowY: "hidden" } : { minHeight: "100dvh" }),
      }}
    >
      {/* ── Brand panel ── */}
      <div
        style={{
          position: "relative",
          flex: isMobile ? "0 0 auto" : "0 0 42%",
          background: BRAND.canvas,
          display: "flex",
          flexDirection: isMobile ? "row" : "column",
          alignItems: "center",
          justifyContent: isMobile ? "flex-start" : "center",
          gap: isMobile ? (tight ? 12 : 16) : 0,
          padding: isMobile ? (tight ? "12px 20px 14px" : "18px 22px 20px") : "56px 52px",
          overflow: "hidden",
        }}
      >
        {/* Repeating pin motif along the top edge, fading out to the right. */}
        {!isMobile && <div className="auth-motif" style={{ position: "absolute", top: 28, left: 0, right: 0, height: 46 }} aria-hidden />}

        <div
          style={{
            position: "relative",
            flex: isMobile ? "0 0 auto" : undefined,
            width: isMobile ? (tight ? 48 : 60) : "56%",
            aspectRatio: "1 / 1",
          }}
        >
          <Image
            src="/Hydro-Scout Logo.png"
            alt="Hydro-Scout"
            fill
            sizes="(max-width: 767px) 60px, 24vw"
            style={{ objectFit: "contain" }}
            priority
          />
        </div>

        <div style={{ textAlign: isMobile ? "left" : "center", marginTop: isMobile ? 0 : -8 }}>
          <h2
            style={{
              margin: 0,
              color: BRAND.chrome,
              fontWeight: 800,
              letterSpacing: isMobile ? "-0.01em" : "-0.02em",
              lineHeight: 1,
              fontSize: isMobile ? (tight ? 22 : 26) : "clamp(30px, 3.4vw, 54px)",
            }}
          >
            HYDRO-SCOUT
          </h2>

          {isMobile ? (
            <p style={{ margin: "5px 0 0", color: "#8a8a8a", fontSize: tight ? 10 : 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Hydrant Status &amp; Water Resources
            </p>
          ) : (
            <p style={{ margin: "18px auto 0", maxWidth: 400, color: "#9a9a9a", fontSize: "clamp(13px, 0.95vw, 16px)", lineHeight: 1.6 }}>
              A Centralized Web-Based GIS Platform for{" "}
              <strong style={{ color: BRAND.red, fontWeight: 700 }}>Hydrant Status</strong> and{" "}
              <strong style={{ color: BRAND.yellow, fontWeight: 700 }}>Emergency Water Resources</strong>
            </p>
          )}
        </div>

        {!isMobile && (
          <div style={{ position: "absolute", left: 52, bottom: 40 }}>
            <p style={{ margin: 0, color: BRAND.chrome, fontWeight: 700, fontSize: 14, letterSpacing: "0.02em" }}>HIVEMIND</p>
            <p style={{ margin: "2px 0 0", color: "#6b6b6b", fontSize: 12 }}>One Mind. Infinite Solutions.</p>
          </div>
        )}

        <AccentStripes vertical={!isMobile} />
      </div>

      {/* ── Form panel ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: panelBg,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: isMobile ? "flex-start" : "center",
          overflowY: "auto",
          padding: isMobile ? (tight ? "16px 22px 18px" : "24px 22px 30px") : "40px 48px",
        }}
      >
        {/* margin auto centres the form when it fits, yet stays scrollable when it doesn't */}
        <div className="auth-rise" style={{ width: "100%", maxWidth: 420, margin: isMobile ? "auto 0" : undefined }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The two-tick yellow/red rule that sits above each form heading. */
export function AccentTicks({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", gap: 6, ...style }} aria-hidden>
      <span style={{ width: 34, height: 5, borderRadius: 3, background: BRAND.yellow }} />
      <span style={{ width: 14, height: 5, borderRadius: 3, background: BRAND.red }} />
    </div>
  );
}
