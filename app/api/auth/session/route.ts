// app/api/auth/session/route.ts

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const SESSION_COOKIE = "session";
const SESSION_META_COOKIE = "session_meta";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };

  let idToken: string | null = null;
  try {
    const body = await req.json();
    idToken = body?.idToken ?? null;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  if (!idToken) {
    try { cookieStore.delete(SESSION_COOKIE); } catch {}
    try { cookieStore.delete(SESSION_META_COOKIE); } catch {}
    return NextResponse.json({ ok: true });
  }

  // Try the full firebase-admin path first.
  try {
    const { adminApp } = await import('@/lib/firebase-admin');
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');

    const app = adminApp();
    const auth = getAuth(app);
    const decoded = await auth.verifyIdToken(idToken);

    // A verified ID token alone is not sufficient.
    // Never report success unless the session cookie is created.
    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE * 1000,
    });
    cookieStore.set(SESSION_COOKIE, sessionCookie, cookieOptions);

    const userDoc = await getFirestore(app)
      .collection('users')
      .doc(decoded.uid)
      .get();
    const role = userDoc.exists ? userDoc.data()?.role ?? null : null;

    cookieStore.set(
      SESSION_META_COOKIE,
      JSON.stringify({ uid: decoded.uid, role }),
      cookieOptions,
    );

    return NextResponse.json({ ok: true, role });
  } catch (adminErr) {
    console.error('[session] Firebase Admin verification failed:', adminErr);

    // Never derive an authenticated session from unverified JWT claims.
    // Clear stale cookies rather than retaining misleading session state.
    try { cookieStore.delete(SESSION_COOKIE); } catch {}
    try { cookieStore.delete(SESSION_META_COOKIE); } catch {}

    return NextResponse.json(
      { ok: false, error: 'Session verification failed.' },
      { status: 401 },
    );
  }
}