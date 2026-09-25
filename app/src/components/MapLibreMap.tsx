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
  STATUS_META,
  type Hydrant,
  type HydrantStatus,
} from '../data/hydrants';
import type {
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
}

type HydrantFeatureProperties = {
  id: string;
  status: HydrantStatus;
  icon: string;
  selected: boolean;
  nearRoute: boolean;
  offRoute: boolean;
  hazard: boolean;
};

function iconIdForStatus(status: HydrantStatus) {
  return `hydroscout-hydrant-${status}`;
}

function toFeature(
  hydrant: Hydrant,
  selectedHydrantId: string | null,
  inOtwMode: boolean,
  nearRouteIds?: Set<string> | null,
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
  nearRouteIds?: Set<string> | null,
): GeoJSON.FeatureCollection<GeoJSON.Point, HydrantFeatureProperties> {
  const excludeId = otwHydrant?.id ?? null;
  const inOtwMode = !!otwRoute;

  return {
    type: 'FeatureCollection',
    features: hydrants
      .filter((hydrant) => hydrant.id !== excludeId)
      .map((hydrant) =>
        toFeature(
          hydrant,
          selectedHydrantId,
          inOtwMode,
          nearRouteIds,
        ),
      ),
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
    () =>
      buildHydrantCollection(
        propsRef.current.hydrants,
        propsRef.current.selectedHydrantId,
        propsRef.current.otwHydrant,
        propsRef.current.otwRoute,
        propsRef.current.nearRouteIds,
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
              ['==', ['get', 'offRoute'], true],
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

    const handleStyleLoad = () => {
      void prepareStyle();
    };

    const handleClick = async (
      event: maplibregl.MapMouseEvent,
    ) => {
      const clickableLayers = [
        HYDRANT_LAYER,
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
      addHydrantMode
        ? 'crosshair'
        : '';

    updateHydrantSources();
  }, [
    addHydrantMode,
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

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    map.setStyle(
      isDark
        ? MAP_STYLE_DARK
        : MAP_STYLE_LIGHT,
    );
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
