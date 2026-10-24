// app/api/auth/session/route.ts

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const SESSION_COOKIE = "session";
const SESSION_META_COOKIE = "session_meta";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Firebase Auth codes that mean the server's own setup is broken, not the
// caller's token. Errors without an `auth/` code (module load failure, missing
// FIREBASE_SERVICE_ACCOUNT_KEY, Firestore outage) are server faults too.
// Server faults return 503 so a broken deployment never looks like a bad login.
const SERVER_FAULT_AUTH_CODES = new Set([
  'auth/invalid-credential',
  'auth/insufficient-permission',
  'auth/internal-error',
  'auth/project-not-found',
]);

function isTokenRejection(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('auth/') && !SERVER_FAULT_AUTH_CODES.has(code);
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

    // A verified ID token alone is not sufficient.
    // Never report success unless the session cookie is created.
    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE * 1000,
    });
    cookieStore.set(SESSION_COOKIE, sessionCookie, cookieOptions);

    const firestore = getFirestore(app);
    const indexDoc = await firestore.collection('stationAccountIndex').doc(decoded.uid).get();
    let profileDoc;
    if (indexDoc.exists) {
      const stationId = indexDoc.data()?.stationId;
      if (typeof stationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(stationId)) {
        throw new Error('Station account index contains an invalid station ID.');
      }
      profileDoc = await firestore.collection('stations')
        .doc(stationId)
        .collection('accounts')
        .doc(decoded.uid)
        .get();
    } else {
      profileDoc = await firestore.collection('users').doc(decoded.uid).get();
    }
    const role = profileDoc.exists ? profileDoc.data()?.role ?? null : null;

    cookieStore.set(
      SESSION_META_COOKIE,
      JSON.stringify({ uid: decoded.uid, role }),
      cookieOptions,
    );

    return NextResponse.json({ ok: true, role });
  } catch (adminErr) {
    // Never derive an authenticated session from unverified JWT claims.
    // Clear stale cookies rather than retaining misleading session state.
    try { cookieStore.delete(SESSION_COOKIE); } catch {}
    try { cookieStore.delete(SESSION_META_COOKIE); } catch {}

    if (isTokenRejection(adminErr)) {
      console.warn('[session] ID token rejected:', (adminErr as { code: string }).code);
      return NextResponse.json(
        { ok: false, error: 'Session verification failed.' },
        { status: 401 },
      );
    }

    // Nobody can sign in while this persists. Check GET /api/health and the
    // Vercel runtime log; do not "fix" it by trusting unverified tokens.
    console.error('[session] Firebase Admin unavailable (server fault, not a bad token):', adminErr);
    return NextResponse.json(
      { ok: false, error: 'Session service unavailable.' },
      { status: 503 },
    );
  }
}