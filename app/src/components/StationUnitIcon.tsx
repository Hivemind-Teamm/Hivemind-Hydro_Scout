import type { MapUnitLocation } from '@/lib/map-unit-location';
import StationLogo from './StationLogo';

export default function StationUnitIcon({ location, selected = false, onSelect, crosshair = false }: {
  location: MapUnitLocation;
  selected?: boolean;
  onSelect: () => void;
  crosshair?: boolean;
}) {
  return (
    <div
      onClick={event => event.stopPropagation()}
      style={{ position: 'relative', width: 36, height: 36 }}>
      <button type="button" onClick={onSelect} aria-label={`Show station ${location.stationId} details`}
        aria-expanded={selected} className="block rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
        style={{ cursor: crosshair ? 'crosshair' : 'pointer', position: 'relative' }}>
      {selected && <span style={{ position: 'absolute', inset: -5, borderRadius: '50%', border: '2px solid #FED42E', animation: 'route-ring-pulse 2s ease-out infinite', pointerEvents: 'none' }} />}
      <StationLogo />
      </button>
    </div>
  );
}
