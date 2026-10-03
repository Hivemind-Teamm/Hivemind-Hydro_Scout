'use client';

import {
  Component,
  memo,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import dynamic from 'next/dynamic';

import DilimanMap from './DilimanMap';
import { useTheme } from '@/lib/theme-context';

import type { Hydrant } from '../data/hydrants';

/* -------------------------------------------------------------------------- */
/* MapLibre lazy loading                                                      */
/* -------------------------------------------------------------------------- */

const loadMapLibreMap = () =>
  import('./MapLibreMap');

const makeMapLibreMap = () =>
  dynamic(loadMapLibreMap, {
    ssr: false,

    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
        Loading map...
      </div>
    ),
  });

/* -------------------------------------------------------------------------- */
/* Error boundary                                                             */
/* -------------------------------------------------------------------------- */

class MapErrorBoundary extends Component<
  {
    children: ReactNode;
    onRetry: () => void;
  },
  {
    failed: boolean;
  }
> {
  state = {
    failed: false,
  };

  static getDerivedStateFromError() {
    return {
      failed: true,
    };
  }

  retry = () => {
    this.setState({
      failed: false,
    });

    this.props.onRetry();
  };

  componentDidCatch(error: unknown) {
    console.error(
      'Map rendering error:',
      error
    );

    if (
      typeof window !== 'undefined'
    ) {
      window.addEventListener(
        'online',
        this.retry,
        {
          once: true,
        }
      );
    }
  }

  componentWillUnmount() {
    if (
      typeof window !== 'undefined'
    ) {
      window.removeEventListener(
        'online',
        this.retry
      );
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neutral-100 p-6 text-center dark:bg-neutral-900">
          <p className="max-w-xs text-sm text-neutral-500 dark:text-neutral-400">
            The map couldn&apos;t be
            displayed. It will retry
            automatically when you&apos;re
            back online.
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

/* -------------------------------------------------------------------------- */
/* Shared types                                                               */
/* -------------------------------------------------------------------------- */

export type MapProvider =
  | 'mapbox'
  | 'maplibre';

export interface MapController {
  zoomIn: () => void;

  zoomOut: () => void;

  flyTo: (
    lat: number,
    lng: number,
    zoom?: number
  ) => void;

  setPitch: (
    pitch: number
  ) => void;

  fitRoute: (
    coords: [number, number][],
    padding?: number | MapPadding
  ) => void;

  setZoomLimits: (
    min: number | null,
    max: number | null
  ) => void;

  getCenter: () => {
    lat: number;
    lng: number;
  };

  getZoom: () => number;

  project: (
    lat: number,
    lng: number
  ) => {
    x: number;
    y: number;
  } | null;
}

/* Per-side camera padding, in pixels. */
export interface MapPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PendingPin {
  lat: number;
  lng: number;
}

/*
 * Pinned fire incident as the map renders it: the
 * fire marker, its hydrant search radius, and the
 * supply line from the chosen hydrant to the fire.
 */
export interface FireOverlay {
  lat: number;
  lng: number;

  radiusM: number;

  /*
   * Hydrants inside the radius. They are never
   * clustered and never dimmed; everything else
   * is dimmed while a fire is pinned.
   */
  zoneIds: Set<string>;

  supply: {
    hydrantId: string;
    lat: number;
    lng: number;
    label: string;
  } | null;
}

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

interface MapViewProps {
  provider: MapProvider;

  hydrants: Hydrant[];

  aorBarangays: string[];

  selectedHydrantId:
    | string
    | null;

  onMapboxError: (
    error: unknown
  ) => void;

  onMapReady: (
    controller: MapController
  ) => void;

  onSelectHydrant: (
    hydrant: Hydrant
  ) => void;

  addHydrantMode: boolean;

  onMapClick: (
    lat: number,
    lng: number
  ) => void;

  onMapBackgroundClick: () => void;

  pendingPin:
    | PendingPin
    | null;

  is3D?: boolean;

  userLocation?: {
    lat: number;
    lng: number;
  } | null;

  otwHydrant?:
    | Hydrant
    | null;

  otwRoute?:
    | [number, number][]
    | null;

  nearRouteIds?:
    | Set<string>
    | null;

  initialCenter?: {
    lat: number;
    lng: number;
  };

  initialZoom?: number;

  onMapMove?: () => void;

  /*
   * Fire-pin mode: the next map tap places the
   * fire instead of selecting/adding hydrants.
   */
  firePinMode?: boolean;

  fire?:
    | FireOverlay
    | null;

  onFirePin?: (
    lat: number,
    lng: number
  ) => void;

  /* Fire marker dragged to a new spot. */
  onFireMove?: (
    lat: number,
    lng: number
  ) => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

function MapView({
  provider,

  hydrants,

  aorBarangays,

  selectedHydrantId,

  onMapboxError,

  onMapReady,

  onSelectHydrant,

  addHydrantMode,

  onMapClick,

  onMapBackgroundClick,

  pendingPin,

  is3D,

  userLocation,

  otwHydrant,

  otwRoute,

  nearRouteIds,

  initialCenter,

  initialZoom,

  onMapMove,

  firePinMode = false,

  fire = null,

  onFirePin,

  onFireMove,
}: MapViewProps) {
  const { isDark } = useTheme();

  /*
   * Preload the MapLibre chunk.
   *
   * This replaces the old Leaflet preloading.
   * No CARTO tile warming is needed anymore.
   */
  useEffect(() => {
    loadMapLibreMap().catch(
      (error) => {
        console.warn(
          'Unable to preload MapLibre:',
          error
        );
      }
    );
  }, []);

  /*
   * If the lazy chunk fails once,
   * create a fresh dynamic component
   * when retrying.
   */
  const [
    MapLibreMap,
    setMapLibreMap,
  ] = useState(
    () => makeMapLibreMap()
  );

  const retryMapLibreMap =
    useCallback(() => {
      setMapLibreMap(
        () => makeMapLibreMap()
      );
    }, []);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
      }}
    >
      <MapErrorBoundary
        onRetry={
          retryMapLibreMap
        }
      >
        {provider === 'mapbox' ? (
          <DilimanMap
            hydrants={
              hydrants
            }
            aorBarangays={
              aorBarangays
            }
            selectedHydrantId={
              selectedHydrantId
            }
            onError={
              onMapboxError
            }
            onMapReady={
              onMapReady
            }
            onSelectHydrant={
              onSelectHydrant
            }
            addHydrantMode={
              addHydrantMode
            }
            onMapClick={
              onMapClick
            }
            onMapBackgroundClick={
              onMapBackgroundClick
            }
            pendingPin={
              pendingPin
            }
            is3D={
              is3D
            }
            userLocation={
              userLocation
            }
            otwHydrant={
              otwHydrant
            }
            otwRoute={
              otwRoute
            }
            nearRouteIds={
              nearRouteIds
            }
            initialCenter={
              initialCenter
            }
            initialZoom={
              initialZoom
            }
            isDark={
              isDark
            }
            onMapMove={
              onMapMove
            }
            firePinMode={
              firePinMode
            }
            fire={
              fire
            }
            onFirePin={
              onFirePin
            }
            onFireMove={
              onFireMove
            }
          />
        ) : (
          <MapLibreMap
            hydrants={
              hydrants
            }
            aorBarangays={
              aorBarangays
            }
            selectedHydrantId={
              selectedHydrantId
            }
            onError={
              onMapboxError
            }
            onMapReady={
              onMapReady
            }
            onSelectHydrant={
              onSelectHydrant
            }
            addHydrantMode={
              addHydrantMode
            }
            onMapClick={
              onMapClick
            }
            onMapBackgroundClick={
              onMapBackgroundClick
            }
            pendingPin={
              pendingPin
            }
            is3D={
              is3D
            }
            userLocation={
              userLocation
            }
            otwHydrant={
              otwHydrant
            }
            otwRoute={
              otwRoute
            }
            nearRouteIds={
              nearRouteIds
            }
            initialCenter={
              initialCenter
            }
            initialZoom={
              initialZoom
            }
            isDark={
              isDark
            }
            onMapMove={
              onMapMove
            }
            firePinMode={
              firePinMode
            }
            fire={
              fire
            }
            onFirePin={
              onFirePin
            }
            onFireMove={
              onFireMove
            }
          />
        )}
      </MapErrorBoundary>
    </div>
  );
}

/*
 * Memoized so dashboard updates
 * that do not affect the map
 * skip this subtree.
 */
export default memo(MapView);