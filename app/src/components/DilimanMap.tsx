'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, { Marker, Layer, type MapRef, type MarkerEvent } from 'react-map-gl/mapbox';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Supercluster from 'supercluster';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER } from './hydrantIcon';
import { STATUS_META, type Hydrant, type HydrantStatus } from '../data/hydrants';
import type { MapController, PendingPin } from './MapView';

const CLUSTER_RADIUS = 60;
const CLUSTER_MAX_ZOOM = 15;
const WORLD_BBOX: [number, number, number, number] = [-180, -85, 180, 85];
const clusterLevel = (zoom: number) => Math.round(zoom);
const PIN_GLIDE = '0.35s cubic-bezier(0.4, 0, 0.2, 1)';

// ── Continuous, eased wheel zoom (ported from the OSM/Leaflet SmoothWheelZoom) ─
// Mapbox's stock scroll zoom reads as one short animation per wheel event; the
// OSM map instead accumulates wheel delta into a goal zoom and glides toward it
// every frame with a frame-rate-independent exponential curve, keeping the point
// under the cursor at gesture start pinned and continuing to glide after the
// wheel stops. These constants mirror LeafletMap's SmoothWheelZoom 1:1 so both
// providers accelerate identically.
const WHEEL_ZOOM_RATE = 0.0035;  // zoom levels per wheel-delta pixel
const GLIDE_K = 9;               // exponential glide stiffness (per second)
const WHEEL_REANCHOR_MS = 180;   // a gap this long re-pins the cursor anchor
const WHEEL_IDLE_MS = 180;       // wheel considered idle after this quiet gap
const WHEEL_CONVERGE = 0.003;    // snap to goal once within this many levels
// easeOutQuint: drastic attack, long silky settle — the same curve the OSM
// eased button/click zoom uses, applied here to the +/- zoom controls.
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

// ── Sub-pixel markers during our continuous wheel zoom ─────────────────────
// react-map-gl wraps mapbox-gl's native Marker, whose `_update()` snaps the
// projected position to a whole pixel (`this._pos = this._pos.round()`). Native
// zoom animations don't shiver because Mapbox renders them via WebGL and the
// marker's per-frame ±0.5px rounding is masked by the animation; but our custom
// wheel loop drives `easeTo({duration:0})` every frame, so the sub-pixel
// projection crosses pixel boundaries frame to frame and each pin visibly
// shivers (the WebGL basemap, rendered sub-pixel, stays smooth — matching what
// you see). Mirror the fix on the OSM/Leaflet side: while one of our zoom loops
// is mid-flight, position pins from the UNrounded projection; at rest and during
// native animations fall back to Mapbox's rounded path so icons stay crisp.
//
// The active flag lives on the mapbox-gl singleton (not a module `let`) so the
// once-installed, Fast-Refresh-frozen patch below and the live loop that sets it
// read the same source of truth — the same reasoning as the LeafletMap patches.
/* eslint-disable @typescript-eslint/no-explicit-any */
type SmoothMB = { _hsZoomActive?: boolean };
const setMbSmoothZoom = (v: boolean) => { (mapboxgl as unknown as SmoothMB)._hsZoomActive = v; };
const isMbSmoothZoom = () => !!(mapboxgl as unknown as SmoothMB)._hsZoomActive;

function installSmoothMarkerZoom(MB: any) {
  if (!MB?.Marker || MB.Marker._hsSmoothZoom) return;
  MB.Marker._hsSmoothZoom = true;
  const orig = MB.Marker.prototype._update;
  MB.Marker.prototype._update = function (delaySnap: unknown) {
    if (!isMbSmoothZoom()) return orig.call(this, delaySnap);
    const map = this._map;
    if (!map || !this._element || !this._anchor) return;
    // Unrounded projection → sub-pixel tracking, then place the element now.
    this._pos = map.project(this._lngLat, this._altitude);
    this._updateDOM();
  };
}
installSmoothMarkerZoom(mapboxgl);
/* eslint-enable @typescript-eslint/no-explicit-any */

