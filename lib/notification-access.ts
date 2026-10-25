import type { StationNotification } from './station-notification-feed';

export function notificationAccess(profile: {
  accountType?: unknown; role?: unknown; stationId?: unknown; stationMembershipStatus?: unknown;
}) {
  const stationId = typeof profile.stationId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(profile.stationId) ? profile.stationId : null;
  const full = profile.accountType === 'station' || profile.role === 'head' || profile.role === 'admin';
  const operational = !!stationId && (full || (profile.accountType === 'person'
    && profile.role === 'authorized' && profile.stationMembershipStatus === 'approved'));
  return { stationId, full, operational };
}

const operationalTypes = new Set(['hydrant-pinned', 'hydrant-updated', 'fire-pinned', 'response-started', 'response-ended', 'station-response-closed']);

/** Explicit allowlist: never serialize the source object or its free-text message. */
export function limitedOperationalNotification(item: StationNotification): StationNotification | null {
  if (!operationalTypes.has(item.type)) return null;
  const messages: Record<string, string> = {
    'hydrant-pinned': 'A hydrant was pinned.', 'hydrant-updated': 'Hydrant information was updated.',
    'fire-pinned': 'A fire incident was pinned.', 'response-started': 'A station unit started response.',
    'response-ended': 'A station unit ended response.', 'station-response-closed': 'A station unit ended response.',
  };
  return {
    id: item.id, type: item.type,
    message: item.response ? `A station unit ${item.response.status === 'active' ? 'started' : 'ended'} response.` : messages[item.type],
    createdAt: item.createdAt, limited: true,
    ...(item.hydrantId ? { hydrantId: item.hydrantId } : {}),
    ...(typeof item.lat === 'number' && typeof item.lng === 'number' ? { lat: item.lat, lng: item.lng } : {}),
    ...(item.response ? {
      response: { id: '', uid: '', displayName: '', stationId: '', status: item.response.status,
        incidentLat: item.response.incidentLat, incidentLng: item.response.incidentLng,
        startedAt: item.response.startedAt, endedAt: item.response.endedAt },
    } : {}),
  };
}
