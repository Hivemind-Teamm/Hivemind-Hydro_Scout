import { NextRequest, NextResponse } from "next/server";

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function POST(request: NextRequest) {
  let body: { idToken?: unknown; sessionId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  if (typeof body.idToken !== "string" || typeof body.sessionId !== "string" || !SESSION_ID.test(body.sessionId)) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const { adminApp } = await import("@/lib/firebase-admin");
    const { getAuth } = await import("firebase-admin/auth");
    const { FieldValue, getFirestore } = await import("firebase-admin/firestore");
    const app = adminApp();
    const decoded = await getAuth(app).verifyIdToken(body.idToken);
    const control = getFirestore(app).doc(`stationControlSessions/${decoded.uid}`);
    const firestore = getFirestore(app);
    await firestore.runTransaction(async transaction => {
      const current = await transaction.get(control);
      if (current.data()?.activeSessionId !== body.sessionId) return;
      const pending = await transaction.get(control.collection("requests").where("status", "==", "pending"));
      const next = pending.docs
        .filter(record => record.data().requestedForSessionId === body.sessionId)
        .sort((left, right) => Number(right.data().requestedAtMs ?? 0) - Number(left.data().requestedAtMs ?? 0))[0];
      if (!next) {
        transaction.delete(control);
        return;
      }
      const data = next.data();
      const stationId = data.stationId;
      const requesterSessionId = data.requesterSessionId;
      if (typeof stationId !== "string" || typeof requesterSessionId !== "string") {
        transaction.delete(control);
        return;
      }
      transaction.set(control, {
        uid: decoded.uid,
        stationId,
        activeSessionId: requesterSessionId,
        claimedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(next.ref, { status: "approved", resolvedAt: FieldValue.serverTimestamp() });
      transaction.set(
        firestore.doc(`stations/${stationId}/notifications/station-session-request-${next.id}`),
        { sessionRequestStatus: "approved", resolvedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      transaction.set(control.collection("events").doc(), {
        type: "logout-handoff", uid: decoded.uid, stationId,
        previousSessionId: body.sessionId, newSessionId: requesterSessionId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && code.startsWith("auth/")) return NextResponse.json({ ok: false }, { status: 401 });
    console.error("[station-control] release failed:", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
