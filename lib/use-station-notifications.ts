'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './auth-context';
import { notificationReadKey, parseReadNotifications } from './notification-read-state';

type NoticeTime = { toDate?: () => Date } | null;
export type StationNotification = {
  id: string; uid?: string; displayName?: string; adminEmail?: string;
  targetUid?: string; targetName?: string; message: string; type: string; createdAt?: NoticeTime;
};
export type JoinRequest = {
  id: string; uid: string; displayName: string; email: string;
  stationId: string; status: string; createdAt?: NoticeTime;
};
const changeEvent = 'hydroscout:notification-read';
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(changeEvent, callback);
  };
}
const sessionReads = new Map<string, string>();
function readStorage(key: string) {
  try { return sessionReads.get(key) ?? localStorage.getItem(key) ?? '[]'; }
  catch { return sessionReads.get(key) ?? '[]'; }
}

export function useStationNotifications() {
  const { user, role, stationId, stationAccessIds } = useAuth();
  const canManage = !!user && !!stationId && (role === 'admin' || role === 'head' || stationAccessIds.includes(stationId));
  const scope = canManage ? `${user!.uid}:${stationId}` : null;
  const storageKey = `hydroscout:notification-reads:${scope}`;
  const [state, setState] = useState<{
    scope: string | null; notifications: StationNotification[]; requests: JoinRequest[]; error: string | null;
  }>({ scope: null, notifications: [], requests: [], error: null });
  const rawReads = useSyncExternalStore(subscribe, () => scope ? readStorage(storageKey) : '[]', () => '[]');
  const read = new Set(parseReadNotifications(rawReads));

  useEffect(() => {
    if (!scope || !stationId) return;
    let notifications: StationNotification[] = [];
    let requests: JoinRequest[] = [];
    let error: string | null = null;
    const publish = () => setState({ scope, notifications, requests, error });
    const fail = () => { error = 'Could not load station notifications. Please try again.'; publish(); };
    const stopNotices = onSnapshot(collection(db, 'stations', stationId, 'notifications'), snapshot => {
      notifications = snapshot.docs.map(record => ({ ...record.data(), id: record.id } as StationNotification))
        .sort((a, b) => (b.createdAt?.toDate?.().getTime() ?? 0) - (a.createdAt?.toDate?.().getTime() ?? 0));
      publish();
    }, fail);
    const stopRequests = onSnapshot(query(collection(db, 'stationJoinRequests'), where('stationId', '==', stationId), where('status', '==', 'pending')), snapshot => {
      requests = snapshot.docs.map(record => ({ ...record.data(), id: record.id } as JoinRequest));
      publish();
    }, fail);
    return () => { stopNotices(); stopRequests(); };
  }, [scope, stationId]);

  const notifications = state.scope === scope && scope ? state.notifications : [];
  const requests = state.scope === scope && scope ? state.requests : [];
  const activityKey = (item: StationNotification) => notificationReadKey('activity', item.id, item.createdAt);
  const memberKey = (item: JoinRequest) => notificationReadKey('member', item.id, item.createdAt);
  const markRead = (key: string) => {
    if (!scope) return;
    const next = JSON.stringify([...new Set([...parseReadNotifications(readStorage(storageKey)), key])]);
    try { localStorage.setItem(storageKey, next); sessionReads.delete(storageKey); }
    catch { sessionReads.set(storageKey, next); }
    window.dispatchEvent(new Event(changeEvent));
  };
  return {
    notifications, requests, error: state.scope === scope ? state.error : null,
    isActivityUnread: (item: StationNotification) => !read.has(activityKey(item)),
    isMemberUnread: (item: JoinRequest) => !read.has(memberKey(item)),
    hasUnreadActivity: notifications.some(item => !read.has(activityKey(item))),
    hasUnreadMembers: requests.some(item => !read.has(memberKey(item))),
    readActivity: (item: StationNotification) => markRead(activityKey(item)),
    readMember: (item: JoinRequest) => markRead(memberKey(item)),
  };
}
