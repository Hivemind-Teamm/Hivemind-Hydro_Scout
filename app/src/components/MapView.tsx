'use client';

import { Component, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import DilimanMap from './DilimanMap';
import { useTheme } from '@/lib/theme-context';
import type { Hydrant } from '../data/hydrants';

const LeafletMap = dynamic(() => import('./LeafletMap'), { ssr: false });

/**
 * Keeps a map render/load failure from taking down the whole dashboard.
 * Covers two cases:
 *  - A transient render throw (e.g. Leaflet projection math at an extreme zoom).
 *  - A `ChunkLoadError` when the lazy map chunk can't be fetched (offline).
 * Instead of Next's full-screen error overlay, it shows a quiet fallback with a
 * retry that remounts the map subtree.
 */
class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neutral-100 p-6 text-center dark:bg-neutral-900">
          <p className="max-w-xs text-sm text-neutral-500 dark:text-neutral-400">
            The map couldn&apos;t be displayed. Check your connection and try again.
          </p>
          <button
            onClick={() => {
              // A ChunkLoadError is sticky — the browser caches the failed chunk
              // fetch, so just re-rendering fails again. A full reload re-requests
              // everything (and succeeds once the connection is back).
              if (typeof window !== 'undefined') window.location.reload();
              else this.setState({ failed: false });
            }}
            className="rounded-full bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Reload map
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      <MapErrorBoundary>
      {provider === 'mapbox' ? (
        <DilimanMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onError={onMapboxError} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} pendingPin={pendingPin} is3D={is3D} userLocation={userLocation} otwHydrant={otwHydrant} otwRoute={otwRoute} nearRouteIds={nearRouteIds} initialCenter={initialCenter} initialZoom={initialZoom} isDark={isDark} onMapMove={onMapMove} />
      ) : (
        <LeafletMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} pendingPin={pendingPin} userLocation={userLocation} otwHydrant={otwHydrant} otwRoute={otwRoute} initialCenter={initialCenter} initialZoom={initialZoom} isDark={isDark} onMapMove={onMapMove} />
      )}
      </MapErrorBoundary>
    </div>
  );
}
