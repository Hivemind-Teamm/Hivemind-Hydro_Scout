// Each heartbeat is one write plus ~2 billed security-rule reads and one read
// per listener watching it; two minutes halves that cost per open tab.
export const PRESENCE_HEARTBEAT_MS = 2 * 60_000;
export const PRESENCE_EXPIRY_MS = 3 * PRESENCE_HEARTBEAT_MS;

export type PresenceRecord = { uid: string; lastSeenAt?: { toMillis?: () => number } | null };

export function accountIsPresent(records: PresenceRecord[], uid: string, now: number) {
  return records.some(record => {
    const seen = record.lastSeenAt?.toMillis?.();
    return record.uid === uid && typeof seen === 'number' && Number.isFinite(seen)
      && now - seen < PRESENCE_EXPIRY_MS && seen - now <= PRESENCE_HEARTBEAT_MS;
  });
}

/** Serialize writes so an in-flight heartbeat cannot recreate a stopped session. */
export function presenceSession(write: () => Promise<unknown>, remove: () => Promise<unknown>) {
  let stopped = false;
  let running: Promise<unknown> | null = null;
  let stopping: Promise<unknown> | null = null;
  return {
    heartbeat() {
      if (stopped || running) return running ?? Promise.resolve();
      running = Promise.resolve().then(() => stopped ? undefined : write()).finally(() => { running = null; });
      return running;
    },
    stop() {
      if (stopping) return stopping;
      stopped = true;
      stopping = (running ?? Promise.resolve()).catch(() => {}).then(remove);
      return stopping;
    },
  };
}
