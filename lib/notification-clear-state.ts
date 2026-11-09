// "Clear notifications" only hides items in this browser; Firestore is never
// written. The cutoff is the newest cleared event's server timestamp, so a
// skewed device clock cannot hide events that arrive later.
type Stamped = { createdAt?: { toMillis?: () => number } | null };

export function notificationClearKey(scope: string) {
  return `hydroscout:notifications-cleared:${scope}`;
}

export function parseClearedBefore(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

const stamp = (item: Stamped) => item.createdAt?.toMillis?.() ?? 0;

/** Cutoff that hides every item currently listed; never moves backwards. */
export function nextClearedBefore(items: Stamped[], previous: number) {
  return Math.max(previous, 1, ...items.map(stamp));
}

/** Items without a timestamp count as old, so legacy records can be cleared too. */
export function hideClearedNotifications<T extends Stamped>(items: T[], clearedBefore: number): T[] {
  return clearedBefore ? items.filter(item => stamp(item) > clearedBefore) : items;
}
