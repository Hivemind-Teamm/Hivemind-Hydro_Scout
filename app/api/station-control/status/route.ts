import { NextRequest, NextResponse } from "next/server";

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SERVER_FAULT_AUTH_CODES = new Set(["auth/invalid-credential", "auth/insufficient-permission", "auth/internal-error", "auth/project-not-found"]);

function isTokenRejection(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("auth/") && !SERVER_FAULT_AUTH_CODES.has(code);
}

/** Server-verified station-control state. This does not rely on a browser Firestore listener. */
export async function POST(request: NextRequest) {
  let body: { idToken?: unknown; sessionId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 }); }
  if (typeof body.idToken !== "string" || typeof body.sessionId !== "string" || !SESSION_ID.test(body.sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  try {
    const { adminApp } = await import("@/lib/firebase-admin");
    const { getAuth } = await import("firebase-admin/auth");
    const { getFirestore } = await import("firebase-admin/firestore");
    const decoded = await getAuth(adminApp()).verifyIdToken(body.idToken);
    const firestore = getFirestore(adminApp());
    const control = firestore.doc(`stationControlSessions/${decoded.uid}`);
    const current = await control.get();
    const activeSessionId = current.data()?.activeSessionId;

    if (activeSessionId === body.sessionId) {
      const pending = await control.collection("requests").where("status", "==", "pending").get();
      const request = pending.docs
        .filter(record => record.data().requestedForSessionId === body.sessionId)
        .sort((left, right) => Number(right.data().requestedAtMs ?? 0) - Number(left.data().requestedAtMs ?? 0))[0];
      return NextResponse.json({ ok: true, state: "active", requestId: request?.id ?? null });
    }

    const ownRequest = await control.collection("requests").doc(body.sessionId).get();
    const status = ownRequest.data()?.status;
    if (typeof status === "string") return NextResponse.json({ ok: true, state: status });
    return NextResponse.json({ ok: true, state: "inactive" });
  } catch (error) {
    if (isTokenRejection(error)) return NextResponse.json({ ok: false, error: "Session verification failed." }, { status: 401 });
    console.error("[station-control] status failed:", error);
    return NextResponse.json({ ok: false, error: "Station session service unavailable." }, { status: 503 });
  }
}
