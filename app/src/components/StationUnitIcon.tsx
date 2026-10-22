import type { MapUnitLocation } from '@/lib/map-unit-location';
import { FiMapPin } from 'react-icons/fi';

export default function StationUnitIcon({ location, selected = false, onSelect, crosshair = false }: {
  location: MapUnitLocation;
  selected?: boolean;
  onSelect: () => void;
  crosshair?: boolean;
}) {
  return (
    <div
      onClick={event => event.stopPropagation()}
      style={{ position: 'relative', width: 36, height: 42 }}>
      <button type="button" onClick={onSelect} aria-label={`Show active response location for station ${location.stationName ?? location.stationId}`}
        title={`Active response · ${location.stationName ?? location.stationId}`}
        aria-expanded={selected} className="block rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
        style={{ cursor: crosshair ? 'crosshair' : 'pointer', position: 'relative' }}>
      {selected && <span style={{ position: 'absolute', inset: -5, borderRadius: '50%', border: '2px solid #FED42E', animation: 'route-ring-pulse 2s ease-out infinite', pointerEvents: 'none' }} />}
      <FiMapPin aria-hidden="true" className="h-9 w-9 text-red-600 drop-shadow-md" fill="white" strokeWidth={2.5} />
      <span className="pointer-events-none absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded bg-white/95 px-1 text-[10px] font-semibold text-neutral-800 shadow">
        {location.stationName ?? location.stationId}
      </span>
      </button>
    </div>
  );
}
