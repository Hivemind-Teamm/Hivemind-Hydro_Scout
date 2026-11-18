const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const inMemorySessionIds = new Map<string, string>();

function storageKey(uid: string) {
  return `hydroscout:station-control-session:${uid}`;
}

/**
 * Identifies this browser tab for a shared station account. Reloads reuse the
 * identifier, while a separate tab or device receives a distinct one.
 */
export function stationControlSessionId(uid: string): string {
  const key = storageKey(uid);
  const inMemory = inMemorySessionIds.get(key);
  if (inMemory && SESSION_ID.test(inMemory)) return inMemory;
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && SESSION_ID.test(saved)) {
      inMemorySessionIds.set(key, saved);
      return saved;
    }
  } catch {
    // Session storage is unavailable in some privacy modes. Keep one ID in
    // memory for this page so every API call still represents this session.
  }

  const id = crypto.randomUUID();
  inMemorySessionIds.set(key, id);
  try { sessionStorage.setItem(key, id); } catch { /* See above. */ }
  return id;
}

export function clearStationControlSessionId(uid: string) {
  const key = storageKey(uid);
  inMemorySessionIds.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Best effort. */ }
}

export class StationSessionActiveError extends Error {
  constructor() {
    super("station-session-active");
    this.name = "StationSessionActiveError";
  }
}

export type StationSessionRequestAction = "approve" | "reject";
export type StationControlStatus =
  | { state: "active"; requestId: string | null }
  | { state: "approved" | "rejected" | "pending" | "superseded" | "expired" | "inactive"; requestId?: never };

export async function claimStationControl(
  idToken: string,
  uid: string,
): Promise<void> {
  const response = await fetch("/api/station-control/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ idToken, sessionId: stationControlSessionId(uid) }),
  });

  if (response.status === 409) throw new StationSessionActiveError();
  if (!response.ok) throw new Error("station-control-unavailable");
}

/** Requests access from the current shared-station controller. */
export async function requestStationControl(idToken: string, uid: string): Promise<void> {
  const response = await fetch("/api/station-control/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ idToken, sessionId: stationControlSessionId(uid) }),
  });
  if (!response.ok) throw new Error("station-control-request-unavailable");
}

/** Resolves a request only when this browser still holds the active station session. */
export async function resolveStationControlRequest(
  idToken: string,
  uid: string,
  requestId: string,
  action: StationSessionRequestAction,
): Promise<void> {
  const response = await fetch("/api/station-control/resolve-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ idToken, sessionId: stationControlSessionId(uid), requestId, action }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : "station-control-request-unavailable");
  }
}

/** Reads the server-authoritative state so control remains usable when a browser blocks Firestore listeners. */
export async function getStationControlStatus(idToken: string, uid: string): Promise<StationControlStatus> {
  const response = await fetch("/api/station-control/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ idToken, sessionId: stationControlSessionId(uid) }),
  });
  if (!response.ok) throw new Error("station-control-status-unavailable");
  const body = await response.json() as { state?: unknown; requestId?: unknown };
  if (body.state === "active") return { state: "active", requestId: typeof body.requestId === "string" ? body.requestId : null };
  if (["approved", "rejected", "pending", "superseded", "expired", "inactive"].includes(String(body.state))) {
    return { state: body.state as StationControlStatus["state"] & "approved" };
  }
  throw new Error("station-control-status-unavailable");
}

/** Releases a voluntarily signed-out station browser without affecting a newer session. */
export async function releaseStationControl(idToken: string, uid: string): Promise<void> {
  const response = await fetch("/api/station-control/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ idToken, sessionId: stationControlSessionId(uid) }),
  });
  if (!response.ok) throw new Error("station-control-release-unavailable");
}
