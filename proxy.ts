// proxy.ts (formerly middleware.ts, renamed per Next.js 16 convention)
//
// Runs on every request matching `config.matcher` below, before any page
// renders. Reads the `session` cookie (set by app/api/auth/session/route.ts
// at login) and decides whether to allow, redirect to login, or block.
//
// IMPORTANT: this is a coarse, fast first line of defense (good UX: don't
// even load a page the user can't use). The REAL enforcement is still the
// Firestore security rules — proxy can be bypassed by direct API
// calls, but the rules can't.

import { NextRequest, NextResponse } from "next/server";

type Role = "general" | "authorized" | "head" | "admin";

const ALL_ROLES: Role[] = ["general", "authorized", "head", "admin"];

// Map route prefixes to the minimum set of roles allowed in.
// Add new protected routes here as the app grows. Order matters: the
// FIRST matching rule wins, so put more specific prefixes before "/".
const ROUTE_RULES: { prefix: string; allowed: Role[] }[] = [
  { prefix: "/maintenance", allowed: ["head", "admin"] },
  { prefix: "/reports", allowed: ["head", "admin"] },
  { prefix: "/pins/new", allowed: ["authorized", "admin"] },
  // Homepage and admin: auth enforced client-side (admin is an overlay,
  // gated by role + Firestore rules).
];

function getSession(req: NextRequest): { uid: string; role: Role } | null {
  const raw = req.cookies.get("session_meta")?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const rule = ROUTE_RULES.find((r) => pathname.startsWith(r.prefix));
  console.log("[proxy] path:", pathname, "matched rule:", rule);
  if (!rule) {
    return NextResponse.next();
  }

  const session = getSession(req);
  console.log("[proxy] session:", session);

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!rule.allowed.includes(session.role)) {
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything EXCEPT: login/unauthorized pages (avoid redirect
  // loops), the session API route (must always be reachable to log in/out),
  // static assets, and Next internals.
  matcher: [
    "/((?!login|unauthorized|api/auth/session|_next/static|_next/image|favicon.ico).*)",
  ],
};