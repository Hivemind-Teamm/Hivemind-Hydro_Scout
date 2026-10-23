import type { MapUnitLocation } from '@/lib/map-unit-location';
import { FiAlertTriangle, FiMapPin } from 'react-icons/fi';

export default function StationUnitIcon({ location, selected = false, onSelect, crosshair = false }: {
  location: MapUnitLocation;
  selected?: boolean;
  onSelect: () => void;
  crosshair?: boolean;
}) {
  const stationName = location.stationName ?? location.stationId;
  const locationStatus = location.isStale ? 'Stale location' : 'Active response';
  return (
    <div
      onClick={event => event.stopPropagation()}
      style={{ position: 'relative', width: 36, height: 42 }}>
      <button type="button" onClick={onSelect} aria-label={`Show ${locationStatus.toLowerCase()} for station ${stationName}`}
        title={`${locationStatus} · ${stationName}`}
        aria-expanded={selected} className="block rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
        style={{ cursor: crosshair ? 'crosshair' : 'pointer', position: 'relative' }}>
      {selected && <span style={{ position: 'absolute', inset: -5, borderRadius: '50%', border: '2px solid #FED42E', animation: 'route-ring-pulse 2s ease-out infinite', pointerEvents: 'none' }} />}
      <FiMapPin aria-hidden="true" className={`h-9 w-9 drop-shadow-md ${location.isStale ? 'text-amber-700' : 'text-red-600'}`} fill="white" strokeWidth={2.5} />
      {location.isStale && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white shadow">
          <FiAlertTriangle className="h-2.5 w-2.5" />
        </span>
      )}
      <span className={`pointer-events-none absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded px-1 text-[10px] font-semibold shadow ${location.isStale ? 'bg-amber-100 text-amber-900' : 'bg-white/95 text-neutral-800'}`}>
        {location.isStale ? `Stale · ${stationName}` : stationName}
      </span>
      </button>
    </div>
  );
}
