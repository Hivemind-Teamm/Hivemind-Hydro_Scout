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
      )}
    </div>
  );
}
