'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import DilimanMap from './DilimanMap';

// react-leaflet touches `window` on import, so it must be loaded client-side only.
const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false });

type MapProvider = 'mapbox' | 'leaflet';

export default function MapView() {
  const [provider, setProvider] = useState<MapProvider>('mapbox');
  const [autoFallback, setAutoFallback] = useState(false);
  const [userOverride, setUserOverride] = useState(false);

  // Auto-fallback: no Mapbox token configured at all.
  useEffect(() => {
    console.log('Token check:', process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
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
      )}
    </div>
  );
}