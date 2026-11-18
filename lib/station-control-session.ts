const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function storageKey(uid: string) {
  return `hydroscout:station-control-session:${uid}`;
}

/**
 * Identifies this browser tab for a shared station account. Reloads reuse the
 * identifier, while a separate tab or device receives a distinct one.
 */
export function stationControlSessionId(uid: string): string {
  const key = storageKey(uid);
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && SESSION_ID.test(saved)) return saved;
  } catch {
    // Session storage is unavailable in some privacy modes. The in-memory ID
    // below still lets the current page participate in the control check.
  }

  const id = crypto.randomUUID();
  try { sessionStorage.setItem(key, id); } catch { /* See above. */ }
  return id;
}

export function clearStationControlSessionId(uid: string) {
  try { sessionStorage.removeItem(storageKey(uid)); } catch { /* Best effort. */ }
}

export class StationSessionActiveError extends Error {
  constructor() {
    super("station-session-active");
    this.name = "StationSessionActiveError";
  }
}

export type StationSessionRequestAction = "approve" | "reject";

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