type HydrantProps = { hydrantId: string; status: HydrantStatus };

interface ClusterMarker {
  id: number;
  lng: number;
  lat: number;
  count: number;
}

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
  nearRouteIds?: Set<string> | null;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  isDark?: boolean;
  onMapMove?: () => void;
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
  onSelectHydrant, addHydrantMode, onMapClick, onMapBackgroundClick, pendingPin, is3D = false, userLocation, otwHydrant, otwRoute, nearRouteIds, initialCenter, initialZoom, isDark = false, onMapMove,
}: DilimanMapProps) {
  const mapRef = useRef<MapRef>(null);
  const otwAnimRef = useRef<number | null>(null);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [mapInstance, setMapInstance] = useState<ReturnType<MapRef['getMap']> | null>(null);
  const [clusterZoom, setClusterZoom] = useState(clusterLevel(DEFAULT_ZOOM));


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

  useEffect(() => {
    if (!mapInstance) return;
    mapInstance.getCanvas().style.cursor = addHydrantMode ? 'crosshair' : '';
  }, [addHydrantMode, mapInstance]);

  useEffect(() => {
    if (!mapInstance) return;
    const onStyleLoad = () => setStyleEpoch((e) => e + 1);
    mapInstance.on('style.load', onStyleLoad);
    return () => { if (mapInstance.loaded()) mapInstance.off('style.load', onStyleLoad); };
  }, [mapInstance]);

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

  useEffect(() => {
    if (!mapInstance || mapInstance.getSource(OTW_SOURCE)) return;
    mapInstance.addSource(OTW_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    mapInstance.addLayer({ id: OTW_GLOW_LAYER, type: 'line', source: OTW_SOURCE, layout: { visibility: 'none' }, paint: { 'line-color': '#DC2626', 'line-width': 22, 'line-opacity': 0.15, 'line-blur': 8 } });
    mapInstance.addLayer({ id: OTW_BG_LAYER,   type: 'line', source: OTW_SOURCE, layout: { visibility: 'none' }, paint: { 'line-color': '#F87171', 'line-width': 7, 'line-opacity': 0.5 } });
    mapInstance.addLayer({ id: OTW_LINE_LAYER,  type: 'line', source: OTW_SOURCE, layout: { visibility: 'none' }, paint: { 'line-color': '#EF4444', 'line-width': 3, 'line-dasharray': [0, 4, 3] } });
  }, [mapInstance, styleEpoch]);

  useEffect(() => {
    if (!mapInstance || !mapInstance.getSource(OTW_SOURCE)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = mapInstance.getSource(OTW_SOURCE) as any;
    if (otwHydrant && userLocation) {
      const coordinates: [number, number][] = otwRoute ?? [[userLocation.lng, userLocation.lat], [otwHydrant.lng, otwHydrant.lat]];
      src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] });
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [mapInstance, otwHydrant, userLocation, otwRoute, styleEpoch]);

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
      // Eased +/- zoom that matches the OSM feel (slow silky settle) rather than
      // Mapbox's default 300ms step.
      zoomIn: () => map.easeTo({ zoom: map.getZoom() + 1, duration: 700, easing: easeOutQuint }),
      zoomOut: () => map.easeTo({ zoom: map.getZoom() - 1, duration: 700, easing: easeOutQuint }),
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
      project: (lat, lng) => {
        try {
          const p = map.project([lng, lat]);
          return { x: p.x, y: p.y };
        } catch { return null; }
      },
    });
    setMapInstance(map);
    onLoad?.();
  }, [onLoad, onMapReady]);

  // Keep onMapMove in a ref so we don't re-register the listener on every render
  const onMapMoveRef = useRef(onMapMove);
  useEffect(() => { onMapMoveRef.current = onMapMove; }, [onMapMove]);

  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => onMapMoveRef.current?.();
    mapInstance.on('move', handler);
    return () => { if (mapInstance.loaded()) mapInstance.off('move', handler); };
  }, [mapInstance]);

  // ── OSM-parity continuous wheel zoom ──────────────────────────────────────
  // Replace Mapbox's stock scroll zoom with the exact accumulate-goal +
  // exponential-glide loop from LeafletMap's SmoothWheelZoom, so the two
  // providers accelerate and settle identically. We drive the camera each frame
  // with `easeTo({ around, duration: 0 })` — an instantaneous zoom pinned to the
  // geographic point under the cursor at gesture start (Mapbox's `around`
  // keeps that lng/lat fixed on screen while zooming).
  useEffect(() => {
    if (!mapInstance) return;
    const map = mapInstance;
    const canvas = map.getCanvas();
    // Our loop owns the wheel now; Mapbox's discrete handler must stand down.
    map.scrollZoom.disable();

    let active = false;   // rAF loop running
    let gesture = false;  // wheel still spinning
    let goalZoom = map.getZoom();
    let anchor = map.getCenter();   // lng/lat under the cursor, FROZEN at start
    let lastTs = 0;
    let rafId = 0;
    let idleTimer = 0;
    let lastWheelTs = 0;

    const stop = () => { active = false; gesture = false; setMbSmoothZoom(false); cancelAnimationFrame(rafId); };

    const frame = (now: number) => {
      // Frame-rate-independent exponential glide toward the goal — no steps.
      const dt = lastTs ? now - lastTs : 16.7;
      lastTs = now;
      const k = 1 - Math.exp((-dt / 1000) * GLIDE_K);
      const cur = map.getZoom();
      let zoom = cur + (goalZoom - cur) * k;
      // Keep gliding until fully converged once the wheel is idle; ending early
      // is what makes the tail of a scroll feel like a jump.
      const done = !gesture && Math.abs(goalZoom - zoom) < WHEEL_CONVERGE;
      if (done) zoom = goalZoom;
      // Sub-pixel markers mid-flight; let the settling frame round them crisp.
      setMbSmoothZoom(!done);
      map.easeTo({ zoom, around: anchor, duration: 0 });
      if (done) { active = false; return; }
      rafId = requestAnimationFrame(frame);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Start a fresh gesture on the first tick, or after a pause — both re-pin
      // the cursor anchor so the next scroll zooms toward the new spot.
      const reanchor = !active || e.timeStamp - lastWheelTs > WHEEL_REANCHOR_MS;
      lastWheelTs = e.timeStamp;
      if (reanchor) {
        const rect = canvas.getBoundingClientRect();
        anchor = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        goalZoom = map.getZoom();  // rebase so re-anchoring hands off with no jump
        if (!active) {
          active = true;
          map.stop();  // cancel any in-flight camera animation
          lastTs = 0;
          rafId = requestAnimationFrame(frame);
        }
      }
      // Normalise line-mode deltas (Firefox) to ~pixel scale.
      const dy = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      goalZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), goalZoom - dy * WHEEL_ZOOM_RATE));
      gesture = true;
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => { gesture = false; }, WHEEL_IDLE_MS);
    };

    // Any drag/tap hands the map back to native interaction — bail the glide so
    // our per-frame re-anchoring can't fight a pan (mirrors the Leaflet loop's
    // "someone else moved the map" bail-out).
    const onPointerDown = () => stop();

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onPointerDown);
      canvas.removeEventListener('touchstart', onPointerDown);
      clearTimeout(idleTimer);
      stop();
      if (map.loaded()) map.scrollZoom.enable();
    };
  }, [mapInstance]);

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
          if (addHydrantMode) onMapClick(e.lngLat.lat, e.lngLat.lng);
          else onMapBackgroundClick();
        }}
      >
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

        {map && hydrants.map((h) => {
          const centroid = layout.placement.get(h.id);
          // OTW target is always shown as individual marker, never absorbed into a cluster
          const isOtwTarget = otwHydrant?.id === h.id;
          const clustered = !isOtwTarget && !!centroid;

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

          // OTW mode visual states
          const nearRoute = nearRouteIds?.has(h.id) ?? false;
          const inOtwMode = !!otwRoute;
          const offRoute = inOtwMode && !nearRoute && !isOtwTarget;

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
                  opacity: clustered ? 0 : offRoute ? 0.25 : 1,
                  transition: `transform ${PIN_GLIDE}, opacity 0.3s ease`,
                  pointerEvents: clustered ? 'none' : 'auto',
                  cursor: addHydrantMode ? 'crosshair' : 'pointer',
                  willChange: 'transform, opacity',
                  filter: isOtwTarget ? 'drop-shadow(0 0 6px #ef4444)' : nearRoute ? `drop-shadow(0 0 5px ${meta.color})` : undefined,
                }}
              >
                {/* Selected hydrant: yellow single pulse ring (only outside OTW mode) */}
                {selected && !isOtwTarget && !clustered && !inOtwMode && (
                  <div style={{
                    position: 'absolute', inset: -5, borderRadius: '50%',
                    border: '2px solid #FED42E',
                    animation: 'route-ring-pulse 2s ease-out infinite',
                    pointerEvents: 'none',
                  }} />
                )}
                {/* OTW target: triple emergency beacon rings */}
                {isOtwTarget && !clustered && (
                  <>
                    {[0, 0.33, 0.66].map((delay) => (
                      <div key={delay} style={{
                        position: 'absolute', inset: -5, borderRadius: '50%',
                        border: '2.5px solid #ef4444',
                        animation: `emergency-beacon-pulse 1s ease-out ${delay}s infinite`,
                        pointerEvents: 'none',
                      }} />
                    ))}
                  </>
                )}
                {h.status === 'out' ? (
                  /* Out of service → sliced hydrant (two clipped halves + glint). */
                  <div className="hydrant-slice" style={{ width: HYDRANT_ICON_WIDTH, height: HYDRANT_ICON_HEIGHT }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="half top"
                      src={meta.iconUrl}
                      alt={`${h.name} — ${meta.legendLabel}`}
                      title={`${h.name} — ${meta.legendLabel}`}
                      width={HYDRANT_ICON_WIDTH}
                      height={HYDRANT_ICON_HEIGHT}
                      style={{ width: HYDRANT_ICON_WIDTH, height: HYDRANT_ICON_HEIGHT, filter: HYDRANT_PIN_FILTER }}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="half bot"
                      src={meta.iconUrl}
                      alt=""
                      aria-hidden
                      width={HYDRANT_ICON_WIDTH}
                      height={HYDRANT_ICON_HEIGHT}
                      style={{ width: HYDRANT_ICON_WIDTH, height: HYDRANT_ICON_HEIGHT, filter: HYDRANT_PIN_FILTER }}
                    />
                    <span className="cut" />
                  </div>
                ) : (
                  <>
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
                    {/* Water only spouts from the focused pin — the selected
                        hydrant or the OTW routing target — so the map isn't a
                        field of spraying water at rest. Operational → strong
                        jet · reduced pressure → weak dribble. */}
                    {(selected || isOtwTarget) && !clustered && (
                      <div className="hydrant-fx">
                        <div className={`hydrant-spout ${h.status === 'operational' ? 'strong' : 'weak'}`}>
                          <span className="drop" /><span className="drop" /><span className="drop" /><span className="drop" /><span className="drop" />
                        </div>
                      </div>
                    )}
                  </>
                )}
                {/* While routing, flag nearby non-operational hydrants as hazards. */}
                {inOtwMode && !clustered && h.status !== 'operational' && (
                  <div className="hydrant-hazard-badge">!</div>
                )}
              </div>
            </Marker>
          );
        })}

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
                color: '#e0353b',
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
            <div style={{ width: 14, height: 14, background: '#FED42E', border: '2.5px solid #e0353b', borderRadius: '50%', boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }} />
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

      {/* Nearest Hydrant Panel — overlaid top-left of the map */}
    </div>
  );
}
