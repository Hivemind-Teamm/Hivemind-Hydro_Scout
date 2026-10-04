'use client';

import {
  Component,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import dynamic from 'next/dynamic';

import DilimanMap from './DilimanMap';
import StationInfoPanel from './StationInfoPanel';
import { useTheme } from '@/lib/theme-context';
import { useUnitLocations } from '@/lib/use-unit-locations';

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
  const { locations: unitLocations, error: unitLocationError } = useUnitLocations();
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const controllerRef = useRef<MapController | null>(null);
  const handleMapReady = useCallback((controller: MapController) => {
    controllerRef.current = controller;
    onMapReady(controller);
  }, [onMapReady]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedStationId(null);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  const closeStation = () => setSelectedStationId(null);
  const selectStation = (stationId: string) => {
    const location = unitLocations.find(unit => unit.stationId === stationId);
    if (!location) return;
    if (firePinMode) { onFirePin?.(location.lat, location.lng); return; }
    if (addHydrantMode) { onMapClick(location.lat, location.lng); return; }
    onMapBackgroundClick();
    setSelectedStationId(current => current === stationId ? null : stationId);
    if (selectedStationId !== stationId) {
      controllerRef.current?.flyTo(location.lat, location.lng, 16);
    }
  };
  const handleBackgroundClick = () => { closeStation(); onMapBackgroundClick(); };
  const handleHydrantSelect = (hydrant: Hydrant) => { closeStation(); onSelectHydrant(hydrant); };
  const visibleStationId = !addHydrantMode && !firePinMode && unitLocations.some(unit => unit.stationId === selectedStationId)
    ? selectedStationId : null;
  const selectedStation = unitLocations.find(unit => unit.stationId === visibleStationId);

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
            selectedStationId={visibleStationId}
            onSelectStation={selectStation}
            unitLocations={unitLocations}
            hydrants={
              hydrants
            }
            selectedHydrantId={
              selectedHydrantId
            }
            onError={
              onMapboxError
            }
            onMapReady={
              handleMapReady
            }
            onSelectHydrant={
              handleHydrantSelect
            }
            addHydrantMode={
              addHydrantMode
            }
            onMapClick={
              onMapClick
            }
            onMapBackgroundClick={
              handleBackgroundClick
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
            selectedStationId={visibleStationId}
            onSelectStation={selectStation}
            unitLocations={unitLocations}
            hydrants={
              hydrants
            }
            selectedHydrantId={
              selectedHydrantId
            }
            onError={
              onMapboxError
            }
            onMapReady={
              handleMapReady
            }
            onSelectHydrant={
              handleHydrantSelect
            }
            addHydrantMode={
              addHydrantMode
            }
            onMapClick={
              onMapClick
            }
            onMapBackgroundClick={
              handleBackgroundClick
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
      {selectedStation && (
        <StationInfoPanel location={selectedStation} onClose={closeStation}
          onLocate={() => controllerRef.current?.flyTo(selectedStation.lat, selectedStation.lng, 17)} />
      )}
      {unitLocationError && (
        <div role="status" className="absolute bottom-8 left-3 rounded-lg bg-white px-3 py-2 text-xs text-red-700 shadow dark:bg-neutral-900 dark:text-red-300">
          Station locations unavailable. Reload to retry.
        </div>
      )}
    </div>
  );
}

/*
 * Memoized so dashboard updates
 * that do not affect the map
 * skip this subtree.
 */
export default memo(MapView);
