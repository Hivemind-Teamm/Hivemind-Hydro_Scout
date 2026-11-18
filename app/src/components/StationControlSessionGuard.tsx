"use client";

import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { FiShield, FiX } from "react-icons/fi";
import { db } from "@/lib/firebase";
import { clearStationControlSessionId, resolveStationControlRequest, stationControlSessionId } from "@/lib/station-control-session";
import { useAuth } from "@/lib/auth-context";

/** Keeps shared station control single-session and surfaces transfer requests without blocking work. */
export default function StationControlSessionGuard() {
  const { user, accountType, loading, forceStationSessionLogout } = useAuth();
  const loggingOut = useRef(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (loading || accountType !== "station" || !user) return;
    const uid = user.uid;
    const ownSessionId = stationControlSessionId(uid);
    return onSnapshot(doc(db, "stationControlSessions", uid), snapshot => {
      const activeSessionId = snapshot.data()?.activeSessionId;
      if (typeof activeSessionId === "string" && activeSessionId !== ownSessionId && !loggingOut.current) {
        loggingOut.current = true;
        clearStationControlSessionId(uid);
        void forceStationSessionLogout().catch(error => {
          loggingOut.current = false;
          console.error("Failed to complete station-session takeover logout:", error);
        });
      }
    });
  }, [accountType, forceStationSessionLogout, loading, user]);

  useEffect(() => {
    if (loading || accountType !== "station" || !user) return;
    const uid = user.uid;
    const ownSessionId = stationControlSessionId(uid);
    return onSnapshot(collection(db, "stationControlSessions", uid, "requests"), snapshot => {
      const pending = snapshot.docs.filter(record => {
        const data = record.data();
        return data.status === "pending" && data.requestedForSessionId === ownSessionId;
      }).sort((left, right) => Number(right.data().requestedAtMs ?? 0) - Number(left.data().requestedAtMs ?? 0))[0];
      if (!pending) { setRequestId(null); setDismissed(false); return; }
      let wasDismissed = false;
      try { wasDismissed = sessionStorage.getItem(`hydroscout:station-session-request-dismissed:${uid}:${pending.id}`) === "1"; } catch { /* Best effort. */ }
      setRequestId(pending.id);
      setDismissed(wasDismissed);
    }, error => console.error("Failed to watch station-session requests:", error));
  }, [accountType, loading, user]);

  async function resolve(action: "approve" | "reject") {
    if (!user || !requestId || resolving) return;
    setResolving(true);
    try {
      await resolveStationControlRequest(await user.getIdToken(), user.uid, requestId, action);
      setRequestId(null);
    } catch (error) {
      console.error("Could not resolve station-session request:", error);
    } finally { setResolving(false); }
  }

  function dismiss() {
    if (!user || !requestId) return;
    try { sessionStorage.setItem(`hydroscout:station-session-request-dismissed:${user.uid}:${requestId}`, "1"); } catch { /* Best effort. */ }
    setDismissed(true);
  }

  if (!requestId || dismissed) return null;
  return <aside role="alert" aria-live="assertive" className="fixed bottom-5 right-5 z-[5000] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-neutral-700 bg-[#111111] p-4 pr-5 font-sans text-neutral-100 shadow-2xl">
    <button type="button" onClick={dismiss} aria-label="Dismiss and keep in station activity" title="Keep in station activity" className="absolute left-2 top-2 rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-white"><FiX /></button>
    <div className="ml-7 flex items-center gap-2"><FiShield className="text-amber-400" /><h2 className="text-sm font-bold">New Station Login Request</h2></div>
    <p className="mt-4 text-sm font-medium">Another device is requesting access to this station account.</p>
    <p className="mt-2 text-xs leading-relaxed text-neutral-300">Allowing it signs out this device and makes the other device the active station session.</p>
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" disabled={resolving} onClick={() => void resolve("reject")} className="rounded-full border border-neutral-600 px-4 py-2 text-xs font-bold text-neutral-200 hover:bg-neutral-800 disabled:opacity-50">Cancel</button>
      <button type="button" disabled={resolving} onClick={() => void resolve("approve")} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-200 disabled:opacity-50">Allow Takeover</button>
    </div>
  </aside>;
}
