'use client';

import { useEffect, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import type { StationNotification } from './station-notification-feed';
import { parseReadNotifications } from './notification-read-state';
import { recordFirestoreDiagnostic } from './firestore-diagnostics';

type Feed = { scope: string | null; items: StationNotification[]; readIds: string[]; receiptTokens: Record<string, string>; error: string | null };
const localReads = new Map<string, Set<string>>();
const readEvent = 'hydroscout:limited-notification-read';
type WireNotification = Omit<StationNotification, 'createdAt' | 'response'> & {
  createdAt: number;
  response?: Omit<NonNullable<StationNotification['response']>, 'startedAt' | 'endedAt'> & { startedAt: number; endedAt: number };
};
type WireFeed = { viewerUid: string; notifications: WireNotification[]; readIds: string[]; receiptTokens: Record<string, string> };
// Fire incidents already arrive through the signed-in real-time fire-pin
// listener. This feed contains lower-urgency account/report/activity history,
// so a five-minute refresh avoids repeatedly rebuilding up to 100 items.
// Focus and visibility changes still refresh immediately.
const REFRESH_INTERVAL_MS = 5 * 60_000;
// Short-lived request coalescing protects remounts and focus events from
// issuing concurrent copies of the same server/database work.
const polls = new Map<string, { until: number; result: Promise<WireFeed> }>();
function fetchFeed(scope: string) {
  const existing = polls.get(scope);
  if (existing && existing.until > Date.now()) return existing.result;
  recordFirestoreDiagnostic('request', 'limited-notification-feed');
  const result = fetch('/api/notifications', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    .then(async response => {
      if (!response.ok) throw new Error('Could not load notifications. Please try again.');
      const data: WireFeed = await response.json();
      if (data.viewerUid !== decodeURIComponent(scope.split(':')[0])) throw new Error('Your session is updating. Please try again.');
      return data;
    });
  polls.set(scope, { until: Date.now() + 5000, result });
  void result.catch(() => { if (polls.get(scope)?.result === result) polls.delete(scope); });
  return result;
}

export function useLimitedNotifications(scope: string | null) {
  const [state, setState] = useState<Feed>({ scope: null, items: [], readIds: [], receiptTokens: {}, error: null });
  useEffect(() => {
    if (!scope) return;
    let active = true;
    let running = false;
    let generation = 0;
    const controller = new AbortController();
    const key = `hydroscout:limited-reads:${scope.split(':')[0]}`;
    const cachedReads = () => {
      try { return parseReadNotifications(localStorage.getItem(key) ?? '[]'); } catch { return []; }
    };
    const refresh = async () => {
      if (running || document.hidden) return;
      running = true;
      const version = ++generation;
      try {
        const data = await fetchFeed(scope);
        const stamp = (value: number) => value > 0 ? Timestamp.fromMillis(value) : null;
        const items = data.notifications.map(({ response, createdAt, ...item }): StationNotification => ({
          ...item, createdAt: stamp(createdAt),
          response: response ? { ...response,
            startedAt: stamp(response.startedAt), endedAt: stamp(response.endedAt) } : undefined,
        }));
        if (active && version === generation) setState({ scope, items, readIds: [...new Set<string>([...data.readIds, ...cachedReads(), ...(localReads.get(scope) ?? [])])], receiptTokens: data.receiptTokens, error: null });
      } catch (error) {
        if (active && !controller.signal.aborted) setState({ scope, items: [], readIds: [], receiptTokens: {}, error: error instanceof Error ? error.message : 'Could not load notifications.' });
      } finally { running = false; }
    };
    const syncRead = () => setState(current => current.scope === scope ? { ...current, readIds: [...new Set([...current.readIds, ...cachedReads(), ...(localReads.get(scope) ?? [])])] } : current);
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const visible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener(readEvent, syncRead);
    window.addEventListener('storage', syncRead);
    return () => {
      active = false; controller.abort(); clearInterval(timer);
      window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible);
      window.removeEventListener(readEvent, syncRead); window.removeEventListener('storage', syncRead);
    };
  }, [scope]);
  const current = state.scope === scope && scope ? state : {
    items: [], readIds: [], receiptTokens: {} as Record<string, string>, error: null,
  };
  const read = new Set(current.readIds);
  const readActivity = (item: StationNotification) => {
    if (!scope) return;
    const reads = new Set([...read, ...(localReads.get(scope) ?? []), item.id]);
    localReads.set(scope, reads);
    try { localStorage.setItem(`hydroscout:limited-reads:${scope.split(':')[0]}`, JSON.stringify([...reads])); } catch { /* Session fallback remains available. */ }
    window.dispatchEvent(new Event(readEvent));
    const token = current.receiptTokens[item.id];
    if (!token) return;
    void fetch('/api/notifications', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, token }) })
      .then(response => { if (!response.ok) console.warn('Notification read status could not sync.'); })
      .catch(() => console.warn('Notification read status could not sync.'));
  };
  return { notifications: current.items, requests: [], error: current.error,
    hasUnreadActivity: current.items.some(item => !read.has(item.id)), hasUnreadMembers: false,
    isActivityUnread: (item: StationNotification) => !read.has(item.id), isMemberUnread: () => false,
    readActivity, readMember: () => {},
  };
}
