import { NextRequest, NextResponse } from "next/server";

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function POST(request: NextRequest) {
  let body: { idToken?: unknown; sessionId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (typeof body.idToken !== "string" || typeof body.sessionId !== "string" || !SESSION_ID.test(body.sessionId)) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const { adminApp } = await import("@/lib/firebase-admin");
    const { getAuth } = await import("firebase-admin/auth");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = adminApp();
    const decoded = await getAuth(app).verifyIdToken(body.idToken);
    const control = getFirestore(app).doc(`stationControlSessions/${decoded.uid}`);
    await getFirestore(app).runTransaction(async transaction => {
      const current = await transaction.get(control);
      if (current.data()?.activeSessionId === body.sessionId) transaction.delete(control);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && code.startsWith("auth/")) return NextResponse.json({ ok: false }, { status: 401 });
    console.error("[station-control] release failed:", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
