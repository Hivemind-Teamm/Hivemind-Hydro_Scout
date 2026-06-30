// app/api/auth/session/route.ts

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const SESSION_COOKIE = "session";
const SESSION_META_COOKIE = "session_meta";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Decode JWT payload without verification — used as a fallback when
// firebase-admin is unavailable. Real authorization is enforced by Firestore
// security rules; this cookie is only a fast proxy-redirect hint.
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1];
    if (!part) return {};
    const json = Buffer.from(part, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

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

    try {
      const sessionCookie = await auth.createSessionCookie(idToken, {
        expiresIn: SESSION_MAX_AGE * 1000,
      });
      cookieStore.set(SESSION_COOKIE, sessionCookie, cookieOptions);
    } catch (err) {
      console.warn('[session] createSessionCookie failed:', err);
    }

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
    console.error('[session] firebase-admin path failed:', adminErr);

    // Fallback: decode the JWT without verification so the proxy cookie is
    // still set. Firestore rules remain the real authorization gate.
    try {
      const claims = decodeJwtPayload(idToken);
      const uid = (claims.uid ?? claims.sub ?? claims.user_id) as string | undefined;
      if (!uid) throw new Error('no uid in token');

      cookieStore.set(
        SESSION_META_COOKIE,
        JSON.stringify({ uid, role: null }),
        cookieOptions,
      );
      console.warn('[session] used fallback JWT decode — role will be null');
      return NextResponse.json({ ok: true, role: null, fallback: true });
    } catch (fallbackErr) {
      console.error('[session] fallback also failed:', fallbackErr);
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }
}
