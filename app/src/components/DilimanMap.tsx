'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, { Marker, Layer, type MapRef, type MarkerEvent } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import Supercluster from 'supercluster';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER } from './hydrantIcon';
import { STATUS_META, type Hydrant, type HydrantStatus } from '../data/hydrants';
import type { MapController, PendingPin } from './MapView';

// Match Leaflet config exactly: maxClusterRadius=60, disableClusteringAtZoom=16.
// Supercluster's `maxZoom` is the last zoom at which points still cluster, so
// `maxZoom=15` means everything de-clusters at zoom 16 — identical to Leaflet's
// `disableClusteringAtZoom={16}`.
const CLUSTER_RADIUS = 60;
const CLUSTER_MAX_ZOOM = 15;

// Whole-world bbox so we cluster every hydrant regardless of viewport — Leaflet
// clusters all markers too, not just the ones currently on screen.
const WORLD_BBOX: [number, number, number, number] = [-180, -85, 180, 85];

// Leaflet runs at integer zoom (zoomSnap=1), so its clusters always match the
// on-screen scale. Mapbox zoom is continuous, so we round (not floor) to the
// nearest integer level: flooring would keep pins clustered as if at the lower
// zoom for the whole band (e.g. still clustered at 15.9), making them break out
// far too late. Rounding makes them split at ~the half-zoom — the same scale
// Leaflet would have snapped to.
const clusterLevel = (zoom: number) => Math.round(zoom);

// How long a pin takes to slide between its real position and the cluster
// centre. Mirrors Leaflet.markercluster's zoom-animation feel.
const PIN_GLIDE = '0.35s cubic-bezier(0.4, 0, 0.2, 1)';


type HydrantProps = { hydrantId: string; status: HydrantStatus };

interface ClusterMarker {
  id: number;
  lng: number;
  lat: number;
  count: number;
}

// For each hydrant: the centroid of the cluster it belongs to at the current
// zoom, or null when it stands on its own.
type HydrantPlacement = Map<string, { lng: number; lat: number } | null>;

interface ClusterLayout {
  clusters: ClusterMarker[];
  placement: HydrantPlacement;
}

interface DilimanMapProps {
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
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  isDark?: boolean;
}

const MAP_STYLE_LIGHT = 'mapbox://styles/mapbox/streets-v12';
const MAP_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';

const OTW_SOURCE = 'otw-route';
const OTW_GLOW_LAYER = 'otw-route-glow';
const OTW_BG_LAYER = 'otw-route-bg';
const OTW_LINE_LAYER = 'otw-route-line';
const OTW_LAYERS = [OTW_GLOW_LAYER, OTW_BG_LAYER, OTW_LINE_LAYER];

const DASH_SEQUENCE = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5],
  [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 3, 3],
];

