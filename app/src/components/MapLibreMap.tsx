'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';

import 'maplibre-gl/dist/maplibre-gl.css';

import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';
import {
  HYDRANT_ICON_WIDTH,
  HYDRANT_ICON_HEIGHT,
} from './hydrantIcon';
import {
  FIRE_COLOR,
  SUPPLY_LINE_COLOR,
  FIRE_RADIUS_FILL_OPACITY,
  FIRE_RADIUS_LINE_DASH,
  SUPPLY_LINE_DASH,
  createFirePinElement,
  createSupplyLabelElement,
} from './fireIcon';
import {
  STATUS_META,
  type Hydrant,
  type HydrantStatus,
} from '../data/hydrants';
import { circleRing } from '@/lib/fire-response';
import type {
  FireOverlay,
  MapController,
  PendingPin,
} from './MapView';

if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl(
    '/maplibre/maplibre-gl-worker.mjs',
  );
}

const MAP_STYLE_LIGHT =
  'https://tiles.openfreemap.org/styles/positron';

const MAP_STYLE_DARK =
  'https://tiles.openfreemap.org/styles/dark';

const HYDRANT_SOURCE = 'hydroscout-hydrants';
const OTW_TARGET_SOURCE = 'hydroscout-otw-target';

const CLUSTER_LAYER = 'hydroscout-clusters';
const CLUSTER_COUNT_LAYER = 'hydroscout-cluster-count';
const SELECTED_HALO_LAYER = 'hydroscout-selected-halo';
const HYDRANT_LAYER = 'hydroscout-hydrant-pins';
const HAZARD_LAYER = 'hydroscout-hazards';

const OTW_TARGET_HALO_OUTER = 'hydroscout-otw-halo-outer';
const OTW_TARGET_HALO_INNER = 'hydroscout-otw-halo-inner';
const OTW_TARGET_LAYER = 'hydroscout-otw-pin';

// Fire incident: search radius, hydrant → fire supply line, and the hydrants
// inside the radius (own unclustered source, like the OTW target).
const FIRE_RADIUS_SOURCE = 'hydroscout-fire-radius';
const FIRE_SUPPLY_SOURCE = 'hydroscout-fire-supply';
const FIRE_ZONE_SOURCE = 'hydroscout-fire-zone';

const FIRE_RADIUS_FILL = 'hydroscout-fire-radius-fill';
const FIRE_RADIUS_LINE = 'hydroscout-fire-radius-line';
const FIRE_SUPPLY_GLOW = 'hydroscout-fire-supply-glow';
const FIRE_SUPPLY_LINE = 'hydroscout-fire-supply-line';
const FIRE_ZONE_HALO = 'hydroscout-fire-zone-halo';
const FIRE_ZONE_LAYER = 'hydroscout-fire-zone-pins';
const FIRE_ZONE_HAZARD = 'hydroscout-fire-zone-hazards';

const OTW_ROUTE_SOURCE = 'otw-route';
const OTW_GLOW_LAYER = 'otw-route-glow';
const OTW_BG_LAYER = 'otw-route-bg';
const OTW_LINE_LAYER = 'otw-route-line';

const USER_MARKER_CLASS = 'hydroscout-user-marker';

const HYDRANT_STATUSES = [
  'operational',
  'reduced',
  'out',
] as const satisfies readonly HydrantStatus[];

interface MapLibreMapProps {
  hydrants: Hydrant[];
  selectedHydrantId: string | null;
  onLoad?: () => void;
  onError?: (error: unknown) => void;
  onMapReady?: (controller: MapController) => void;
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
  isDark?: boolean;
  onMapMove?: () => void;
  firePinMode?: boolean;
  fire?: FireOverlay | null;
  onFirePin?: (lat: number, lng: number) => void;
  onFireMove?: (lat: number, lng: number) => void;
}

type HydrantFeatureProperties = {
  id: string;
  status: HydrantStatus;
  icon: string;
  selected: boolean;
  nearRoute: boolean;
  offRoute: boolean;
  offFire: boolean;
  supply: boolean;
  hazard: boolean;
};

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

function iconIdForStatus(status: HydrantStatus) {
  return `hydroscout-hydrant-${status}`;
}

