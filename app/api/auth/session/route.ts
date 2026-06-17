// app/api/auth/session/route.ts

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps, cert } from "firebase-admin/app";

const SESSION_COOKIE = "session";

function adminApp() {
  if (getApps().length) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See .env.local setup instructions."
    );
  }
  const serviceAccount = JSON.parse(raw);
  return initializeApp({ credential: cert(serviceAccount) });
}

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();
  const cookieStore = await cookies();

  if (!idToken) {
    cookieStore.delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true });
  }

  try {
    const app = adminApp();
    const decoded = await getAuth(app).verifyIdToken(idToken);

    const userDoc = await getFirestore(app)
      .collection("users")
      .doc(decoded.uid)
      .get();
    const role = userDoc.exists ? userDoc.data()?.role ?? null : null;

    const sessionPayload = JSON.stringify({ uid: decoded.uid, role });

    cookieStore.set(SESSION_COOKIE, sessionPayload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.json({ ok: true, role });
  } catch (err) {
    console.error("Session creation failed:", err);
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}