export default function DilimanMap({
  hydrants, selectedHydrantId, onLoad, onError, onMapReady,
  onSelectHydrant, addHydrantMode, onMapClick, onMapBackgroundClick, pendingPin, is3D = false, userLocation, otwHydrant, otwRoute, initialCenter, initialZoom, isDark = false,
}: DilimanMapProps) {
  const mapRef = useRef<MapRef>(null);
  const otwAnimRef = useRef<number | null>(null);
  // Bumped on every Mapbox `style.load`. Switching basemap style (light↔dark)
  // tears down imperatively-added sources/layers, so the OTW setup effects key
  // off this to re-add the route source + layers after a style swap.
  const [styleEpoch, setStyleEpoch] = useState(0);
  // The live mapbox instance, held in state (not just the ref) so render can
  // call `project()` for pixel offsets without reading a ref during render.
  const [mapInstance, setMapInstance] = useState<ReturnType<MapRef['getMap']> | null>(null);
  // Floored map zoom — clustering only changes when this crosses an integer, so
  // we recompute the layout per zoom level instead of on every fractional frame.
  const [clusterZoom, setClusterZoom] = useState(clusterLevel(DEFAULT_ZOOM));

  // Rebuild the Supercluster index whenever the hydrant set changes.
  const supercluster = useMemo(() => {
    const index = new Supercluster<HydrantProps>({
      radius: CLUSTER_RADIUS,
      maxZoom: CLUSTER_MAX_ZOOM,
    });
    index.load(
      hydrants.map((h) => ({
        type: 'Feature' as const,
        properties: { hydrantId: h.id, status: h.status },
        geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] },
      })),
    );
    return index;
  }, [hydrants]);

  // Resolve, for the current zoom, which hydrants are clustered (and into which
  // centroid) and which clusters to draw. Pure function of index + zoom.
  const layout = useMemo<ClusterLayout>(() => {
    const clusters: ClusterMarker[] = [];
    const placement: HydrantPlacement = new Map();

    for (const feature of supercluster.getClusters(WORLD_BBOX, clusterZoom)) {
      const [lng, lat] = feature.geometry.coordinates;
      if ('cluster' in feature.properties && feature.properties.cluster) {
        const clusterId = feature.properties.cluster_id;
        clusters.push({ id: clusterId, lng, lat, count: feature.properties.point_count });
        for (const leaf of supercluster.getLeaves(clusterId, Infinity)) {
          placement.set(leaf.properties.hydrantId, { lng, lat });
        }
      } else {
        placement.set(feature.properties.hydrantId, null);
      }
    }
    return { clusters, placement };
  }, [supercluster, clusterZoom]);

  // Keep `clusterZoom` in step with the camera. We update only when the floored
  // zoom actually changes, so panning never triggers a re-cluster.
  useEffect(() => {
    if (!mapInstance) return;
    const sync = () => {
      const next = clusterLevel(mapInstance.getZoom());
      setClusterZoom((prev) => (prev === next ? prev : next));
    };
    sync();
    mapInstance.on('zoom', sync);
    return () => { if (mapInstance.loaded()) mapInstance.off('zoom', sync); };
  }, [mapInstance]);

  // Keep the crosshair cursor in sync with add-hydrant mode.
  useEffect(() => {
    if (!mapInstance) return;
    mapInstance.getCanvas().style.cursor = addHydrantMode ? 'crosshair' : '';
  }, [addHydrantMode, mapInstance]);

  // A new basemap style (theme toggle) wipes custom sources/layers; bump the
  // epoch so the OTW setup effects below re-add them once the style is ready.
  useEffect(() => {
    if (!mapInstance) return;
    const onStyleLoad = () => setStyleEpoch((e) => e + 1);
    mapInstance.on('style.load', onStyleLoad);
    return () => { if (mapInstance.loaded()) mapInstance.off('style.load', onStyleLoad); };
  }, [mapInstance]);

  // Shift+drag to rotate. We disable box-zoom (the default shift+drag action)
  // and replace it with bearing control. A ref keeps the cursor restoration
  // correct without recreating the listeners every time addHydrantMode changes.
  const addHydrantModeRef = useRef(addHydrantMode);
  useEffect(() => { addHydrantModeRef.current = addHydrantMode; }, [addHydrantMode]);

  useEffect(() => {
    if (!mapInstance) return;
    mapInstance.boxZoom.disable();

    const canvas = mapInstance.getCanvas();
    let rotating = false;
    let startX = 0;
    let startBearing = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey || e.button !== 0) return;
      rotating = true;
      startX = e.clientX;
      startBearing = mapInstance.getBearing();
      mapInstance.dragPan.disable();
      canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!rotating) return;
      mapInstance.setBearing(startBearing + (e.clientX - startX) * 0.4);
    };

    const onMouseUp = () => {
      if (!rotating) return;
      rotating = false;
      mapInstance.dragPan.enable();
      canvas.style.cursor = addHydrantModeRef.current ? 'crosshair' : '';
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      mapInstance.dragPan.enable();
      mapInstance.boxZoom.enable();
    };
  }, [mapInstance]);

  // OTW effect 1: initialise source + layers once the map instance is ready
  useEffect(() => {
    if (!mapInstance || mapInstance.getSource(OTW_SOURCE)) return;
    mapInstance.addSource(OTW_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Outer glow — wide, blurred, very transparent
    mapInstance.addLayer({ id: OTW_GLOW_LAYER, type: 'line', source: OTW_SOURCE, layout: { visibility: 'none' }, paint: { 'line-color': '#DC2626', 'line-width': 22, 'line-opacity': 0.15, 'line-blur': 8 } });
    // Core — medium, solid red
    mapInstance.addLayer({ id: OTW_BG_LAYER, type: 'line', source: OTW_SOURCE, layout: { visibility: 'none' }, paint: { 'line-color': '#F87171', 'line-width': 7, 'line-opacity': 0.5 } });
    // Animated dashes on top — light red so they look like light moving through
    mapInstance.addLayer({ id: OTW_LINE_LAYER, type: 'line', source: OTW_SOURCE, layout: { visibility: 'none' }, paint: { 'line-color': '#EF4444', 'line-width': 3, 'line-dasharray': [0, 4, 3] } });
  }, [mapInstance, styleEpoch]);

  // OTW effect 2: update line geometry when coords or route changes
  useEffect(() => {
    if (!mapInstance || !mapInstance.getSource(OTW_SOURCE)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = mapInstance.getSource(OTW_SOURCE) as any;
    if (otwHydrant && userLocation) {
      // Use real road route if available, fall back to straight line while fetching
      const coordinates: [number, number][] = otwRoute ?? [[userLocation.lng, userLocation.lat], [otwHydrant.lng, otwHydrant.lat]];
      src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] });
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [mapInstance, otwHydrant, userLocation, otwRoute, styleEpoch]);

  // OTW effect 3: show/hide layers and drive the dash animation
  useEffect(() => {
    if (!mapInstance) return;
    const vis = otwHydrant ? 'visible' : 'none';
    OTW_LAYERS.forEach((id) => { if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, 'visibility', vis); });

    if (!otwHydrant) {
      if (otwAnimRef.current) { cancelAnimationFrame(otwAnimRef.current); otwAnimRef.current = null; }
      return;
    }

    let step = 0;
    let lastTs = 0;
    const tick = (ts: number) => {
      if (ts - lastTs > 80) {
        if (mapInstance.getLayer(OTW_LINE_LAYER)) {
          mapInstance.setPaintProperty(OTW_LINE_LAYER, 'line-dasharray', DASH_SEQUENCE[step]);
        }
        step = (step + 1) % DASH_SEQUENCE.length;
        lastTs = ts;
      }
      otwAnimRef.current = requestAnimationFrame(tick);
    };
    otwAnimRef.current = requestAnimationFrame(tick);
    return () => { if (otwAnimRef.current) { cancelAnimationFrame(otwAnimRef.current); otwAnimRef.current = null; } };
  }, [mapInstance, otwHydrant, styleEpoch]);

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.resize();
    setClusterZoom(clusterLevel(map.getZoom()));
    onMapReady?.({
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      flyTo: (lat, lng, zoom = 17) => map.flyTo({ center: [lng, lat], zoom, speed: 1.4 }),
      setPitch: (pitch) => map.easeTo({ pitch, duration: 600 }),
      fitRoute: (coords, padding = 60) => {
        if (!coords.length) return;
        const lngs = coords.map(([lng]) => lng);
        const lats = coords.map(([, lat]) => lat);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding, duration: 900 },
        );
      },
      setZoomLimits: (min, max) => {
        map.setMinZoom(min ?? 0);
        map.setMaxZoom(max ?? 22);
      },
      getCenter: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
      getZoom: () => map.getZoom(),
    });
    setMapInstance(map);
    onLoad?.();
  }, [onLoad, onMapReady]);

  // Clicking a cluster zooms to the level where it breaks apart — the pins then
  // glide outward from the centroid, mirroring Leaflet's expand-on-click.
  const handleClusterClick = useCallback((cluster: ClusterMarker) => {
    if (addHydrantMode || !mapInstance) return;
    const zoom = Math.min(supercluster.getClusterExpansionZoom(cluster.id), 18);
    mapInstance.flyTo({ center: [cluster.lng, cluster.lat], zoom, speed: 1.4 });
  }, [supercluster, addHydrantMode, mapInstance]);

  const handleHydrantClick = useCallback((e: MarkerEvent<MouseEvent>, h: Hydrant) => {
    e.originalEvent.stopPropagation();
    if (!addHydrantMode) onSelectHydrant(h);
  }, [addHydrantMode, onSelectHydrant]);

  const map = mapInstance;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <MapGL
        ref={mapRef}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        initialViewState={{
          longitude: initialCenter?.lng ?? DILIMAN_CENTER.lng,
          latitude: initialCenter?.lat ?? DILIMAN_CENTER.lat,
          zoom: initialZoom ?? DEFAULT_ZOOM,
        }}
        style={{ position: 'absolute', inset: 0 }}
        mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
        fadeDuration={400}
        onLoad={handleLoad}
        onError={(e: unknown) => onError?.(e)}
        onClick={(e: { lngLat: { lat: number; lng: number } }) => {
          // Marker clicks stop propagation, so any click that reaches the map is
          // on empty ground: either drop a pin or dismiss the selection.
          if (addHydrantMode) onMapClick(e.lngLat.lat, e.lngLat.lng);
          else onMapBackgroundClick();
        }}
      >
        {/* 3D buildings — only rendered when pitch is active */}
        {is3D && (
          <Layer
            id="3d-buildings"
            source="composite"
            source-layer="building"
            filter={['==', 'extrude', 'true']}
            type="fill-extrusion"
            minzoom={15}
            paint={{
              'fill-extrusion-color': isDark ? '#2a313a' : '#d4cfc9',
              'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'height']],
              'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'min_height']],
              'fill-extrusion-opacity': 0.7,
            }}
          />
        )}

        {/* Hydrant pins. Every hydrant is always mounted at its true location;
            when it belongs to a cluster we translate its inner content to the
            cluster centroid and fade it out, so it visibly slides INTO the
            cluster (zoom out) and slides BACK OUT (zoom in) — the Leaflet feel.
            The geo-positioning transform stays on the Marker root (never
            animated); only the inner wrapper transitions. */}
        {map && hydrants.map((h) => {
          const centroid = layout.placement.get(h.id);
          const clustered = !!centroid;

          let dx = 0;
          let dy = 0;
          if (centroid) {
            const here = map.project([h.lng, h.lat]);
            const there = map.project([centroid.lng, centroid.lat]);
            dx = there.x - here.x;
            dy = there.y - here.y;
          }

          const selected = selectedHydrantId === h.id;
          const meta = STATUS_META[h.status];

          return (
            <Marker
              key={h.id}
              longitude={h.lng}
              latitude={h.lat}
              anchor="bottom"
              onClick={(e) => handleHydrantClick(e, h)}
            >
              <div
                style={{
                  position: 'relative',
                  transform: `translate(${dx}px, ${dy}px)`,
                  opacity: clustered ? 0 : 1,
                  transition: `transform ${PIN_GLIDE}, opacity 0.3s ease`,
                  pointerEvents: clustered ? 'none' : 'auto',
                  cursor: addHydrantMode ? 'crosshair' : 'pointer',
                  willChange: 'transform, opacity',
                }}
              >
                {selected && <div className="hydrant-pulse-ring" />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={meta.iconUrl}
                  alt={`${h.name} — ${meta.legendLabel}`}
                  title={`${h.name} — ${meta.legendLabel}`}
                  width={HYDRANT_ICON_WIDTH}
                  height={HYDRANT_ICON_HEIGHT}
                  style={{
                    display: 'block',
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

        {/* Cluster badges. Keyed by zoom so each level pops in fresh, matching
            Leaflet where the bubble appears as its children fold inward. */}
        {map && layout.clusters.map((cluster) => (
          <Marker
            key={`cluster-${clusterZoom}-${cluster.id}`}
            longitude={cluster.lng}
            latitude={cluster.lat}
            anchor="center"
            onClick={(e) => { e.originalEvent.stopPropagation(); handleClusterClick(cluster); }}
          >
            <div
              className="anim-fade-scale"
              style={{
                width: 42,
                height: 42,
                background: 'linear-gradient(135deg, rgba(254,212,46,0.38) 0%, rgba(254,212,46,0.16) 100%)',
                border: '1.5px solid rgba(254,212,46,0.55)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 0 12px rgba(254,212,46,0.35), 0 3px 8px rgba(0,0,0,0.4)',
                color: '#91191E',
                fontSize: 13,
                fontWeight: 800,
                fontFamily: 'Arial, sans-serif',
                textShadow: '0 1px 2px rgba(255,255,255,0.4)',
                cursor: addHydrantMode ? 'crosshair' : 'pointer',
              }}
            >
              {cluster.count}
            </div>
          </Marker>
        ))}

        {pendingPin && (
          <Marker longitude={pendingPin.lng} latitude={pendingPin.lat} anchor="center">
            <div style={{ width: 14, height: 14, background: '#FED42E', border: '2.5px solid #91191E', borderRadius: '50%', boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }} />
          </Marker>
        )}

        {userLocation && (
          <Marker longitude={userLocation.lng} latitude={userLocation.lat} anchor="center">
            <div style={{ position: 'relative', width: 36, height: 36 }}>
              <div className="user-location-pulse" />
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 24, height: 24, background: '#2fbf4f', borderRadius: '50%', border: '3px solid #fff', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }} />
            </div>
          </Marker>
        )}
      </MapGL>
    </div>
  );
}
