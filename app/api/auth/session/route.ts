// app/api/auth/session/route.ts

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/firebase-admin";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();
  const cookieStore = await cookies();

  if (!idToken) {
    cookieStore.delete(SESSION_COOKIE);
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

    cookieStore.set(SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    // Return the role purely so the client can render the right UI; it carries
    // no authority on its own.
    const userDoc = await getFirestore(app)
      .collection("users")
      .doc(decoded.uid)
      .get();
    const role = userDoc.exists ? userDoc.data()?.role ?? null : null;

    return NextResponse.json({ ok: true, role });
  } catch (err) {
    console.error("Session creation failed:", err);
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