function toFeature(
  hydrant: Hydrant,
  selectedHydrantId: string | null,
  inOtwMode: boolean,
  nearRouteIds?: Set<string> | null,
  fire?: FireOverlay | null,
): GeoJSON.Feature<GeoJSON.Point, HydrantFeatureProperties> {
  const nearRoute = nearRouteIds?.has(hydrant.id) ?? false;

  return {
    type: 'Feature',
    properties: {
      id: hydrant.id,
      status: hydrant.status,
      icon: iconIdForStatus(hydrant.status),
      selected: selectedHydrantId === hydrant.id,
      nearRoute,
      offRoute: inOtwMode && !nearRoute,
      offFire: !!fire && !fire.zoneIds.has(hydrant.id),
      supply: fire?.supply?.hydrantId === hydrant.id,
      hazard: inOtwMode && hydrant.status !== 'operational',
    },
    geometry: {
      type: 'Point',
      coordinates: [hydrant.lng, hydrant.lat],
    },
  };
}

function buildHydrantCollection(
  hydrants: Hydrant[],
  selectedHydrantId: string | null,
  otwHydrant: Hydrant | null | undefined,
  otwRoute: [number, number][] | null | undefined,
  nearRouteIds: Set<string> | null | undefined,
  fire: FireOverlay | null | undefined,
  // true → only the hydrants inside the fire radius (unclustered source);
  // false → everything else (clustered source).
  fireZone: boolean,
): GeoJSON.FeatureCollection<GeoJSON.Point, HydrantFeatureProperties> {
  const excludeId = otwHydrant?.id ?? null;
  const inOtwMode = !!otwRoute;
  const zoneIds = fire?.zoneIds;

  return {
    type: 'FeatureCollection',
    features: hydrants
      .filter(
        (hydrant) =>
          hydrant.id !== excludeId &&
          (zoneIds?.has(hydrant.id) ?? false) === fireZone,
      )
      .map((hydrant) =>
        toFeature(
          hydrant,
          selectedHydrantId,
          inOtwMode,
          nearRouteIds,
          fire,
        ),
      ),
  };
}

function buildFireRadiusCollection(
  fire: FireOverlay | null | undefined,
): GeoJSON.FeatureCollection {
  if (!fire) {
    return EMPTY_COLLECTION;
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            circleRing(
              fire.lat,
              fire.lng,
              fire.radiusM,
            ),
          ],
        },
      },
    ],
  };
}

function buildFireSupplyCollection(
  fire: FireOverlay | null | undefined,
): GeoJSON.FeatureCollection {
  if (!fire?.supply) {
    return EMPTY_COLLECTION;
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [fire.supply.lng, fire.supply.lat],
            [fire.lng, fire.lat],
          ],
        },
      },
    ],
  };
}

function buildTargetCollection(
  otwHydrant: Hydrant | null | undefined,
): GeoJSON.FeatureCollection<GeoJSON.Point, HydrantFeatureProperties> {
  if (!otwHydrant) {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          id: otwHydrant.id,
          status: otwHydrant.status,
          icon: iconIdForStatus(otwHydrant.status),
          selected: false,
          nearRoute: true,
          offRoute: false,
          offFire: false,
          supply: false,
          hazard: otwHydrant.status !== 'operational',
        },
        geometry: {
          type: 'Point',
          coordinates: [otwHydrant.lng, otwHydrant.lat],
        },
      },
    ],
  };
}

async function loadHydrantImages(map: maplibregl.Map) {
  await Promise.all(
    HYDRANT_STATUSES.map(async (status) => {
      const id = iconIdForStatus(status);

      if (map.hasImage(id)) {
        return;
      }

      const response = await map.loadImage(
        STATUS_META[status].iconUrl,
      );

      const sourceImage = response.data;

      const canvas = document.createElement('canvas');
      canvas.width = HYDRANT_ICON_WIDTH;
      canvas.height = HYDRANT_ICON_HEIGHT;

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error(
          `Unable to prepare hydrant icon for ${status}.`,
        );
      }

      context.clearRect(
        0,
        0,
        HYDRANT_ICON_WIDTH,
        HYDRANT_ICON_HEIGHT,
      );

      context.drawImage(
        sourceImage as CanvasImageSource,
        0,
        0,
        HYDRANT_ICON_WIDTH,
        HYDRANT_ICON_HEIGHT,
      );

      const imageData = context.getImageData(
        0,
        0,
        HYDRANT_ICON_WIDTH,
        HYDRANT_ICON_HEIGHT,
      );

      if (!map.hasImage(id)) {
        map.addImage(id, imageData);
      }
    }),
  );
}

function createPendingPinElement() {
  const el = document.createElement('div');

  el.style.width = '14px';
  el.style.height = '14px';
  el.style.background = '#FED42E';
  el.style.border = '2.5px solid #e0353b';
  el.style.borderRadius = '50%';
  el.style.boxShadow =
    '0 2px 8px rgba(0,0,0,0.45)';

  return el;
}

