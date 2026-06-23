'use client';

import { useState, useCallback } from 'react';
import Map, { Marker, GeolocateControl } from 'react-map-gl/mapbox';
import type { GeolocateResultEvent } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER } from './hydrantIcon';
import { STATUS_META, type Hydrant } from '../data/hydrants';
import type { MapController, PendingPin } from './MapView';

interface DilimanMapProps {
  hydrants: Hydrant[];
  selectedHydrantId: string | null;
  onLoad?: () => void;
  onError?: (error: unknown) => void;
  onMapReady?: (controller: MapController) => void;
  onSelectHydrant: (hydrant: Hydrant) => void;
  addHydrantMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  pendingPin: PendingPin | null;
}

export default function DilimanMap({ hydrants, selectedHydrantId, onLoad, onError, onMapReady, onSelectHydrant, addHydrantMode, onMapClick, pendingPin }: DilimanMapProps) {
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const handleGeolocate = useCallback((e: GeolocateResultEvent) => {
    setUserLocation({ lat: e.coords.latitude, lng: e.coords.longitude });
    setGeoError(null);
  }, []);

  const handleGeoError = useCallback((e: GeolocationPositionError) => {
    if (e.code === e.PERMISSION_DENIED) {
      setGeoError('Location access denied. Please enable location permissions in your browser.');
    } else if (e.code === e.POSITION_UNAVAILABLE) {
      setGeoError('Location unavailable. Please check your device settings.');
    } else {
      setGeoError('Could not get your location. Please try again.');
    }
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Map
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        initialViewState={{
          longitude: DILIMAN_CENTER.lng,
          latitude: DILIMAN_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        style={{ position: 'absolute', inset: 0, cursor: addHydrantMode ? 'crosshair' : undefined }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        onLoad={(e: { target: { resize: () => void; zoomIn: () => void; zoomOut: () => void; flyTo: (opts: object) => void } }) => {
          e.target.resize();
          onMapReady?.({
            zoomIn: () => e.target.zoomIn(),
            zoomOut: () => e.target.zoomOut(),
            flyTo: (lat, lng, zoom = 17) => e.target.flyTo({ center: [lng, lat], zoom, speed: 1.4 }),
          });
          onLoad?.();
        }}
        onError={(e: unknown) => onError?.(e)}
        onClick={(e: { lngLat: { lat: number; lng: number } }) => {
          if (addHydrantMode) onMapClick(e.lngLat.lat, e.lngLat.lng);
        }}
      >
        <GeolocateControl
          position="bottom-right"
          trackUserLocation={true}
          showUserHeading={true}
          showAccuracyCircle={false}
          positionOptions={{ enableHighAccuracy: true }}
          onGeolocate={handleGeolocate}
          onError={handleGeoError}
        />

        {/* Custom pulsing blue dot for user's live location */}
        {userLocation && (
          <Marker
            longitude={userLocation.lng}
            latitude={userLocation.lat}
            anchor="center"
          >
            <div className="user-location-dot" />
          </Marker>
        )}

        {pendingPin && (
          <Marker longitude={pendingPin.lng} latitude={pendingPin.lat} anchor="center">
            <div style={{ width: 14, height: 14, background: '#FED42E', border: '2.5px solid #91191E', borderRadius: '50%', boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }} />
          </Marker>
        )}
        {hydrants.map((h) => {
          const isSelected = selectedHydrantId === h.id;
          return (
            <Marker key={h.id} longitude={h.lng} latitude={h.lat} anchor="bottom">
              <div
                style={{ position: 'relative', cursor: addHydrantMode ? 'crosshair' : 'pointer' }}
                onClick={() => { if (!addHydrantMode) onSelectHydrant(h); }}
              >
                {isSelected && <div className="hydrant-pulse-ring" />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={STATUS_META[h.status].iconUrl}
                  alt={`${h.name} — ${STATUS_META[h.status].legendLabel}`}
                  title={`${h.name} — ${STATUS_META[h.status].legendLabel}`}
                  width={HYDRANT_ICON_WIDTH}
                  height={HYDRANT_ICON_HEIGHT}
                  style={{
                    width: HYDRANT_ICON_WIDTH,
                    height: HYDRANT_ICON_HEIGHT,
                    objectFit: 'contain',
                    filter: HYDRANT_PIN_FILTER,
                  }}
                />
              </div>
            </Marker>
          );
        })}
      </Map>

      {/* Permission denied / geolocation error message */}
      {geoError && (
        <div style={{
          position: 'absolute',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'white',
          border: '1px solid #fca5a5',
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 13,
          color: '#c00',
          zIndex: 1000,
          maxWidth: 300,
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
          {geoError}
        </div>
      )}
    </div>
  );
}