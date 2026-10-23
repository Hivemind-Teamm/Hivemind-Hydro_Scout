
import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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

async function getVerifiedStation(
  firestore: Firestore,
  uid: string
): Promise<string | null> {
  const index = await firestore
    .collection("stationAccountIndex")
    .doc(uid)
    .get();

  if (!index.exists) return null;

  const indexData = index.data();

  if (
    !indexData ||
    Object.keys(indexData).length !== 1 ||
    typeof indexData.stationId !== "string" ||
    !STATION_ID_PATTERN.test(indexData.stationId)
  ) {
    return null;
  }

  const stationId = indexData.stationId;

  const [station, account] = await Promise.all([
    firestore.collection("stations").doc(stationId).get(),
    firestore
      .collection("stations")
      .doc(stationId)
      .collection("accounts")
      .doc(uid)
      .get(),
  ]);

  if (!station.exists || station.data()?.active !== true) {
    return null;
  }

  const profile = account.data();

  if (
    !account.exists ||
    profile?.uid !== uid ||
    profile?.accountType !== "station" ||
    profile?.stationId !== stationId
  ) {
    return null;
  }

  return stationId;
}

async function isVerifiedPersonalAdmin(
  firestore: Firestore,
  uid: string
): Promise<boolean> {
  const stationIndex = await firestore
    .collection("stationAccountIndex")
    .doc(uid)
    .get();

  // Station accounts must never gain personal admin privileges.
  if (stationIndex.exists) return false;

  const user = await firestore.collection("users").doc(uid).get();

  return (
    user.exists &&
    user.data()?.role === "admin" &&
    user.data()?.accountType !== "station"
  );
}

export async function POST(req: NextRequest) {
  const session = req.cookies.get("session")?.value;

  if (!session) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  try {
    const app = adminApp();
    const decoded = await getAuth(app).verifySessionCookie(
      session,
      true
    );

    const firestore = getFirestore(app);

    const [stationId, isAdmin] = await Promise.all([
      getVerifiedStation(firestore, decoded.uid),
      isVerifiedPersonalAdmin(firestore, decoded.uid),
    ]);

    if (!stationId && !isAdmin) {
      return NextResponse.json(
        { error: "Not authorized to manage incidents." },
        { status: 403 }
      );
    }

    // Incident creation remains disabled.
    // No client-provided jurisdiction flags are trusted.
    return NextResponse.json(
      { error: "Incident management is not enabled yet." },
      { status: 501 }
    );
  } catch {
    return NextResponse.json(
      { error: "Authentication or server verification failed." },
      { status: 401 }
    );
  }
}

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
    const decoded = await getAuth(app).verifySessionCookie(
      session,
      true
    );

    const firestore = getFirestore(app);
    const stationId = await getVerifiedStation(
      firestore,
      decoded.uid
    );

    if (!stationId) {
      return incidentFeedResponse(
        { error: "Not authorized for incident assignments." },
        403
      );
    }

    const snapshot = await firestore
      .collection("incidents")
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

      return [{
        id: record.id,
        lat: location.latitude,
        lng: location.longitude,
      }];
    });

    return incidentFeedResponse({ incidents });
  } catch {
    return incidentFeedResponse(
      { error: "Incident feed verification failed." },
      401
    );
  }
}
