'use client';

import Map, { Marker } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';

interface DilimanMapProps {
  onLoad?: () => void;
  onError?: (error: unknown) => void;
}

export default function DilimanMap({ onLoad, onError }: DilimanMapProps) {
  console.log('Viewport values:', DILIMAN_CENTER.lng, DILIMAN_CENTER.lat, DEFAULT_ZOOM, typeof DILIMAN_CENTER.lng, typeof DILIMAN_CENTER.lat, typeof DEFAULT_ZOOM);

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
        onLoad={(e: any) => {
          e.target.resize();
          onLoad?.();
        }}
        onError={(e: unknown) => onError?.(e)}
      >
        <Marker longitude={DILIMAN_CENTER.lng} latitude={DILIMAN_CENTER.lat} />
      </Map>
    </div>
  );
}