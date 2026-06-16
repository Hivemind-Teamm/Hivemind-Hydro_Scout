'use client';

import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';

// react-leaflet's default marker icon paths don't resolve correctly through
// Next.js's bundler, so we point explicitly at the CDN-hosted versions instead.
const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function LeafletMap() {
  return (
    <MapContainer
      center={[DILIMAN_CENTER.lat, DILIMAN_CENTER.lng]}
      zoom={DEFAULT_ZOOM}
      style={{
        height: '100%',
        width: '100%',
      }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />
      <Marker position={[DILIMAN_CENTER.lat, DILIMAN_CENTER.lng]} icon={markerIcon} />
    </MapContainer>
  );
}