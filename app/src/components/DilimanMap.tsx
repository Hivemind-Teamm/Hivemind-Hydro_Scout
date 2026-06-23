'use client';

import { useRef } from 'react';
import Map, { Marker, GeolocateControl, MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';

interface DilimanMapProps {
  onLoad?: () => void;
  onError?: (error: unknown) => void;
}

export default function DilimanMap({ onLoad, onError }: DilimanMapProps) {
  const mapRef = useRef<MapRef>(null);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Map
        ref={mapRef}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        initialViewState={{
          longitude: DILIMAN_CENTER.lng,
          latitude: DILIMAN_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        style={{ position: 'absolute', inset: 0 }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        onLoad={(e) => {
          e.target.resize();
          onLoad?.();
        }}
        onError={(e: unknown) => onError?.(e)}
      >
        <Marker longitude={DILIMAN_CENTER.lng} latitude={DILIMAN_CENTER.lat} />

        {/*
          Built-in Mapbox geolocate button (bottom-right by default).
          trackUserLocation: true means it uses watchPosition (continuous
          live updates) once the user clicks it, rather than a one-time fix.
          It stops watching automatically if the user clicks it again or
          navigates away, so it's opt-in rather than running on page load.
        */}
        TEMP DISABLED FOR TESTING
        <GeolocateControl
          position="bottom-right"
          trackUserLocation={true}
          showUserHeading={true}
          showAccuracyCircle={true}
          positionOptions={{ enableHighAccuracy: true }}
          onError={(e) => {
            console.warn('Geolocation error:', e);
          }}
        />
        
      </Map>
    </div>
  );
}
