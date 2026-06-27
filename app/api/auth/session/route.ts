// app/api/auth/session/route.ts

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/firebase-admin";

const SESSION_COOKIE = "session";
const SESSION_META_COOKIE = "session_meta";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();
  const cookieStore = await cookies();

  if (!idToken) {
    cookieStore.delete(SESSION_COOKIE);
    cookieStore.delete(SESSION_META_COOKIE);
    return NextResponse.json({ ok: true });
  }

  try {
    const app = adminApp();
    const auth = getAuth(app);
    const decoded = await auth.verifyIdToken(idToken);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: SESSION_MAX_AGE,
    };

    // Issue a signed Firebase session cookie — used by server routes like
    // /api/upload to verify the caller without re-reading Firestore.
    // Isolated try/catch so a quota-exceeded error here doesn't prevent
    // session_meta from being written (session_meta is what the proxy needs).
    try {
      const sessionCookie = await auth.createSessionCookie(idToken, {
        expiresIn: SESSION_MAX_AGE * 1000,
      });
      cookieStore.set(SESSION_COOKIE, sessionCookie, cookieOptions);
    } catch (err) {
      console.warn("createSessionCookie failed (quota?); proxy will still work via session_meta:", err);
    }

    const userDoc = await getFirestore(app)
      .collection("users")
      .doc(decoded.uid)
      .get();
    const role = userDoc.exists ? userDoc.data()?.role ?? null : null;

    // session_meta is read by proxy.ts to enforce route-level access control.
    // Always written — even when createSessionCookie fails — so the proxy is
    // never blocked by Firebase Auth quota issues.
    cookieStore.set(
      SESSION_META_COOKIE,
      JSON.stringify({ uid: decoded.uid, role }),
      cookieOptions,
    );

    return NextResponse.json({ ok: true, role });
  } catch (err) {
    console.error("Session creation failed:", err);
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
