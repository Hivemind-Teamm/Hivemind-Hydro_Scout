"use client";

import { useEffect, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { clearStationControlSessionId, stationControlSessionId } from "@/lib/station-control-session";
import { useAuth } from "@/lib/auth-context";

/** Signs out a shared station account when another device explicitly takes over. */
export default function StationControlSessionGuard() {
  const { user, accountType, loading, forceStationSessionLogout } = useAuth();
  const loggingOut = useRef(false);

  useEffect(() => {
    if (loading || accountType !== "station" || !user) return;
    const uid = user.uid;
    const ownSessionId = stationControlSessionId(uid);

    return onSnapshot(doc(db, "stationControlSessions", uid), snapshot => {
      const activeSessionId = snapshot.data()?.activeSessionId;
      if (
        typeof activeSessionId === "string"
        && activeSessionId !== ownSessionId
        && !loggingOut.current
      ) {
        loggingOut.current = true;
        clearStationControlSessionId(uid);
        void forceStationSessionLogout().catch(error => {
          loggingOut.current = false;
          console.error("Failed to complete station-session takeover logout:", error);
        });
      }
    });
  }, [accountType, forceStationSessionLogout, loading, user]);

  return null;
}
