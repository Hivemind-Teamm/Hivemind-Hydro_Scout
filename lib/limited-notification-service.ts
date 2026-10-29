import { createHash } from 'node:crypto';
import type { Firestore, DocumentData } from 'firebase-admin/firestore';
import { notificationAccess, limitedOperationalNotification } from './notification-access';
import { stationNotificationFeed, type StationNotification, type StationResponseSummary } from './station-notification-feed';
export { verifiedProfile as notificationProfile } from './server-profile';

const token = (source: string, version: number) => createHash('sha256').update(`${source}:${version}`).digest('hex');
const millis = (value: { toMillis?: () => number } | null | undefined) => value?.toMillis?.() ?? 0;

/** All reads are selected from the verified viewer's profile/UID, never request input. */
export async function limitedNotificationFeed(db: Firestore, uid: string, profile: DocumentData) {
  const access = notificationAccess(profile);
  const items: StationNotification[] = [];
  if (access.operational && access.stationId) {
    const events = await db.collection(`stations/${access.stationId}/notifications`).orderBy('createdAt', 'desc').limit(100).get();
    const notices = events.docs.map(record => ({ ...record.data(), id: record.id }) as StationNotification);
    const responseIds = [...new Set(notices.flatMap(item => item.responseId ? [item.responseId] : []))];
    const records = responseIds.length ? await db.getAll(...responseIds.map(id => db.doc(`stationResponses/${id}`))) : [];
    const responses = records.filter(record => record.data()?.stationId === access.stationId)
      .map(record => ({ ...record.data(), id: record.id }) as StationResponseSummary);
    for (const source of stationNotificationFeed(notices, responses)) {
      const item = limitedOperationalNotification(source);
      if (item) items.push({ ...item, id: token(`station:${access.stationId}:${source.id}`, millis(source.createdAt)),
        ...(item.response && source.responseId ? { responseId: token(`response:${access.stationId}:${source.responseId}`, 0) } : {}),
      });
    }
  }
  const [request, reports] = await Promise.all([
    db.doc(`stationJoinRequests/${uid}`).get(),
    db.collectionGroup('reports').where('reporterUid', '==', uid).orderBy('createdAt', 'desc').limit(100).get(),
  ]);
  const membership = request.data();
  if (membership?.uid === uid && ['pending', 'approved', 'rejected'].includes(membership.status)) {
    const createdAt = membership.reviewedAt ?? membership.createdAt;
    items.push({ id: token(`membership:${uid}:${membership.status}`, millis(createdAt)), limited: true,
      type: `membership-${membership.status}`, message: `Your station membership request is ${membership.status}.`, createdAt });
  }
  for (const report of reports.docs) {
    if (report.ref.parent.parent?.parent.id !== 'hydrants') continue;
    const data = report.data();
    if (!['pending', 'resolved', 'denied'].includes(data.status)) continue;
    const createdAt = data.resolvedAt ?? data.createdAt;
    items.push({ id: token(`report:${report.ref.path}:${data.status}`, millis(createdAt)), limited: true,
      type: `report-${data.status}`, message: `Your report for hydrant ${report.ref.parent.parent!.id} is ${data.status}.`,
      hydrantId: report.ref.parent.parent!.id, createdAt });
  }
  return items.sort((a, b) => millis(b.createdAt) - millis(a.createdAt)).slice(0, 100);
}

export function serializeLimitedNotification(item: StationNotification) {
  return { ...item, createdAt: millis(item.createdAt),
    ...(item.response ? { response: { ...item.response, startedAt: millis(item.response.startedAt), endedAt: millis(item.response.endedAt) } } : {}),
  };
}
