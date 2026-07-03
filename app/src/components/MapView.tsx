'use client';

import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import DilimanMap from './DilimanMap';
import { DILIMAN_CENTER } from './mapConfig';
import { useTheme } from '@/lib/theme-context';
import type { Hydrant } from '../data/hydrants';

const loadLeafletMap = () => import('./LeafletMap');
const makeLeafletMap = () => dynamic(loadLeafletMap, { ssr: false });

/**
 * Prefetch CARTO basemap tiles around the default viewport so the offline
 * Leaflet fallback has imagery even if the user only ever viewed Mapbox while
 * online. The service worker caches them (tile cache, capped); without a
 * controlling SW there's nothing to cache into, so skip the fetches.
 * Tile math is standard slippy-map; subdomain choice mirrors Leaflet's
 * `(x + y) % subdomains.length` so the URLs match what Leaflet will request.
 */
const TILE_WARM_ZOOMS = [14, 15, 16];
function warmTileCache(isDark: boolean) {
  const style = isDark ? 'dark_all' : 'light_all';
  const r = window.devicePixelRatio > 1 ? '@2x' : '';
  const latRad = (DILIMAN_CENTER.lat * Math.PI) / 180;
  for (const z of TILE_WARM_ZOOMS) {
    const n = 2 ** z;
    const cx = Math.floor(((DILIMAN_CENTER.lng + 180) / 360) * n);
    const cy = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
    );
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        const s = 'abcd'[Math.abs(x + y) % 4];
        fetch(`https://${s}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}${r}.png`, {
          mode: 'no-cors',
        }).catch(() => {});
      }
    }
  }
}

/**
 * Keeps a map render/load failure from taking down the whole dashboard.
 * Covers two cases:
 *  - A transient render throw (e.g. Leaflet projection math at an extreme zoom).
 *  - A `ChunkLoadError` when the lazy map chunk can't be fetched (offline).
 * Instead of Next's full-screen error overlay, it shows a quiet fallback that
 * retries automatically once the connection comes back (and on manual retry).
 */
class MapErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  retry = () => {
    // The parent swaps in a fresh lazy instance (a rejected React.lazy promise
    // is memoized forever, so remounting the same instance would fail again).
    this.setState({ failed: false });
    this.props.onRetry();
  };

  componentDidCatch() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.retry, { once: true });
    }
  }

  componentWillUnmount() {
    if (typeof window !== 'undefined') window.removeEventListener('online', this.retry);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neutral-100 p-6 text-center dark:bg-neutral-900">
          <p className="max-w-xs text-sm text-neutral-500 dark:text-neutral-400">
            The map couldn&apos;t be displayed. It will retry automatically when
            you&apos;re back online.
          </p>
          <button
            onClick={this.retry}
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

  // Warm the Leaflet chunk while online, even when Mapbox is the active
  // provider. The service worker caches it on first fetch, so the offline
  // Mapbox→Leaflet fallback doesn't hit a ChunkLoadError.
  useEffect(() => {
    loadLeafletMap().catch(() => {});
  }, []);

  // Warm basemap tiles for the offline fallback (re-run if the theme flips,
  // since light/dark are different tile sets). Without a controlling SW the
  // fetches would cache nothing — on the very first visit the SW is still
  // installing, so wait for it to claim the page (`clients.claim()` in sw.js
  // fires `controllerchange`).
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    if (sw.controller) {
      warmTileCache(isDark);
      return;
    }
    const onControlled = () => warmTileCache(isDark);
    sw.addEventListener('controllerchange', onControlled, { once: true });
    return () => sw.removeEventListener('controllerchange', onControlled);
  }, [isDark]);

  // A failed lazy load is memoized inside the React.lazy instance, so each
  // retry swaps in a fresh dynamic() component (webpack re-requests a failed
  // chunk on the next import call).
  const [LeafletMap, setLeafletMap] = useState(() => makeLeafletMap());
  const retryLeafletMap = useCallback(() => setLeafletMap(() => makeLeafletMap()), []);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <MapErrorBoundary onRetry={retryLeafletMap}>
      {provider === 'mapbox' ? (
        <DilimanMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onError={onMapboxError} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} pendingPin={pendingPin} is3D={is3D} userLocation={userLocation} otwHydrant={otwHydrant} otwRoute={otwRoute} nearRouteIds={nearRouteIds} initialCenter={initialCenter} initialZoom={initialZoom} isDark={isDark} onMapMove={onMapMove} />
      ) : (
        <LeafletMap hydrants={hydrants} selectedHydrantId={selectedHydrantId} onMapReady={onMapReady} onSelectHydrant={onSelectHydrant} addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} pendingPin={pendingPin} userLocation={userLocation} otwHydrant={otwHydrant} otwRoute={otwRoute} initialCenter={initialCenter} initialZoom={initialZoom} isDark={isDark} onMapMove={onMapMove} />
      )}
      </MapErrorBoundary>
    </div>
  );
}