function createUserLocationElement() {
  const root = document.createElement('div');

  root.className = USER_MARKER_CLASS;
  root.style.position = 'relative';
  root.style.width = '36px';
  root.style.height = '36px';

  const pulse = document.createElement('div');
  pulse.className = 'user-location-pulse';

  const dot = document.createElement('div');
  dot.style.position = 'absolute';
  dot.style.top = '50%';
  dot.style.left = '50%';
  dot.style.transform = 'translate(-50%,-50%)';
  dot.style.width = '24px';
  dot.style.height = '24px';
  dot.style.background = '#2fbf4f';
  dot.style.borderRadius = '50%';
  dot.style.border = '3px solid #fff';
  dot.style.boxShadow =
    '0 2px 12px rgba(0,0,0,0.4)';

  root.appendChild(pulse);
  root.appendChild(dot);

  return root;
}

export default function MapLibreMap({
  hydrants,
  selectedHydrantId,
  onLoad,
  onError,
  onMapReady,
  onSelectHydrant,
  addHydrantMode,
  onMapClick,
  onMapBackgroundClick,
  pendingPin,
  is3D = false,
  userLocation,
  otwHydrant,
  otwRoute,
  nearRouteIds,
  initialCenter,
  initialZoom,
  isDark = false,
  onMapMove,
  firePinMode = false,
  fire = null,
  onFirePin,
  onFireMove,
}: MapLibreMapProps) {
  const containerRef =
    useRef<HTMLDivElement | null>(null);

  const mapRef =
    useRef<maplibregl.Map | null>(null);

  const styleReadyRef =
    useRef(false);

  const pendingMarkerRef =
    useRef<maplibregl.Marker | null>(null);

  const userMarkerRef =
    useRef<maplibregl.Marker | null>(null);

  const propsRef = useRef({
    hydrants,
    selectedHydrantId,
    onSelectHydrant,
    addHydrantMode,
    onMapClick,
    onMapBackgroundClick,
    otwHydrant,
    otwRoute,
    nearRouteIds,
    onMapMove,
    firePinMode,
    fire,
    onFirePin,
    onFireMove,
  });

  useEffect(() => {
    propsRef.current = {
      hydrants,
      selectedHydrantId,
      onSelectHydrant,
      addHydrantMode,
      onMapClick,
      onMapBackgroundClick,
      otwHydrant,
      otwRoute,
      nearRouteIds,
      onMapMove,
      firePinMode,
      fire,
      onFirePin,
      onFireMove,
    };
  }, [
    hydrants,
    selectedHydrantId,
    onSelectHydrant,
    addHydrantMode,
    onMapClick,
    onMapBackgroundClick,
    otwHydrant,
    otwRoute,
    nearRouteIds,
    onMapMove,
    firePinMode,
    fire,
    onFirePin,
    onFireMove,
  ]);

  const hydrantById = useMemo(
    () =>
      new Map(
        hydrants.map((hydrant) => [
          hydrant.id,
          hydrant,
        ]),
      ),
    [hydrants],
  );

  const hydrantByIdRef = useRef(hydrantById);

  useEffect(() => {
    hydrantByIdRef.current = hydrantById;
  }, [hydrantById]);

  const getHydrantData = useCallback(
    (fireZone = false) =>
      buildHydrantCollection(
        propsRef.current.hydrants,
        propsRef.current.selectedHydrantId,
        propsRef.current.otwHydrant,
        propsRef.current.otwRoute,
        propsRef.current.nearRouteIds,
        propsRef.current.fire,
        fireZone,
      ),
    [],
  );

  const getTargetData = useCallback(
    () =>
      buildTargetCollection(
        propsRef.current.otwHydrant,
      ),
    [],
  );

  const ensureHydrantLayers =
    useCallback(async () => {
      const map = mapRef.current;

      if (!map || !map.isStyleLoaded()) {
        return;
      }

      await loadHydrantImages(map);

      if (!map.getSource(HYDRANT_SOURCE)) {
        map.addSource(HYDRANT_SOURCE, {
          type: 'geojson',
          data: getHydrantData(),
          cluster: true,
          clusterRadius: 60,
          clusterMaxZoom: 15,
        });
      }

      if (!map.getSource(OTW_TARGET_SOURCE)) {
        map.addSource(OTW_TARGET_SOURCE, {
          type: 'geojson',
          data: getTargetData(),
        });
      }

      if (!map.getLayer(CLUSTER_LAYER)) {
        map.addLayer({
          id: CLUSTER_LAYER,
          type: 'circle',
          source: HYDRANT_SOURCE,
          filter: ['has', 'point_count'],
          paint: {
            'circle-radius': 21,
            'circle-color':
              'rgba(254, 212, 46, 0.28)',
            'circle-stroke-color':
              'rgba(254, 212, 46, 0.72)',
            'circle-stroke-width': 1.5,
          },
        });
      }

      if (!map.getLayer(CLUSTER_COUNT_LAYER)) {
        map.addLayer({
          id: CLUSTER_COUNT_LAYER,
          type: 'symbol',
          source: HYDRANT_SOURCE,
          filter: ['has', 'point_count'],
          layout: {
            'text-field':
              ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 13,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#e0353b',
            'text-halo-color':
              'rgba(255,255,255,0.5)',
            'text-halo-width': 1,
          },
        });
      }

      if (!map.getLayer(SELECTED_HALO_LAYER)) {
        map.addLayer({
          id: SELECTED_HALO_LAYER,
          type: 'circle',
          source: HYDRANT_SOURCE,
          filter: [
            'all',
            ['!', ['has', 'point_count']],
            ['==', ['get', 'selected'], true],
          ],
          paint: {
            'circle-radius': 22,
            'circle-color':
              'rgba(254,212,46,0.10)',
            'circle-stroke-color': '#FED42E',
            'circle-stroke-width': 2,
          },
        });
      }

      if (!map.getLayer(HYDRANT_LAYER)) {
        map.addLayer({
          id: HYDRANT_LAYER,
          type: 'symbol',
          source: HYDRANT_SOURCE,
          filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': 1,
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map',
          },
          paint: {
            'icon-opacity': [
              'case',
              [
                'any',
                ['==', ['get', 'offRoute'], true],
                ['==', ['get', 'offFire'], true],
              ],
              0.25,
              1,
            ],
          },
        });
      }

      if (!map.getLayer(HAZARD_LAYER)) {
        map.addLayer({
          id: HAZARD_LAYER,
          type: 'symbol',
          source: HYDRANT_SOURCE,
          filter: [
            'all',
            ['!', ['has', 'point_count']],
            ['==', ['get', 'hazard'], true],
          ],
          layout: {
            'text-field': '!',
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-offset': [1.25, -2.1],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#ef4444',
            'text-halo-width': 5,
          },
        });
      }

      if (!map.getLayer(OTW_TARGET_HALO_OUTER)) {
        map.addLayer({
          id: OTW_TARGET_HALO_OUTER,
          type: 'circle',
          source: OTW_TARGET_SOURCE,
          paint: {
            'circle-radius': 29,
            'circle-color':
              'rgba(239,68,68,0.06)',
            'circle-stroke-color':
              'rgba(239,68,68,0.35)',
            'circle-stroke-width': 2,
          },
        });
      }

      if (!map.getLayer(OTW_TARGET_HALO_INNER)) {
        map.addLayer({
          id: OTW_TARGET_HALO_INNER,
          type: 'circle',
          source: OTW_TARGET_SOURCE,
          paint: {
            'circle-radius': 22,
            'circle-color':
              'rgba(239,68,68,0.08)',
            'circle-stroke-color': '#ef4444',
            'circle-stroke-width': 2.5,
          },
        });
      }

      if (!map.getLayer(OTW_TARGET_LAYER)) {
        map.addLayer({
          id: OTW_TARGET_LAYER,
          type: 'symbol',
          source: OTW_TARGET_SOURCE,
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': 1,
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map',
          },
        });
      }

      /* ── Fire incident layers ──
         Radius + supply line sit UNDER every hydrant layer; the fire-zone
         pins sit above the clustered pins but under the OTW target, which
         stays topmost. */

      if (!map.getSource(FIRE_RADIUS_SOURCE)) {
        map.addSource(FIRE_RADIUS_SOURCE, {
          type: 'geojson',
          data: buildFireRadiusCollection(
            propsRef.current.fire,
          ),
        });
      }

      if (!map.getSource(FIRE_SUPPLY_SOURCE)) {
        map.addSource(FIRE_SUPPLY_SOURCE, {
          type: 'geojson',
          data: buildFireSupplyCollection(
            propsRef.current.fire,
          ),
        });
      }

      if (!map.getSource(FIRE_ZONE_SOURCE)) {
        map.addSource(FIRE_ZONE_SOURCE, {
          type: 'geojson',
          data: getHydrantData(true),
        });
      }

      if (!map.getLayer(FIRE_RADIUS_FILL)) {
        map.addLayer(
          {
            id: FIRE_RADIUS_FILL,
            type: 'fill',
            source: FIRE_RADIUS_SOURCE,
            paint: {
              'fill-color': FIRE_COLOR,
              'fill-opacity': FIRE_RADIUS_FILL_OPACITY,
            },
          },
          CLUSTER_LAYER,
        );
      }

      if (!map.getLayer(FIRE_RADIUS_LINE)) {
        map.addLayer(
          {
            id: FIRE_RADIUS_LINE,
            type: 'line',
            source: FIRE_RADIUS_SOURCE,
            paint: {
              'line-color': FIRE_COLOR,
              'line-width': 2,
              'line-opacity': 0.85,
              'line-dasharray': FIRE_RADIUS_LINE_DASH,
            },
          },
          CLUSTER_LAYER,
        );
      }

      if (!map.getLayer(FIRE_SUPPLY_GLOW)) {
        map.addLayer(
          {
            id: FIRE_SUPPLY_GLOW,
            type: 'line',
            source: FIRE_SUPPLY_SOURCE,
            layout: { 'line-cap': 'round' },
            paint: {
              'line-color': SUPPLY_LINE_COLOR,
              'line-width': 10,
              'line-opacity': 0.2,
              'line-blur': 4,
            },
          },
          CLUSTER_LAYER,
        );
      }

      if (!map.getLayer(FIRE_SUPPLY_LINE)) {
        map.addLayer(
          {
            id: FIRE_SUPPLY_LINE,
            type: 'line',
            source: FIRE_SUPPLY_SOURCE,
            layout: { 'line-cap': 'round' },
            paint: {
              'line-color': SUPPLY_LINE_COLOR,
              'line-width': 3.5,
              'line-dasharray': SUPPLY_LINE_DASH,
            },
          },
          CLUSTER_LAYER,
        );
      }

      if (!map.getLayer(FIRE_ZONE_HALO)) {
        map.addLayer(
          {
            id: FIRE_ZONE_HALO,
            type: 'circle',
            source: FIRE_ZONE_SOURCE,
            filter: [
              'any',
              ['==', ['get', 'supply'], true],
              ['==', ['get', 'selected'], true],
            ],
            paint: {
              'circle-radius': 22,
              'circle-color': [
                'case',
                ['==', ['get', 'supply'], true],
                'rgba(14,165,233,0.12)',
                'rgba(254,212,46,0.10)',
              ],
              'circle-stroke-color': [
                'case',
                ['==', ['get', 'supply'], true],
                SUPPLY_LINE_COLOR,
                '#FED42E',
              ],
              'circle-stroke-width': 2.5,
            },
          },
          OTW_TARGET_HALO_OUTER,
        );
      }

      if (!map.getLayer(FIRE_ZONE_LAYER)) {
        map.addLayer(
          {
            id: FIRE_ZONE_LAYER,
            type: 'symbol',
            source: FIRE_ZONE_SOURCE,
            layout: {
              'icon-image': ['get', 'icon'],
              'icon-size': 1,
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-rotation-alignment': 'map',
              'icon-pitch-alignment': 'map',
            },
            paint: {
              'icon-opacity': [
                'case',
                ['==', ['get', 'offRoute'], true],
                0.25,
                1,
              ],
            },
          },
          OTW_TARGET_HALO_OUTER,
        );
      }

      if (!map.getLayer(FIRE_ZONE_HAZARD)) {
        map.addLayer(
          {
            id: FIRE_ZONE_HAZARD,
            type: 'symbol',
            source: FIRE_ZONE_SOURCE,
            filter: ['==', ['get', 'hazard'], true],
            layout: {
              'text-field': '!',
              'text-font': ['Noto Sans Regular'],
              'text-size': 12,
              'text-offset': [1.25, -2.1],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            },
            paint: {
              'text-color': '#ffffff',
              'text-halo-color': '#ef4444',
              'text-halo-width': 5,
            },
          },
          OTW_TARGET_HALO_OUTER,
        );
      }
    }, [getHydrantData, getTargetData]);

  const ensureRouteLayers =
    useCallback(() => {
      const map = mapRef.current;

      if (!map || !map.isStyleLoaded()) {
        return;
      }

      if (!map.getSource(OTW_ROUTE_SOURCE)) {
        map.addSource(OTW_ROUTE_SOURCE, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        });
      }

      if (!map.getLayer(OTW_GLOW_LAYER)) {
        map.addLayer({
          id: OTW_GLOW_LAYER,
          type: 'line',
          source: OTW_ROUTE_SOURCE,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#DC2626',
            'line-width': 22,
            'line-opacity': 0.15,
            'line-blur': 8,
          },
        });
      }

      if (!map.getLayer(OTW_BG_LAYER)) {
        map.addLayer({
          id: OTW_BG_LAYER,
          type: 'line',
          source: OTW_ROUTE_SOURCE,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#F87171',
            'line-width': 7,
            'line-opacity': 0.5,
          },
        });
      }

      if (!map.getLayer(OTW_LINE_LAYER)) {
        map.addLayer({
          id: OTW_LINE_LAYER,
          type: 'line',
          source: OTW_ROUTE_SOURCE,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#EF4444',
            'line-width': 3,
            'line-dasharray': [2, 2],
          },
        });
      }
    }, []);

  const updateHydrantSources =
    useCallback(() => {
      const map = mapRef.current;

      if (!map || !styleReadyRef.current) {
        return;
      }

      const source = map.getSource(
        HYDRANT_SOURCE,
      ) as maplibregl.GeoJSONSource | undefined;

      source?.setData(getHydrantData());

      const targetSource = map.getSource(
        OTW_TARGET_SOURCE,
      ) as maplibregl.GeoJSONSource | undefined;

      targetSource?.setData(getTargetData());

      const currentFire = propsRef.current.fire;

      (
        map.getSource(FIRE_ZONE_SOURCE) as
          | maplibregl.GeoJSONSource
          | undefined
      )?.setData(getHydrantData(true));

      (
        map.getSource(FIRE_RADIUS_SOURCE) as
          | maplibregl.GeoJSONSource
          | undefined
      )?.setData(buildFireRadiusCollection(currentFire));

      (
        map.getSource(FIRE_SUPPLY_SOURCE) as
          | maplibregl.GeoJSONSource
          | undefined
      )?.setData(buildFireSupplyCollection(currentFire));

      // Clusters never hold fire-zone hydrants, so they
      // dim with the rest of the map outside the radius.
      const clusterOpacity = currentFire ? 0.35 : 1;

      if (map.getLayer(CLUSTER_LAYER)) {
        map.setPaintProperty(CLUSTER_LAYER, 'circle-opacity', clusterOpacity);
        map.setPaintProperty(CLUSTER_LAYER, 'circle-stroke-opacity', clusterOpacity);
      }

      if (map.getLayer(CLUSTER_COUNT_LAYER)) {
        map.setPaintProperty(CLUSTER_COUNT_LAYER, 'text-opacity', clusterOpacity);
      }
    }, [getHydrantData, getTargetData]);

  const updateRoute = useCallback(() => {
    const map = mapRef.current;

    if (!map || !styleReadyRef.current) {
      return;
    }

    ensureRouteLayers();

    const source = map.getSource(
      OTW_ROUTE_SOURCE,
    ) as maplibregl.GeoJSONSource | undefined;

    if (!source) {
      return;
    }

    const currentOtwHydrant =
      propsRef.current.otwHydrant;

    const currentRoute =
      propsRef.current.otwRoute;

    const coordinates:
      | [number, number][]
      | [] =
      currentOtwHydrant && userLocation
        ? currentRoute ?? [
            [
              userLocation.lng,
              userLocation.lat,
            ],
            [
              currentOtwHydrant.lng,
              currentOtwHydrant.lat,
            ],
          ]
        : [];

    source.setData({
      type: 'FeatureCollection',
      features:
        coordinates.length > 0
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates,
                },
              },
            ]
          : [],
    });

    const visibility =
      currentOtwHydrant ? 'visible' : 'none';

    [
      OTW_GLOW_LAYER,
      OTW_BG_LAYER,
      OTW_LINE_LAYER,
    ].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(
          id,
          'visibility',
          visibility,
        );
      }
    });
  }, [ensureRouteLayers, userLocation]);

  useEffect(() => {
    if (
      !containerRef.current ||
      mapRef.current
    ) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: isDark
        ? MAP_STYLE_DARK
        : MAP_STYLE_LIGHT,
      center: [
        initialCenter?.lng ??
          DILIMAN_CENTER.lng,
        initialCenter?.lat ??
          DILIMAN_CENTER.lat,
      ],
      zoom:
        initialZoom ?? DEFAULT_ZOOM,
      pitch: is3D ? 60 : 0,
      attributionControl: {},
    });

    mapRef.current = map;

    map.setMissingStyleImageResolver((id) => {
      if (map.hasImage(id)) {
        return;
      }

      map.addImage(id, {
        width: 1,
        height: 1,
        data: new Uint8Array([0, 0, 0, 0]),
      });
    });

    const handleError = (
      event: maplibregl.ErrorEvent,
    ) => {
      console.warn(
        'MapLibre map warning:',
        event.error,
      );
      onError?.(event.error);
    };

    const prepareStyle = async () => {
      try {
        styleReadyRef.current = false;

        await ensureHydrantLayers();
        ensureRouteLayers();

        styleReadyRef.current = true;

        updateHydrantSources();
        updateRoute();
      } catch (error) {
        console.error(
          'Failed to prepare Hydro-Scout MapLibre layers:',
          error,
        );
        onError?.(error);
      }
    };

    const handleLoad = async () => {
      await prepareStyle();

      map.resize();

      const controller: MapController = {
        zoomIn: () =>
          map.easeTo({
            zoom: map.getZoom() + 1,
            duration: 500,
          }),

        zoomOut: () =>
          map.easeTo({
            zoom: map.getZoom() - 1,
            duration: 500,
          }),

        flyTo: (lat, lng, zoom = 17) =>
          map.flyTo({
            center: [lng, lat],
            zoom,
            speed: 1.4,
          }),

        setPitch: (pitch) =>
          map.easeTo({
            pitch,
            duration: 500,
          }),

        fitRoute: (coords, padding = 60) => {
          if (!coords.length) {
            return;
          }

          const bounds =
            new maplibregl.LngLatBounds();

          coords.forEach(([lng, lat]) => {
            bounds.extend([lng, lat]);
          });

          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, {
              padding,
              duration: 900,
              maxZoom: 18,
            });
          }
        },

        setZoomLimits: (min, max) => {
          map.setMinZoom(min ?? 0);
          map.setMaxZoom(max ?? 22);
        },

        getCenter: () => {
          const center = map.getCenter();

          return {
            lat: center.lat,
            lng: center.lng,
          };
        },

        getZoom: () => map.getZoom(),

        project: (lat, lng) => {
          try {
            const point = map.project([
              lng,
              lat,
            ]);

            return {
              x: point.x,
              y: point.y,
            };
          } catch {
            return null;
          }
        },
      };

      onMapReady?.(controller);
      onLoad?.();
    };

    // `style.load` fires before the new style's tiles
    // arrive, while isStyleLoaded() — which the layer
    // setup requires — is still false, so rebuild once
    // the map settles. (On first load the `load`
    // handler gets there first; this is then a no-op.)
    const handleStyleLoad = () => {
      map.once('idle', () => {
        void prepareStyle();
      });
    };

    const handleClick = async (
      event: maplibregl.MapMouseEvent,
    ) => {
      // Fire-pin mode: wherever the tap lands — empty map, a pin or a
      // cluster — that is where the fire is.
      if (propsRef.current.firePinMode) {
        propsRef.current.onFirePin?.(
          event.lngLat.lat,
          event.lngLat.lng,
        );
        return;
      }

      const clickableLayers = [
        HYDRANT_LAYER,
        FIRE_ZONE_LAYER,
        OTW_TARGET_LAYER,
        CLUSTER_LAYER,
      ].filter((id) => !!map.getLayer(id));

      const features =
        clickableLayers.length > 0
          ? map.queryRenderedFeatures(
              event.point,
              {
                layers: clickableLayers,
              },
            )
          : [];

      const top = features[0];

      if (top?.layer.id === CLUSTER_LAYER) {
        const clusterId =
          Number(top.properties?.cluster_id);

        const source = map.getSource(
          HYDRANT_SOURCE,
        ) as maplibregl.GeoJSONSource | undefined;

        if (
          source &&
          Number.isFinite(clusterId)
        ) {
          try {
            const zoom =
              await source.getClusterExpansionZoom(
                clusterId,
              );

            const point =
              top.geometry.type === 'Point'
                ? top.geometry.coordinates
                : null;

            if (
              point &&
              typeof point[0] === 'number' &&
              typeof point[1] === 'number'
            ) {
              map.flyTo({
                center: [point[0], point[1]],
                zoom: Math.min(zoom, 18),
                speed: 1.4,
              });
            }
          } catch (error) {
            console.warn(
              'Unable to expand cluster:',
              error,
            );
          }
        }

        return;
      }

      if (
        top?.layer.id === HYDRANT_LAYER ||
        top?.layer.id === FIRE_ZONE_LAYER ||
        top?.layer.id === OTW_TARGET_LAYER
      ) {
        if (
          !propsRef.current.addHydrantMode
        ) {
          const id = String(
            top.properties?.id ?? '',
          );

          const hydrant =
            hydrantByIdRef.current.get(id);

          if (hydrant) {
            propsRef.current.onSelectHydrant(
              hydrant,
            );
          }
        }

        return;
      }

      if (propsRef.current.addHydrantMode) {
        propsRef.current.onMapClick(
          event.lngLat.lat,
          event.lngLat.lng,
        );
      } else {
        propsRef.current.onMapBackgroundClick();
      }
    };

    const handleMove = () => {
      propsRef.current.onMapMove?.();
    };

    map.on('error', handleError);
    map.on('load', handleLoad);
    map.on('style.load', handleStyleLoad);
    map.on('click', handleClick);
    map.on('move', handleMove);

    return () => {
      styleReadyRef.current = false;

      pendingMarkerRef.current?.remove();
      pendingMarkerRef.current = null;

      userMarkerRef.current?.remove();
      userMarkerRef.current = null;

      map.remove();
      mapRef.current = null;
    };

    // Intentionally create the MapLibre instance once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    map.getCanvas().style.cursor =
      addHydrantMode || firePinMode
        ? 'crosshair'
        : '';

    updateHydrantSources();
  }, [
    addHydrantMode,
    firePinMode,
    fire,
    hydrants,
    selectedHydrantId,
    otwHydrant,
    otwRoute,
    nearRouteIds,
    updateHydrantSources,
  ]);

  useEffect(() => {
    updateRoute();
  }, [
    otwHydrant,
    otwRoute,
    userLocation,
    updateRoute,
  ]);

  /*
   * Theme swap. `diff: false` forces a full style
   * reload: the default diffed swap silently strips
   * every source/layer added at runtime (all the
   * hydrant, route and fire layers) and never fires
   * `style.load`, so nothing rebuilt them — every
   * hydrant vanished on a light/dark toggle.
   */
  const appliedStyleRef = useRef(
    isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
  );

  useEffect(() => {
    const map = mapRef.current;
    const style = isDark
      ? MAP_STYLE_DARK
      : MAP_STYLE_LIGHT;

    // The map was created with this style already.
    if (!map || appliedStyleRef.current === style) {
      return;
    }

    appliedStyleRef.current = style;
    map.setStyle(style, { diff: false });
  }, [isDark]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    map.easeTo({
      pitch: is3D ? 60 : 0,
      duration: 500,
    });
  }, [is3D]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !styleReadyRef.current) {
      return;
    }

    pendingMarkerRef.current?.remove();
    pendingMarkerRef.current = null;

    if (!pendingPin) {
      return;
    }

    pendingMarkerRef.current =
      new maplibregl.Marker({
        element: createPendingPinElement(),
        anchor: 'center',
        subpixelPositioning: true,
      })
        .setLngLat([
          pendingPin.lng,
          pendingPin.lat,
        ])
        .addTo(map);

    return () => {
      pendingMarkerRef.current?.remove();
      pendingMarkerRef.current = null;
    };
  }, [pendingPin]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !styleReadyRef.current) {
      return;
    }

    userMarkerRef.current?.remove();
    userMarkerRef.current = null;

    if (!userLocation) {
      return;
    }

    userMarkerRef.current =
      new maplibregl.Marker({
        element: createUserLocationElement(),
        anchor: 'center',
        subpixelPositioning: true,
      })
        .setLngLat([
          userLocation.lng,
          userLocation.lat,
        ])
        .addTo(map);

    return () => {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
    };
  }, [userLocation]);

  /*
   * Fire marker. Unlike the GL layers it doesn't
   * depend on the style, so it only needs the map.
   */
  const fireLat = fire?.lat;
  const fireLng = fire?.lng;

  useEffect(() => {
    const map = mapRef.current;

    if (
      !map ||
      fireLat === undefined ||
      fireLng === undefined
    ) {
      return;
    }

    const element = createFirePinElement();

    // Don't let a tap on the pin read as a
    // background tap (which closes panels).
    element.addEventListener('click', (e) =>
      e.stopPropagation(),
    );

    const marker = new maplibregl.Marker({
      element,
      anchor: 'center',
      draggable: true,
      subpixelPositioning: true,
    })
      .setLngLat([fireLng, fireLat])
      .addTo(map);

    marker.on('dragend', () => {
      const { lat, lng } = marker.getLngLat();
      propsRef.current.onFireMove?.(lat, lng);
    });

    return () => {
      marker.remove();
    };
  }, [fireLat, fireLng]);

  /* Distance pill at the supply line's midpoint. */
  const supplyLat = fire?.supply?.lat;
  const supplyLng = fire?.supply?.lng;
  const supplyLabel = fire?.supply?.label;

  useEffect(() => {
    const map = mapRef.current;

    if (
      !map ||
      fireLat === undefined ||
      fireLng === undefined ||
      supplyLat === undefined ||
      supplyLng === undefined ||
      supplyLabel === undefined
    ) {
      return;
    }

    const marker = new maplibregl.Marker({
      element:
        createSupplyLabelElement(supplyLabel),
      anchor: 'center',
      subpixelPositioning: true,
    })
      .setLngLat([
        (supplyLng + fireLng) / 2,
        (supplyLat + fireLat) / 2,
      ])
      .addTo(map);

    return () => {
      marker.remove();
    };
  }, [
    fireLat,
    fireLng,
    supplyLat,
    supplyLng,
    supplyLabel,
  ]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{
        position: 'absolute',
        inset: 0,
      }}
    />
  );
}
