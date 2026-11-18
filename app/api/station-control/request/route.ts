import { NextRequest, NextResponse } from "next/server";

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

const SERVER_FAULT_AUTH_CODES = new Set(["auth/invalid-credential", "auth/insufficient-permission", "auth/internal-error", "auth/project-not-found"]);
function isTokenRejection(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("auth/") && !SERVER_FAULT_AUTH_CODES.has(code);
}

/** Creates a durable, server-authored request for the active station controller. */
export async function POST(request: NextRequest) {
  let body: { idToken?: unknown; sessionId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 }); }
  if (typeof body.idToken !== "string" || typeof body.sessionId !== "string" || !SESSION_ID.test(body.sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  try {
    const { adminApp } = await import("@/lib/firebase-admin");
    const { getAuth } = await import("firebase-admin/auth");
    const { FieldValue, getFirestore } = await import("firebase-admin/firestore");
    const app = adminApp();
    const decoded = await getAuth(app).verifyIdToken(body.idToken);
    const firestore = getFirestore(app);
    const index = await firestore.doc(`stationAccountIndex/${decoded.uid}`).get();
    const stationId = index.data()?.stationId;
    if (!index.exists || typeof stationId !== "string" || !STATION_ID.test(stationId)) {
      return NextResponse.json({ ok: false, error: "station account required" }, { status: 403 });
    }
    const profile = await firestore.doc(`stations/${stationId}/accounts/${decoded.uid}`).get();
    if (!profile.exists || profile.data()?.accountType !== "station") {
      return NextResponse.json({ ok: false, error: "station account required" }, { status: 403 });
    }

    const control = firestore.doc(`stationControlSessions/${decoded.uid}`);
    const sessionRequest = control.collection("requests").doc(body.sessionId);
    const notification = firestore.doc(`stations/${stationId}/notifications/station-session-request-${body.sessionId}`);
    await firestore.runTransaction(async transaction => {
      const current = await transaction.get(control);
      const activeSessionId = current.data()?.activeSessionId;
      if (typeof activeSessionId !== "string" || activeSessionId === body.sessionId) throw new Error("no-active-session");
      const pendingRequests = await transaction.get(control.collection("requests").where("status", "==", "pending"));
      const existing = await transaction.get(sessionRequest);
      if (existing.exists && existing.data()?.status === "pending") return;
      for (const previous of pendingRequests.docs) {
        const previousData = previous.data();
        if (previous.id === body.sessionId || previousData.requestedForSessionId !== activeSessionId) continue;
        transaction.update(previous.ref, { status: "superseded", supersededAt: FieldValue.serverTimestamp() });
        transaction.set(
          firestore.doc(`stations/${stationId}/notifications/station-session-request-${previous.id}`),
          { sessionRequestStatus: "superseded", supersededAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }
      transaction.set(sessionRequest, {
        uid: decoded.uid,
        stationId,
        requestedForSessionId: activeSessionId,
        requesterSessionId: body.sessionId,
        status: "pending",
        requestedAtMs: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(notification, {
        type: "station-session-request",
        uid: decoded.uid,
        displayName: typeof profile.data()?.station === "string" ? profile.data()!.station : "Station account",
        message: "A new device is requesting access to this station account.",
        sessionRequestId: body.sessionId,
        sessionRequestStatus: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isTokenRejection(error)) return NextResponse.json({ ok: false, error: "Session verification failed." }, { status: 401 });
    if ((error as Error).message === "no-active-session") return NextResponse.json({ ok: false, error: "The active session changed. Sign in again." }, { status: 409 });
    console.error("[station-control] request failed:", error);
    return NextResponse.json({ ok: false, error: "Station session service unavailable." }, { status: 503 });
  }
}
