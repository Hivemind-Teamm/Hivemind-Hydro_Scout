'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER } from './hydrantIcon';
import { STATUS_META, type Hydrant } from '../data/hydrants';
import type { MapController, PendingPin } from './MapView';

function hydrantIcon(iconUrl: string, selected: boolean) {
  const pulse = selected ? `<div class="hydrant-pulse-ring"></div>` : '';
  return L.divIcon({
    html: `<div style="position:relative;">${pulse}<img src="${iconUrl}" width="${HYDRANT_ICON_WIDTH}" height="${HYDRANT_ICON_HEIGHT}" style="display:block;width:${HYDRANT_ICON_WIDTH}px;height:${HYDRANT_ICON_HEIGHT}px;object-fit:contain;filter:${HYDRANT_PIN_FILTER};cursor:pointer;" /></div>`,
    className: '',
    iconSize: [HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT],
    iconAnchor: [HYDRANT_ICON_WIDTH / 2, HYDRANT_ICON_HEIGHT],
  });
}

function createClusterIcon(cluster: { getChildCount: () => number }) {
  const count = cluster.getChildCount();
  return L.divIcon({
    html: `<div style="
      width:42px;height:42px;
      background:#FED42E;
      border:3px solid #91191E;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 3px 10px rgba(0,0,0,0.45);
      color:#91191E;font-size:13px;font-weight:800;font-family:Arial,sans-serif;
    ">${count}</div>`,
    className: '',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

const pendingPinIcon = L.divIcon({
  html: `<div style="width:14px;height:14px;background:#FED42E;border:2.5px solid #91191E;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.45)"></div>`,
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function MapClickHandler({ addHydrantMode, onMapClick }: { addHydrantMode: boolean; onMapClick: (lat: number, lng: number) => void }) {
  const map = useMap();
  useMapEvents({
    click(e) {
      if (addHydrantMode) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  useEffect(() => {
    map.getContainer().style.cursor = addHydrantMode ? 'crosshair' : '';
  }, [map, addHydrantMode]);
  return null;
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
  addHydrantMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  pendingPin: PendingPin | null;
}

export default function LeafletMap({ hydrants, selectedHydrantId, onMapReady, onSelectHydrant, addHydrantMode, onMapClick, pendingPin }: LeafletMapProps) {
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
      <MarkerClusterGroup
        chunkedLoading
        iconCreateFunction={createClusterIcon}
        maxClusterRadius={60}
        disableClusteringAtZoom={16}
        showCoverageOnHover={false}
        spiderfyOnMaxZoom
      >
        {hydrants.map((h) => (
          <Marker
            key={h.id}
            position={[h.lat, h.lng]}
            icon={hydrantIcon(STATUS_META[h.status].iconUrl, selectedHydrantId === h.id)}
            eventHandlers={{ click: () => { if (!addHydrantMode) onSelectHydrant(h); } }}
          />
        ))}
      </MarkerClusterGroup>
      {pendingPin && (
        <Marker position={[pendingPin.lat, pendingPin.lng]} icon={pendingPinIcon} />
      )}
      <MapClickHandler addHydrantMode={addHydrantMode} onMapClick={onMapClick} />
      <ZoomBridge onMapReady={onMapReady} />
    </MapContainer>
  );
}
