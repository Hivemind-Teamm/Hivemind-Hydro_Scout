import { NextRequest, NextResponse } from "next/server";

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

const SERVER_FAULT_AUTH_CODES = new Set([
  "auth/invalid-credential",
  "auth/insufficient-permission",
  "auth/internal-error",
  "auth/project-not-found",
]);

function isTokenRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("auth/") && !SERVER_FAULT_AUTH_CODES.has(code);
}

export async function POST(request: NextRequest) {
  let body: { idToken?: unknown; sessionId?: unknown; takeOver?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }

  if (
    typeof body.idToken !== "string"
    || typeof body.sessionId !== "string"
    || !SESSION_ID.test(body.sessionId)
    || typeof body.takeOver !== "undefined" && typeof body.takeOver !== "boolean"
  ) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  try {
    const { adminApp } = await import("@/lib/firebase-admin");
    const { getAuth } = await import("firebase-admin/auth");
    const { FieldValue, getFirestore } = await import("firebase-admin/firestore");

    const app = adminApp();
    const auth = getAuth(app);
    const decoded = await auth.verifyIdToken(body.idToken);
    const firestore = getFirestore(app);
    const index = await firestore.collection("stationAccountIndex").doc(decoded.uid).get();

    // Personal accounts retain their normal multi-device behavior.
    if (!index.exists) return NextResponse.json({ ok: true, stationAccount: false });

    const stationId = index.data()?.stationId;
    if (typeof stationId !== "string" || !STATION_ID.test(stationId)) {
      throw new Error("Station account index contains an invalid station ID.");
    }

    const profile = await firestore.collection("stations").doc(stationId)
      .collection("accounts").doc(decoded.uid).get();
    if (!profile.exists || profile.data()?.accountType !== "station") {
      throw new Error("Station account index points to an invalid station profile.");
    }

    const control = firestore.collection("stationControlSessions").doc(decoded.uid);
    const audit = control.collection("events").doc();
    let conflict = false;
    let tookOver = false;

    await firestore.runTransaction(async transaction => {
      const current = await transaction.get(control);
      const activeSessionId = current.exists ? current.data()?.activeSessionId : null;

      if (typeof activeSessionId === "string" && activeSessionId !== body.sessionId && !body.takeOver) {
        conflict = true;
        return;
      }

      tookOver = typeof activeSessionId === "string" && activeSessionId !== body.sessionId;
      transaction.set(control, {
        uid: decoded.uid,
        stationId,
        activeSessionId: body.sessionId,
        claimedAt: FieldValue.serverTimestamp(),
      });

      if (tookOver) {
        transaction.set(audit, {
          type: "takeover",
          uid: decoded.uid,
          stationId,
          previousSessionId: activeSessionId,
          newSessionId: body.sessionId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });

    if (conflict) {
      return NextResponse.json({ ok: false, error: "station session active" }, { status: 409 });
    }

    return NextResponse.json({ ok: true, stationAccount: true, tookOver });
  } catch (error) {
    if (isTokenRejection(error)) {
      return NextResponse.json({ ok: false, error: "Session verification failed." }, { status: 401 });
    }
    console.error("[station-control] claim failed:", error);
    return NextResponse.json({ ok: false, error: "Station session service unavailable." }, { status: 503 });
  }
}
