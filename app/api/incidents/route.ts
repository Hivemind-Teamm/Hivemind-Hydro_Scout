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

// Never cache potentially sensitive incident assignments.
export const dynamic = "force-dynamic";

function incidentFeedResponse(
  body: Record<string, unknown>,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
    },
  });
}

/**
 * Read-only trusted incident feed for an authenticated Sub Admin station.
 *
 * The station identity comes exclusively from server-side Firestore.
 * This endpoint does not create incidents or publish GPS locations.
 */
export async function GET(req: NextRequest) {
  const session = req.cookies.get("session")?.value;

  if (!session) {
    return incidentFeedResponse(
      { error: "Authentication required." },
      401
    );
  }

  try {
    const app = adminApp();
    const decoded = await getAuth(app).verifySessionCookie(session, true);
    const firestore = getFirestore(app);

    const profile = await firestore.collection("users")
      .doc(decoded.uid)
      .get();

    const user = profile.data();

    if (
      !profile.exists ||
      user?.role !== "sub_admin" ||
      user?.accountType !== "station" ||
      typeof user?.stationId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(user.stationId)
    ) {
      return incidentFeedResponse(
        { error: "Not authorized for incident assignments." },
        403
      );
    }

    const stationId: string = user.stationId;

    // Incidents are provisioned only by trusted server processes.
    // Query by the server-verified station ID, never request parameters.
    const snapshot = await firestore.collection("incidents")
      .where("assignedStationIds", "array-contains", stationId)
      .limit(101)
      .get();

    if (snapshot.size > 100) {
      return incidentFeedResponse(
        { error: "Incident assignment feed exceeds supported limit." },
        503
      );
    }

    const incidents = snapshot.docs.flatMap(record => {
      const incident = record.data();
      const location = incident.location;

      if (
        incident.status !== "active" ||
        !/^[A-Za-z0-9_-]+$/.test(record.id) ||
        !Array.isArray(incident.assignedStationIds) ||
        !incident.assignedStationIds.includes(stationId) ||
        !location ||
        typeof location.latitude !== "number" ||
        typeof location.longitude !== "number" ||
        !Number.isFinite(location.latitude) ||
        !Number.isFinite(location.longitude) ||
        Math.abs(location.latitude) > 90 ||
        Math.abs(location.longitude) > 180
      ) {
        return [];
      }

      // Return only the fields required by the GPS controller.
      return [{
        id: record.id,
        lat: location.latitude,
        lng: location.longitude,
      }];
    });

    return incidentFeedResponse({ incidents });
  } catch {
    // Authentication failures and backend failures must never expose
    // incident assignments or fall back to unverified session metadata.
    return incidentFeedResponse(
      { error: "Incident feed verification failed." },
      401
    );
  }
}
