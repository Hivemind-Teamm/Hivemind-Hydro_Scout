import type { MapUnitLocation } from '@/lib/map-unit-location';

export default function StationUnitIcon({ location }: { location: MapUnitLocation }) {
  const reported = location.updatedAt === null ? 'Report time unavailable'
    : `Last reported: ${new Date(location.updatedAt).toLocaleString()}`;
  return (
    <div role="img" aria-label={`Station ${location.stationId} unit location. ${reported}`}
      title={`Station ${location.stationId}\n${reported}\nAccuracy: ${Math.round(location.accuracy)} m`}
      onClick={event => event.stopPropagation()}
      className="flex flex-col items-center" style={{ cursor: 'default' }}>
      <span className="rounded-md border border-white bg-red-700 px-2 py-1 text-xs font-bold text-white shadow-md"
        style={{ maxWidth: 180, overflowWrap: 'anywhere', textAlign: 'center' }}>
        {location.stationId}
      </span>
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="16" fill="#dc2626" stroke="white" strokeWidth="2" />
        <path d="M9 15.5L18 9l9 6.5V26H9z" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" />
        <path d="M13 26v-7h10v7M15 18.5v-4h6v4" fill="none" stroke="white" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M16 26v-3h4v3" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </div>
  );
}
