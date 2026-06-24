'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
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
      background:linear-gradient(135deg,rgba(254,212,46,0.38) 0%,rgba(254,212,46,0.16) 100%);
      border:1.5px solid rgba(254,212,46,0.55);
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
      box-shadow:0 0 12px rgba(254,212,46,0.35),0 3px 8px rgba(0,0,0,0.4);
      color:#91191E;font-size:13px;font-weight:800;font-family:Arial,sans-serif;
      text-shadow:0 1px 2px rgba(255,255,255,0.4);
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

function MapClickHandler({ addHydrantMode, onMapClick, onMapBackgroundClick }: { addHydrantMode: boolean; onMapClick: (lat: number, lng: number) => void; onMapBackgroundClick: () => void }) {
  const map = useMap();
  useMapEvents({
    click(e) {
      if (addHydrantMode) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      } else {
        onMapBackgroundClick();
      }
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
      setPitch: () => { /* Leaflet does not support pitch */ },
      fitRoute: (coords, padding = 60) => {
        if (!coords.length) return;
        const bounds = L.latLngBounds(coords.map(([lng, lat]) => L.latLng(lat, lng)));
        map.fitBounds(bounds, { padding: [padding, padding] });
      },
      setZoomLimits: (min, max) => {
        map.setMinZoom(min ?? 0);
        map.setMaxZoom(max ?? 22);
      },
      getCenter: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
      getZoom: () => map.getZoom(),
    });
  }, [map, onMapReady]);
  return null;
}

const userLocationIcon = L.divIcon({
  html: `<div style="position:relative;width:36px;height:36px;"><div class="user-location-pulse"></div><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:24px;height:24px;background:#2fbf4f;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,0.4);"></div></div>`,
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

interface LeafletMapProps {
  hydrants: Hydrant[];
  selectedHydrantId: string | null;
  onMapReady?: (controller: MapController) => void;
  onSelectHydrant: (hydrant: Hydrant) => void;
  addHydrantMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onMapBackgroundClick: () => void;
  pendingPin: PendingPin | null;
  userLocation?: { lat: number; lng: number } | null;
  otwHydrant?: Hydrant | null;
  otwRoute?: [number, number][] | null;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
}

export default function LeafletMap({ hydrants, selectedHydrantId, onMapReady, onSelectHydrant, addHydrantMode, onMapClick, onMapBackgroundClick, pendingPin, userLocation, otwHydrant, otwRoute, initialCenter, initialZoom }: LeafletMapProps) {
  return (
    <MapContainer
      center={[initialCenter?.lat ?? DILIMAN_CENTER.lat, initialCenter?.lng ?? DILIMAN_CENTER.lng]}
      zoom={initialZoom ?? DEFAULT_ZOOM}
      zoomControl={false}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />


      {otwHydrant && userLocation && (() => {
        // Use real road route if available (coords are [lng,lat]), else straight line
        const positions: [number, number][] = otwRoute
          ? otwRoute.map(([lng, lat]) => [lat, lng])
          : [[userLocation.lat, userLocation.lng], [otwHydrant.lat, otwHydrant.lng]];
        return (
          <>
            <Polyline positions={positions} pathOptions={{ color: '#DC2626', weight: 16, opacity: 0.18, className: 'otw-route-glow' }} />
            <Polyline positions={positions} pathOptions={{ color: '#F87171', weight: 6, opacity: 0.55 }} />
            <Polyline positions={positions} pathOptions={{ color: '#EF4444', weight: 3, opacity: 1, dashArray: '8 8', className: 'otw-route-line' }} />
          </>
        );
      })()}

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
      {userLocation && (
        <Marker position={[userLocation.lat, userLocation.lng]} icon={userLocationIcon} />
      )}
      <MapClickHandler addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} />
      <ZoomBridge onMapReady={onMapReady} />
    </MapContainer>
  );
}
