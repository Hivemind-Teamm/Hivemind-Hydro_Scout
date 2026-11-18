"use client";

import { useEffect, useRef, useState } from "react";
import { FiShield, FiX } from "react-icons/fi";
import { clearStationControlSessionId, getStationControlStatus, resolveStationControlRequest } from "@/lib/station-control-session";
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
    let disposed = false;
    const check = async () => {
      try {
        const status = await getStationControlStatus(await user.getIdToken(), user.uid);
        if (disposed || status.state === "active" || loggingOut.current) return;
        if (status.state === "approved" || status.state === "inactive") {
          loggingOut.current = true;
          clearStationControlSessionId(user.uid);
          await forceStationSessionLogout();
        }
      } catch (error) { console.error("Failed to check station-session status:", error); }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [accountType, forceStationSessionLogout, loading, user]);

  useEffect(() => {
    if (loading || accountType !== "station" || !user) return;
    let disposed = false;
    const check = async () => {
      try {
        const status = await getStationControlStatus(await user.getIdToken(), user.uid);
        if (disposed || status.state !== "active" || !status.requestId) {
          if (!disposed) { setRequestId(null); setDismissed(false); }
          return;
        }
        let wasDismissed = false;
        try { wasDismissed = sessionStorage.getItem(`hydroscout:station-session-request-dismissed:${user.uid}:${status.requestId}`) === "1"; } catch { /* Best effort. */ }
        setRequestId(status.requestId);
        setDismissed(wasDismissed);
      } catch (error) { console.error("Failed to check station-session requests:", error); }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 2000);
    return () => { disposed = true; window.clearInterval(timer); };
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
    window.dispatchEvent(new Event("hydroscout:station-session-request"));
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
