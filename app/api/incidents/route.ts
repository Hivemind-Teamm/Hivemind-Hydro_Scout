import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/firebase-admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Require a real, verified Firebase session.
    // Never authorize using session_meta or unverified JWT contents.
    const session = req.cookies.get("session")?.value;

    if (!session) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const app = adminApp();
    const decoded = await getAuth(app).verifySessionCookie(session, true);

    // Read the current role from trusted server-side Firestore.
    const userDoc = await getFirestore(app)
      .collection("users")
      .doc(decoded.uid)
      .get();

    if (!userDoc.exists) {
      return NextResponse.json(
        { error: "User profile not found." },
        { status: 403 }
      );
    }

    const role = userDoc.data()?.role;

    if (role !== "admin" && role !== "sub_admin") {
      return NextResponse.json(
        { error: "Not authorized to manage incidents." },
        { status: 403 }
      );
    }

    // No incident writes are enabled yet.
    // Future implementation must validate input and independently
    // verify Sub Admin jurisdiction before using Firebase Admin SDK.
    return NextResponse.json(
      { error: "Incident management is not enabled yet." },
      { status: 501 }
    );
  } catch {
    // Invalid/revoked sessions and server configuration failures
    // must never result in incident access.
    return NextResponse.json(
      { error: "Authentication or server verification failed." },
      { status: 401 }
    );
  }
}
