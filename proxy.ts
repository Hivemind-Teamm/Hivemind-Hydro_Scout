import { NextRequest, NextResponse } from "next/server";

type Role = "general" | "authorized" | "head" | "admin";

const ALL_ROLES: Role[] = ["general", "authorized", "head", "admin"];

const ROUTE_RULES: { prefix: string; allowed: Role[] }[] = [
  { prefix: "/admin", allowed: ["admin"] },
  { prefix: "/maintenance", allowed: ["head", "admin"] },
  { prefix: "/reports", allowed: ["head", "admin"] },
  { prefix: "/pins/new", allowed: ["authorized", "admin"] },
  { prefix: "/dashboard", allowed: ALL_ROLES },
  { prefix: "/", allowed: ALL_ROLES },
];

function getSession(req: NextRequest): { uid: string; role: Role } | null {
  const raw = req.cookies.get("session")?.value;
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
  if (!rule) {
    return NextResponse.next();
  }

  const session = getSession(req);

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
  matcher: [
    "/((?!login|unauthorized|signup|api/auth/session|_next/static|_next/image|favicon.ico).*)",
  ],
};