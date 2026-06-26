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

    // Issue a cryptographically signed Firebase session cookie. The role is
    // NOT baked into the cookie — server routes re-read it from Firestore so a
    // forged or stale cookie can't grant a role the user doesn't actually have.
    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE * 1000, // milliseconds
    });

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: SESSION_MAX_AGE,
    };

    cookieStore.set(SESSION_COOKIE, sessionCookie, cookieOptions);

    const userDoc = await getFirestore(app)
      .collection("users")
      .doc(decoded.uid)
      .get();
    const role = userDoc.exists ? userDoc.data()?.role ?? null : null;

    // session_meta is read by proxy.ts (middleware) to enforce route-level
    // access control. It carries uid+role as plain JSON so the Edge-compatible
    // proxy doesn't need to decode the Firebase JWT itself.
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
