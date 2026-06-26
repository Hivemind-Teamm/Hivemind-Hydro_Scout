'use client';

import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER } from './hydrantIcon';
import { STATUS_META, type HydrantStatus } from '../data/hydrants';
import { useTheme } from '@/lib/theme-context';

function makeIcon(status: HydrantStatus) {
  const iconUrl = STATUS_META[status].iconUrl;
  return L.divIcon({
    html: `<img src="${iconUrl}" width="${HYDRANT_ICON_WIDTH}" height="${HYDRANT_ICON_HEIGHT}" style="display:block;width:${HYDRANT_ICON_WIDTH}px;height:${HYDRANT_ICON_HEIGHT}px;object-fit:contain;filter:${HYDRANT_PIN_FILTER};" />`,
    className: '',
    iconSize: [HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT],
    iconAnchor: [HYDRANT_ICON_WIDTH / 2, HYDRANT_ICON_HEIGHT],
  });
}

export default function MiniMap({ lat, lng, status = 'operational' }: { lat: number; lng: number; status?: HydrantStatus }) {
  const { isDark } = useTheme();
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
      {isDark ? (
        <TileLayer key="dark" url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" subdomains="abcd" />
      ) : (
        <TileLayer key="light" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      )}
      <Marker position={[lat, lng]} icon={makeIcon(status)} />
    </MapContainer>
  );
}
