'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER } from './hydrantIcon';
import { STATUS_META, type Hydrant } from '../data/hydrants';
import type { MapController } from './MapView';

function hydrantIcon(iconUrl: string, selected: boolean) {
  const pulse = selected
    ? `<div class="hydrant-pulse-ring"></div>`
    : '';
  return L.divIcon({
    html: `<div style="position:relative;">${pulse}<img src="${iconUrl}" width="${HYDRANT_ICON_WIDTH}" height="${HYDRANT_ICON_HEIGHT}" style="display:block;width:${HYDRANT_ICON_WIDTH}px;height:${HYDRANT_ICON_HEIGHT}px;object-fit:contain;filter:${HYDRANT_PIN_FILTER};cursor:pointer;" /></div>`,
    className: '',
    iconSize: [HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT],
    iconAnchor: [HYDRANT_ICON_WIDTH / 2, HYDRANT_ICON_HEIGHT],
  });
}

function ZoomBridge({ onMapReady }: { onMapReady?: (controller: MapController) => void }) {
  const map = useMap();
  useEffect(() => {
    onMapReady?.({
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      flyTo: (lat, lng, zoom = 17) => map.flyTo([lat, lng], zoom, { animate: true, duration: 0.8 }),
    });
  }, [map, onMapReady]);
  return null;
}

interface LeafletMapProps {
  hydrants: Hydrant[];
  selectedHydrantId: string | null;
  onMapReady?: (controller: MapController) => void;
  onSelectHydrant: (hydrant: Hydrant) => void;
}

export default function LeafletMap({ hydrants, selectedHydrantId, onMapReady, onSelectHydrant }: LeafletMapProps) {
  return (
    <MapContainer
      center={[DILIMAN_CENTER.lat, DILIMAN_CENTER.lng]}
      zoom={DEFAULT_ZOOM}
      zoomControl={false}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      {hydrants.map((h) => (
        <Marker
          key={h.id}
          position={[h.lat, h.lng]}
          icon={hydrantIcon(STATUS_META[h.status].iconUrl, selectedHydrantId === h.id)}
          eventHandlers={{ click: () => onSelectHydrant(h) }}
        />
      ))}
      <ZoomBridge onMapReady={onMapReady} />
    </MapContainer>
  );
}
