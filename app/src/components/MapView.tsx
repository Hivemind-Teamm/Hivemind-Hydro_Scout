'use client';

<<<<<<< HEAD
import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import DilimanMap from './DilimanMap';
import UserStatusBadge from '../components/UserStatusBadge';

// react-leaflet touches `window` on import, so it must be loaded client-side only.
const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false });

type MapProvider = 'mapbox' | 'leaflet';

export default function MapView() {
  const [provider, setProvider] = useState<MapProvider>('mapbox');
  const [autoFallback, setAutoFallback] = useState(false);
  const [userOverride, setUserOverride] = useState(false);

  // Auto-fallback: no Mapbox token configured at all.
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
      setAutoFallback(true);
      setProvider('leaflet');
    }
  }, []);

  // Auto-fallback: Mapbox failed to load/render (bad token, network block, WebGL issue, etc).
  const handleMapboxError = useCallback((error: unknown) => {
    console.warn('Mapbox failed to load, falling back to Leaflet/OSM:', error);
    setAutoFallback(true);
    if (!userOverride) {
      setProvider('leaflet');
    }
  }, [userOverride]);

  const handleToggle = () => {
    setUserOverride(true);
    setProvider((prev) => (prev === 'mapbox' ? 'leaflet' : 'mapbox'));
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <UserStatusBadge />

      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 4,
        }}
      >
        <button
          onClick={handleToggle}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #ccc',
            background: 'white',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {provider === 'mapbox' ? 'Switch to OSM (Leaflet)' : 'Switch to Mapbox'}
        </button>
        {autoFallback && (
          <span style={{ fontSize: 11, color: '#a33', background: 'white', padding: '2px 6px', borderRadius: 4 }}>
            Auto-fallback active (Mapbox unavailable)
          </span>
        )}
      </div>

      {provider === 'mapbox' ? (
        <DilimanMap onError={handleMapboxError} />
      ) : (
        <LeafletMap />
=======
import dynamic from 'next/dynamic';
import DilimanMap from './DilimanMap';
import type { Hydrant } from '../data/hydrants';

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false });

export type MapProvider = 'mapbox' | 'leaflet';

export interface MapController {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
}

export interface PendingPin {
  lat: number;
  lng: number;
}

interface MapViewProps {
  provider: MapProvider;
  hydrants: Hydrant[];
  selectedHydrantId: string | null;
  onMapboxError: (error: unknown) => void;
  onMapReady: (controller: MapController) => void;
  onSelectHydrant: (hydrant: Hydrant) => void;
  addHydrantMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  pendingPin: PendingPin | null;
}

export default function MapView({ provider, hydrants, selectedHydrantId, onMapboxError, onMapReady, onSelectHydrant, addHydrantMode, onMapClick, pendingPin }: MapViewProps) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {provider === 'mapbox' ? (
        <DilimanMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onError={onMapboxError} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} pendingPin={pendingPin} />
      ) : (
        <LeafletMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} pendingPin={pendingPin} />
>>>>>>> origin/initial-landing-page-pr
      )}
    </div>
  );
}
