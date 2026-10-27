'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './auth-context';
import { notificationReadKey, parseReadNotifications } from './notification-read-state';
import { dailyResponseNotifications, unreadActivityCount, stationNotificationFeed, type StationResponseSummary, type StationNotification } from './station-notification-feed';
import { useLimitedNotifications } from './use-limited-notifications';
export type { StationNotification } from './station-notification-feed';

type NoticeTime = Timestamp | null;
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

function useManagementNotifications() {
  const { user, role, stationId } = useAuth();
  const canManage = !!user && !!stationId && (role === 'admin' || role === 'head');
  const scope = canManage ? `${user!.uid}:${stationId}` : null;
  const storageKey = `hydroscout:notification-reads:${scope}`;
  const [state, setState] = useState<{
    scope: string | null; notifications: StationNotification[]; requests: JoinRequest[]; error: string | null;
    readKeys: string[]; readsReady: boolean;
  }>({ scope: null, notifications: [], requests: [], error: null, readKeys: [], readsReady: false });
  const rawReads = useSyncExternalStore(subscribe, () => scope ? readStorage(storageKey) : '[]', () => '[]');
  const read = new Set([...parseReadNotifications(rawReads), ...(state.scope === scope ? state.readKeys : [])]);
  const readsReady = state.scope === scope && state.readsReady;

  const persistRead = (kind: 'activity' | 'member', item: StationNotification | JoinRequest) => {
    if (!user || !stationId || !scope || !(item.createdAt instanceof Timestamp)) return Promise.resolve();
    return setDoc(doc(db, 'stations', stationId, 'notificationReads', user.uid, 'items', `${kind}_${item.id}`), {
      kind, notificationId: item.id, eventCreatedAt: item.createdAt, readAt: serverTimestamp(),
    }).catch(error => {
      console.warn('Notification read receipt could not sync; using browser read state.', error);
    });
  };

  useEffect(() => {
    if (!scope || !stationId) return;
    let notifications: StationNotification[] = [];
    let responses: StationResponseSummary[] = [];
    let requests: JoinRequest[] = [];
    let error: string | null = null;
    let readKeys: string[] = [];
    let readsReady = false;
    let active = true;
    const publish = () => { if (active) setState({ scope, notifications: stationNotificationFeed(notifications, responses), requests, error, readKeys, readsReady }); };
    const migrated = new Set<string>();
    const syncLocalReads = () => {
      if (!readsReady) return;
      const local = new Set(parseReadNotifications(readStorage(storageKey)));
      for (const [kind, items] of [['activity', notifications], ['member', requests]] as const) {
        for (const item of items) {
          const key = notificationReadKey(kind, item.id, item.createdAt);
          if (!local.has(key) || readKeys.includes(key) || migrated.has(key) || !(item.createdAt instanceof Timestamp)) continue;
          migrated.add(key);
          void setDoc(doc(db, 'stations', stationId, 'notificationReads', user!.uid, 'items', `${kind}_${item.id}`), {
            kind, notificationId: item.id, eventCreatedAt: item.createdAt, readAt: serverTimestamp(),
          }).catch(error => {
            if (active) console.warn('Notification read history could not sync; using browser read state.', error);
          });
        }
      }
    };
    const fail = () => { error = 'Could not load station notifications. Please try again.'; publish(); };
    const stopNotices = onSnapshot(collection(db, 'stations', stationId, 'notifications'), snapshot => {
      notifications = snapshot.docs.map(record => ({ ...record.data(), id: record.id } as StationNotification))
        .sort((a, b) => (b.createdAt?.toDate?.().getTime() ?? 0) - (a.createdAt?.toDate?.().getTime() ?? 0));
      publish();
      syncLocalReads();
    }, fail);
    const stopRequests = onSnapshot(query(collection(db, 'stations', stationId, 'joinRequests'), where('status', '==', 'pending')), snapshot => {
      requests = snapshot.docs.map(record => ({ ...record.data(), id: record.id } as JoinRequest));
      publish();
      syncLocalReads();
    }, fail);
    const stopResponses = onSnapshot(collection(db, 'stations', stationId, 'responses'), snapshot => {
      responses = snapshot.docs.map(record => ({ ...record.data(), id: record.id } as StationResponseSummary));
      publish();
    }, responseError => {
      console.warn('Response details unavailable; using notification event history.', responseError);
    });
    const stopReads = onSnapshot(collection(db, 'stations', stationId, 'notificationReads', user!.uid, 'items'), { includeMetadataChanges: true }, snapshot => {
      readKeys = snapshot.docs.flatMap(record => {
        const data = record.data();
        return (data.kind === 'activity' || data.kind === 'member') && typeof data.notificationId === 'string'
          && data.eventCreatedAt instanceof Timestamp
          ? [notificationReadKey(data.kind, data.notificationId, data.eventCreatedAt)] : [];
      });
      readsReady = !snapshot.metadata.fromCache || !navigator.onLine;
      publish();
      syncLocalReads();
    }, readError => {
      readsReady = true;
      console.warn('Notification read history unavailable; using browser read state.', readError);
      publish();
    });
    return () => { active = false; stopNotices(); stopRequests(); stopResponses(); stopReads(); };
  }, [scope, stationId, storageKey, user]);

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
    isActivityUnread: (item: StationNotification) => readsReady && !read.has(activityKey(item)),
    isMemberUnread: (item: JoinRequest) => readsReady && !read.has(memberKey(item)),
    hasUnreadActivity: readsReady && notifications.some(item => !read.has(activityKey(item))),
    hasUnreadMembers: readsReady && requests.some(item => !read.has(memberKey(item))),
    readActivity: (item: StationNotification) => { markRead(activityKey(item)); void persistRead('activity', item); },
    readMember: (item: JoinRequest) => { markRead(memberKey(item)); void persistRead('member', item); },
  };
}

export function useStationNotifications() {
  const { user, role, accountType, stationId, stationMembershipStatus } = useAuth();
  const fullDetails = role === 'admin' || role === 'head';
  const canApproveMembers = !!user && !!stationId && fullDetails && accountType !== 'station';
  const management = useManagementNotifications();
  const limited = useLimitedNotifications(user && !fullDetails ? `${encodeURIComponent(user.uid)}:${role}:${stationId}:${stationMembershipStatus}` : null);
  const feed = fullDetails ? management : limited;
  const notifications = useMemo(() => dailyResponseNotifications(feed.notifications, stationId), [feed.notifications, stationId]);
  const activityUnreadCount = (item: StationNotification) => unreadActivityCount(item, feed.isActivityUnread);
  const unreadActivities = notifications.reduce((sum, item) => sum + activityUnreadCount(item), 0);
  const unreadMembers = management.requests.filter(item => management.isMemberUnread(item)).length;
  return { ...feed, notifications, fullDetails, activityUnreadCount,
    unreadActivityCount: unreadActivities, unreadMemberCount: canApproveMembers ? unreadMembers : 0,
    hasUnreadMembers: canApproveMembers && unreadMembers > 0,
    hasUnreadActivity: unreadActivities > 0,
    isActivityUnread: (item: StationNotification) => activityUnreadCount(item) > 0,
    readActivity: (item: StationNotification) => { if (!item.responseGroup) feed.readActivity(item); },
    canViewActivity: !!user,
    canApproveMembers,
  };
}
