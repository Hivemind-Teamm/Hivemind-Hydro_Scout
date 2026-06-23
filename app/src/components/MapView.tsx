'use client';

import dynamic from 'next/dynamic';
import DilimanMap from './DilimanMap';
import type { Hydrant } from '../data/hydrants';

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false });

export type MapProvider = 'mapbox' | 'leaflet';

export interface MapController {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  setPitch: (pitch: number) => void;
  fitRoute: (coords: [number, number][], padding?: number) => void;
  setZoomLimits: (min: number | null, max: number | null) => void;
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
  onMapBackgroundClick: () => void;
  pendingPin: PendingPin | null;
  is3D?: boolean;
  userLocation?: { lat: number; lng: number } | null;
  otwHydrant?: Hydrant | null;
  otwRoute?: [number, number][] | null;
}

export default function MapView({ provider, hydrants, selectedHydrantId, onMapboxError, onMapReady, onSelectHydrant, addHydrantMode, onMapClick, onMapBackgroundClick, pendingPin, is3D, userLocation, otwHydrant, otwRoute }: MapViewProps) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {provider === 'mapbox' ? (
        <DilimanMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onError={onMapboxError} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} pendingPin={pendingPin} is3D={is3D} userLocation={userLocation} otwHydrant={otwHydrant} otwRoute={otwRoute} />
      ) : (
        <LeafletMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} pendingPin={pendingPin} userLocation={userLocation} otwHydrant={otwHydrant} otwRoute={otwRoute} />
      )}
    </div>
  );
}
