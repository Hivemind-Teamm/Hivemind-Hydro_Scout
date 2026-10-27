import type { Timestamp } from 'firebase/firestore';

export type StationNotification = {
  id: string; uid?: string; displayName?: string; adminEmail?: string;
  targetUid?: string; targetName?: string; message: string; type: string; createdAt?: Timestamp | null;
  responseId?: string;
  limited?: boolean;
  hydrantId?: string;
  lat?: number;
  lng?: number;
  response?: StationResponseSummary;
  responseGroup?: { day: string; entries: StationNotification[]; activeCount: number; peopleCount: number };
};
export type StationResponseSummary = {
  firePinId?: string; incidentLat?: number; incidentLng?: number;
  id: string; uid: string; displayName: string; stationId: string; stationName?: string;
  status: 'active' | 'ended'; startedAt?: Timestamp | null; endedAt?: Timestamp | null;
  endedByUid?: string; endedByName?: string; endReason?: string;
  lastLocationAt?: Timestamp | null;
};
const millis = (value?: Timestamp | null) => value?.toMillis() ?? 0;
const responseTypes = new Set(['response-started', 'response-ended', 'station-response-closed']);

/** One live presentation per response; preserve the source event ID for read receipts. */
export function stationNotificationFeed(events: StationNotification[], responses: StationResponseSummary[]) {
  const responseRecords = new Map(responses.map(response => [response.id, response]));
  const grouped = new Map<string, StationNotification[]>();
  const feed: StationNotification[] = [];
  for (const event of events) {
    if (!event.responseId || !responseTypes.has(event.type)) { feed.push(event); continue; }
    const group = grouped.get(event.responseId) ?? [];
    group.push(event);
    grouped.set(event.responseId, group);
  }
  for (const [responseId, group] of grouped) {
    const start = group.filter(event => event.type === 'response-started').sort((a, b) => millis(a.createdAt) - millis(b.createdAt))[0];
    const ending = group.filter(event => event.type !== 'response-started').sort((a, b) => millis(b.createdAt) - millis(a.createdAt))[0];
    const latest = ending ?? start;
    const record = responseRecords.get(responseId);
    const ended = !!ending || record?.status === 'ended';
    const name = record?.displayName || start?.displayName || latest.displayName || 'Responder';
    const response: StationResponseSummary = {
      id: responseId, uid: record?.uid || start?.uid || latest.uid || '', displayName: name,
      stationId: record?.stationId ?? '', stationName: record?.stationName,
      status: ended ? 'ended' : 'active', startedAt: record?.startedAt ?? start?.createdAt,
      endedAt: record?.endedAt ?? ending?.createdAt,
      endedByUid: record?.endedByUid ?? (ending?.type === 'station-response-closed' ? ending.uid : undefined),
      endedByName: record?.endedByName ?? (ending?.type === 'station-response-closed' ? ending.displayName : undefined),
      endReason: record?.endReason ?? (ending?.type === 'station-response-closed' ? 'station-head' : undefined),
      lastLocationAt: record?.lastLocationAt,
      firePinId: record?.firePinId, incidentLat: record?.incidentLat, incidentLng: record?.incidentLng,
    };
    feed.push({ ...latest, responseId, uid: response.uid, displayName: name, response,
      message: `${name} ${ended ? 'ended' : 'started'} response.` });
  }
  return feed.sort((a, b) => millis(b.response?.endedAt ?? b.createdAt) - millis(a.response?.endedAt ?? a.createdAt));
}

export function stationNotificationCardKey(notification: StationNotification) {
  if (notification.responseGroup) return notification.id;
  return notification.responseId && notification.response ? `response:${notification.responseId}` : `activity:${notification.id}`;
}

const philippineDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Presentation-only grouping: children keep their original event/read identities. */
export function dailyResponseNotifications(feed: StationNotification[], stationId: string | null) {
  const groups = new Map<string, { day: string; entries: StationNotification[] }>();
  const result: StationNotification[] = [];
  for (const item of feed) {
    if (!item.response) { result.push(item); continue; }
    const started = item.response.startedAt ?? item.createdAt;
    // Never invent a calendar day for historical records missing timestamps.
    if (!started) { result.push(item); continue; }
    const day = philippineDay.format(started.toDate());
    const key = `response-day:${item.response.stationId || stationId || 'station'}:${day}`;
    const group = groups.get(key) ?? { day, entries: [] };
    group.entries.push(item);
    groups.set(key, group);
  }
  for (const [id, { day, entries }] of groups) {
    entries.sort((a, b) => millis(a.response?.startedAt ?? a.createdAt) - millis(b.response?.startedAt ?? b.createdAt)
      || a.id.localeCompare(b.id));
    const limited = entries.every(item => item.limited);
    const people = [...new Map(entries.map(item => [item.uid || item.responseId || item.id, item.displayName || item.response?.displayName || 'Responder'])).values()];
    const names = people.length === 1 ? people[0] : people.length === 2 ? `${people[0]} and ${people[1]}` : `${people[0]} and ${people.length - 1} others`;
    const activeCount = entries.filter(item => item.response?.status === 'active').length;
    const action = activeCount === entries.length ? 'started response' : activeCount === 0 ? 'ended response' : 'updated their response status';
    const latest = [...entries].sort((a, b) => millis(b.createdAt) - millis(a.createdAt))[0];
    result.push({ id, type: activeCount > 0 ? 'response-started' : 'response-ended', limited,
      message: limited ? `${entries.length} station ${entries.length === 1 ? 'response' : 'responses'} updated.` : `${names} ${action}.`,
      createdAt: latest.createdAt,
      responseGroup: { day, entries, activeCount, peopleCount: people.length },
    });
  }
  return result.sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
}

export function unreadActivityCount(item: StationNotification, unread: (entry: StationNotification) => boolean): number {
  return item.responseGroup ? item.responseGroup.entries.reduce((sum, entry) => sum + unreadActivityCount(entry, unread), 0) : Number(unread(item));
}

export function responseDuration(response: StationResponseSummary, now: number) {
  const start = response.startedAt?.toMillis();
  const end = response.status === 'ended' ? response.endedAt?.toMillis() : now;
  if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'Not recorded';
  const seconds = Math.floor((end - start) / 1000);
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} hr ${Math.floor(seconds % 3600 / 60)} min`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}
