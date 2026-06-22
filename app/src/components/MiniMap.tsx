'use client';

import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER } from './hydrantIcon';

const greenIcon = L.divIcon({
  html: `<img src="/Hydrant%20Pin%20Gren.png" width="${HYDRANT_ICON_WIDTH}" height="${HYDRANT_ICON_HEIGHT}" style="display:block;width:${HYDRANT_ICON_WIDTH}px;height:${HYDRANT_ICON_HEIGHT}px;object-fit:contain;filter:${HYDRANT_PIN_FILTER};" />`,
  className: '',
  iconSize: [HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT],
  iconAnchor: [HYDRANT_ICON_WIDTH / 2, HYDRANT_ICON_HEIGHT],
});

export default function MiniMap({ lat, lng }: { lat: number; lng: number }) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={16}
      zoomControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      attributionControl={false}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[lat, lng]} icon={greenIcon} />
    </MapContainer>
  );
}
