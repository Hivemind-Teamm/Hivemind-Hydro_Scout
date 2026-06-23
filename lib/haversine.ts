export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(2)}km`;
}

// Minimum distance in metres from a point to a GeoJSON polyline ([lng,lat][] coords).
export function distToRouteM(lat: number, lng: number, route: [number, number][]): number {
  let min = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const [aLng, aLat] = route[i];
    const [bLng, bLat] = route[i + 1];
    const dx = bLng - aLng, dy = bLat - aLat;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((lng - aLng) * dx + (lat - aLat) * dy) / lenSq)) : 0;
    min = Math.min(min, haversineM(lat, lng, aLat + t * dy, aLng + t * dx));
  }
  return min;
}
