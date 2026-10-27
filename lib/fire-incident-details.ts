export type FireIncidentDetails = { lat: number; lng: number; status: 'active' | 'cleared'; pinnedAt: number | null };
export function fireIncidentDetails(data: Record<string, unknown>): FireIncidentDetails | null {
  if (typeof data.lat !== 'number' || !Number.isFinite(data.lat) || Math.abs(data.lat) > 90
    || typeof data.lng !== 'number' || !Number.isFinite(data.lng) || Math.abs(data.lng) > 180
    || (data.status !== 'active' && data.status !== 'cleared')) return null;
  const timestamp = data.createdAt as { toMillis?: () => number } | null;
  const pinnedAt = timestamp?.toMillis?.();
  return { lat: data.lat, lng: data.lng, status: data.status, pinnedAt: typeof pinnedAt === 'number' && Number.isFinite(pinnedAt) ? pinnedAt : null };
}
