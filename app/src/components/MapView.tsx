'use client';

import dynamic from 'next/dynamic';
import DilimanMap from './DilimanMap';
import { useTheme } from '@/lib/theme-context';
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
  getCenter: () => { lat: number; lng: number };
  getZoom: () => number;
  project: (lat: number, lng: number) => { x: number; y: number } | null;
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
  nearRouteIds?: Set<string> | null;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  onMapMove?: () => void;
}

export default function MapView({ provider, hydrants, selectedHydrantId, onMapboxError, onMapReady, onSelectHydrant, addHydrantMode, onMapClick, onMapBackgroundClick, pendingPin, is3D, userLocation, otwHydrant, otwRoute, nearRouteIds, initialCenter, initialZoom, onMapMove }: MapViewProps) {
  const { isDark } = useTheme();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {provider === 'mapbox' ? (
        <DilimanMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onError={onMapboxError} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} pendingPin={pendingPin} is3D={is3D} userLocation={userLocation} otwHydrant={otwHydrant} otwRoute={otwRoute} nearRouteIds={nearRouteIds} initialCenter={initialCenter} initialZoom={initialZoom} isDark={isDark} onMapMove={onMapMove} />
      ) : (
        <LeafletMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} pendingPin={pendingPin} userLocation={userLocation} otwHydrant={otwHydrant} otwRoute={otwRoute} initialCenter={initialCenter} initialZoom={initialZoom} isDark={isDark} onMapMove={onMapMove} />
      )}
    </div>
  );
}
