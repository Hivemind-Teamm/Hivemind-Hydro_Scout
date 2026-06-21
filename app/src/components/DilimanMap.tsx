'use client';

import Map, { Marker } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER } from './hydrantIcon';
import { STATUS_META, type Hydrant } from '../data/hydrants';
import type { MapController } from './MapView';

interface DilimanMapProps {
  hydrants: Hydrant[];
  selectedHydrantId: string | null;
  onLoad?: () => void;
  onError?: (error: unknown) => void;
  onMapReady?: (controller: MapController) => void;
  onSelectHydrant: (hydrant: Hydrant) => void;
}

export default function DilimanMap({ hydrants, selectedHydrantId, onLoad, onError, onMapReady, onSelectHydrant }: DilimanMapProps) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Map
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        initialViewState={{
          longitude: DILIMAN_CENTER.lng,
          latitude: DILIMAN_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        style={{ position: 'absolute', inset: 0 }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        onLoad={(e: { target: { resize: () => void; zoomIn: () => void; zoomOut: () => void; flyTo: (opts: object) => void } }) => {
          e.target.resize();
          onMapReady?.({
            zoomIn: () => e.target.zoomIn(),
            zoomOut: () => e.target.zoomOut(),
            flyTo: (lat, lng, zoom = 17) => e.target.flyTo({ center: [lng, lat], zoom, speed: 1.4 }),
          });
          onLoad?.();
        }}
        onError={(e: unknown) => onError?.(e)}
      >
        {hydrants.map((h) => {
          const isSelected = selectedHydrantId === h.id;
          return (
            <Marker key={h.id} longitude={h.lng} latitude={h.lat} anchor="bottom">
              <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => onSelectHydrant(h)}>
                {isSelected && <div className="hydrant-pulse-ring" />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={STATUS_META[h.status].iconUrl}
                  alt={`${h.name} — ${STATUS_META[h.status].legendLabel}`}
                  title={`${h.name} — ${STATUS_META[h.status].legendLabel}`}
                  width={HYDRANT_ICON_WIDTH}
                  height={HYDRANT_ICON_HEIGHT}
                  style={{
                    width: HYDRANT_ICON_WIDTH,
                    height: HYDRANT_ICON_HEIGHT,
                    objectFit: 'contain',
                    filter: HYDRANT_PIN_FILTER,
                  }}
                />
              </div>
            </Marker>
          );
        })}
      </Map>
    </div>
  );
}
