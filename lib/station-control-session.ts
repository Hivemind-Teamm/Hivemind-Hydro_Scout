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

export async function claimStationControl(
  idToken: string,
  uid: string,
  takeOver = false,
): Promise<void> {
  const response = await fetch("/api/station-control/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ idToken, sessionId: stationControlSessionId(uid), takeOver }),
  });

  if (response.status === 409) throw new StationSessionActiveError();
  if (!response.ok) throw new Error("station-control-unavailable");
}
