import { NextRequest, NextResponse } from "next/server";

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SERVER_FAULT_AUTH_CODES = new Set(["auth/invalid-credential", "auth/insufficient-permission", "auth/internal-error", "auth/project-not-found"]);
function isTokenRejection(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("auth/") && !SERVER_FAULT_AUTH_CODES.has(code);
}

/** The active controller may approve or cancel one pending station-session request. */
export async function POST(request: NextRequest) {
  let body: { idToken?: unknown; sessionId?: unknown; requestId?: unknown; action?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 }); }
  if (typeof body.idToken !== "string" || typeof body.sessionId !== "string" || typeof body.requestId !== "string"
    || !SESSION_ID.test(body.sessionId) || !SESSION_ID.test(body.requestId) || (body.action !== "approve" && body.action !== "reject")) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  try {
    const { adminApp } = await import("@/lib/firebase-admin");
    const { getAuth } = await import("firebase-admin/auth");
    const { FieldValue, getFirestore } = await import("firebase-admin/firestore");
    const app = adminApp();
    const decoded = await getAuth(app).verifyIdToken(body.idToken);
    const firestore = getFirestore(app);
    const control = firestore.doc(`stationControlSessions/${decoded.uid}`);
    const sessionRequest = control.collection("requests").doc(body.requestId);
    let outcome = "";
    await firestore.runTransaction(async transaction => {
      const [current, requested] = await Promise.all([transaction.get(control), transaction.get(sessionRequest)]);
      const data = requested.data();
      if (!current.exists || current.data()?.activeSessionId !== body.sessionId || !requested.exists
        || data?.requestedForSessionId !== body.sessionId || data?.uid !== decoded.uid) {
        outcome = "unavailable";
        return;
      }
      const stationId = data.stationId;
      if (typeof stationId !== "string" || data.requesterSessionId !== body.requestId) { outcome = "unavailable"; return; }
      const notification = firestore.doc(`stations/${stationId}/notifications/station-session-request-${body.requestId}`);
      if (data.status === "superseded") {
        transaction.update(sessionRequest, { status: "expired", expiredAt: FieldValue.serverTimestamp() });
        transaction.set(notification, { sessionRequestStatus: "expired", expiredAt: FieldValue.serverTimestamp() }, { merge: true });
        outcome = "expired";
        return;
      }
      if (data.status !== "pending") { outcome = "unavailable"; return; }
      transaction.update(sessionRequest, { status: body.action === "approve" ? "approved" : "rejected", resolvedAt: FieldValue.serverTimestamp() });
      transaction.update(notification, { sessionRequestStatus: body.action === "approve" ? "approved" : "rejected", resolvedAt: FieldValue.serverTimestamp() });
      if (body.action === "approve") {
        transaction.set(control, { uid: decoded.uid, stationId, activeSessionId: body.requestId, claimedAt: FieldValue.serverTimestamp() });
        transaction.set(control.collection("events").doc(), {
          type: "takeover-approved", uid: decoded.uid, stationId,
          previousSessionId: body.sessionId, newSessionId: body.requestId, createdAt: FieldValue.serverTimestamp(),
        });
      }
    });
    if (outcome) return NextResponse.json({ ok: false, error: outcome === "expired" ? "Request expired." : "Request is no longer available." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isTokenRejection(error)) return NextResponse.json({ ok: false, error: "Session verification failed." }, { status: 401 });
    console.error("[station-control] resolve request failed:", error);
    return NextResponse.json({ ok: false, error: "Station session service unavailable." }, { status: 503 });
  }
}
