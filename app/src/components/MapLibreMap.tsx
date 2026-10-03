'use client';

// MapLibre mirror of DilimanMap (the Mapbox provider). Same DOM-marker hydrant
// pins, Supercluster CSS-glide clustering, eased wheel/button zoom, globe,
// shift-drag rotate, location orb, OTW route and fire overlay — so switching
// providers changes only the basemap, not how the map feels. Keep the two in
// step: when DilimanMap's behaviour changes, port it here.
//
// Built on MapLibre's public API rather than react-map-gl: react-map-gl 8.1
// reads `map.transform`, which MapLibre v6 removed, and throws on every camera
// event. <MapMarker> below is the equivalent of react-map-gl's <Marker> — a
// native maplibregl.Marker whose element React renders into via a portal.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Supercluster from 'supercluster';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER, OWN_AOR_PIN_FILTER, OTHER_AOR_PIN_FILTER } from './hydrantIcon';
import {
  FLAME_PATH, FIRE_COLOR, SUPPLY_LINE_COLOR,
  FIRE_RADIUS_FILL_OPACITY, FIRE_RADIUS_LINE_DASH, SUPPLY_LINE_DASH,
} from './fireIcon';
import { STATUS_META, type Hydrant, type HydrantStatus } from '../data/hydrants';
import { circleRing } from '@/lib/fire-response';
import type { FireOverlay, MapController, PendingPin } from './MapView';

if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
}

const CLUSTER_RADIUS = 60;
const CLUSTER_MAX_ZOOM = 15;
const WORLD_BBOX: [number, number, number, number] = [-180, -85, 180, 85];
const clusterLevel = (zoom: number) => Math.round(zoom);
const PIN_GLIDE = '0.35s cubic-bezier(0.4, 0, 0.2, 1)';

// ── Continuous, eased wheel zoom (identical to DilimanMap) ────────────────────
// MapLibre's stock scroll zoom reads as one short animation per wheel event;
// instead accumulate wheel delta into a goal zoom and glide toward it every
// frame with a frame-rate-independent exponential curve, keeping the point
// under the cursor at gesture start pinned and continuing to glide after the
// wheel stops. Constants match DilimanMap 1:1 so both providers accelerate
// identically.
const WHEEL_ZOOM_RATE = 0.0035;  // zoom levels per wheel-delta pixel
const GLIDE_K = 9;               // exponential glide stiffness (per second)
const WHEEL_REANCHOR_MS = 180;   // a gap this long re-pins the cursor anchor
const WHEEL_IDLE_MS = 180;       // wheel considered idle after this quiet gap
const WHEEL_CONVERGE = 0.003;    // snap to goal once within this many levels
// Below this zoom we render the globe (see GLOBE_PROJECTION). Cursor-anchoring
// there means rotating the sphere, which both spins the map and fights the
// globe↔mercator transition — so on the globe zoom about the center instead
// and only pin the cursor once flat.
const GLOBE_ANCHOR_MIN_ZOOM = 6;
// easeOutQuint: drastic attack, long silky settle — applied to +/- zoom.
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

// MapLibre's built-in `globe` only flattens to mercator between zoom 11 and 12,
// so the campus view would still sit on a faintly curved sphere. Use Mapbox's
// transition window (5–6) instead: a globe when zoomed out to the world,
// plain mercator from region level down — matching the Mapbox provider.
const GLOBE_PROJECTION: maplibregl.ProjectionSpecification = {
  type: ['interpolate', ['linear'], ['zoom'], 5, 'vertical-perspective', 6, 'mercator'],
};

// Mapbox's globe floats in dark space with a glowing atmosphere; MapLibre
// draws nothing around the sphere, so a light globe vanished into the page.
// The container paints the space and the sky spec adds the atmosphere rim,
// faded out by the time the projection flattens. Sky/fog colours also tint
// the horizon at steep pitch, so they follow the theme.
const SPACE_COLOR = '#05070d';
const atmosphereSky = (dark: boolean): maplibregl.SkySpecification => ({
  'sky-color': dark ? '#0b1020' : '#bfdcf5',
  'horizon-color': dark ? '#1f2a3d' : '#eef6ff',
  'fog-color': dark ? '#11151c' : '#f2f2f0',
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
});

// ── Sub-pixel markers during our continuous wheel zoom ─────────────────────
// MapLibre's Marker `_update()` snaps its position to a whole pixel on every
// `moveend` unless `subpixelPositioning` is on. Our wheel loop drives
// `easeTo({duration:0})` each frame, and a zero-duration ease fires `moveend`
// every frame — so each frame's sub-pixel projection gets rounded and every pin
// visibly shivers while the WebGL basemap zooms smoothly underneath. Same fix
// as DilimanMap: while one of our zoom loops is mid-flight, position pins from
// the UNrounded projection; at rest fall back to rounding so icons stay crisp.
//
// MapLibre's `_update` is a per-instance arrow function (unpatchable on the
// prototype), but it reads `this._subpixelPositioning`, which the constructor
// assigns. A prototype accessor intercepts that assignment and ORs in our
// global flag. The flag lives on the Marker class (not a module `let`) so the
// once-installed, Fast-Refresh-frozen accessor and the live loop that sets it
// read the same source of truth.
/* eslint-disable @typescript-eslint/no-explicit-any */
type SmoothML = { _hsZoomActive?: boolean; _hsSmoothZoom?: boolean };
const smoothMarker = maplibregl.Marker as unknown as SmoothML;
const setMlSmoothZoom = (v: boolean) => { smoothMarker._hsZoomActive = v; };

function installSmoothMarkerZoom(MarkerClass: any) {
  if (!MarkerClass?.prototype || MarkerClass._hsSmoothZoom) return;
  MarkerClass._hsSmoothZoom = true;
  Object.defineProperty(MarkerClass.prototype, '_subpixelPositioning', {
    configurable: true,
    get(this: { _hsSubpixel?: boolean }) { return !!this._hsSubpixel || !!MarkerClass._hsZoomActive; },
    set(this: { _hsSubpixel?: boolean }, v: boolean) { this._hsSubpixel = v; },
  });
}
installSmoothMarkerZoom(maplibregl.Marker);
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

interface MapLibreMapProps {
  hydrants: Hydrant[];
  aorBarangays: string[];
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

const MAP_STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const MAP_STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

type MLMap = maplibregl.Map;

interface MapMarkerProps {
  map: MLMap;
  longitude: number;
  latitude: number;
  anchor?: maplibregl.PositionAnchor;
  draggable?: boolean;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
  onDragEnd?: (lngLat: maplibregl.LngLat) => void;
  children: ReactNode;
}

// A native MapLibre DOM marker with React children portalled into its element —
// what react-map-gl's <Marker> does. The marker is created once per mount;
// position updates go through setLngLat, so a moving GPS fix doesn't recreate
// the orb (and restart its pulse) on every update.
function MapMarker({ map, longitude, latitude, anchor = 'center', draggable = false, style, onClick, onDragEnd, children }: MapMarkerProps) {
  const [element] = useState(() => document.createElement('div'));
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const handlersRef = useRef({ onClick, onDragEnd });
  useEffect(() => { handlersRef.current = { onClick, onDragEnd }; }, [onClick, onDragEnd]);

  useEffect(() => {
    const marker = new maplibregl.Marker({ element, anchor, draggable })
      .setLngLat([longitude, latitude])
      .addTo(map);
    markerRef.current = marker;
    const click = (e: MouseEvent) => handlersRef.current.onClick?.(e);
    const dragEnd = () => handlersRef.current.onDragEnd?.(marker.getLngLat());
    element.addEventListener('click', click);
    marker.on('dragend', dragEnd);
    return () => {
      element.removeEventListener('click', click);
      marker.off('dragend', dragEnd);
      marker.remove();
      markerRef.current = null;
    };
    // Position and draggability are synced by the effects below; recreating
    // the marker for them would remount its children.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, element, anchor]);

  useEffect(() => { markerRef.current?.setLngLat([longitude, latitude]); }, [longitude, latitude]);
  useEffect(() => { markerRef.current?.setDraggable(draggable); }, [draggable]);
  useEffect(() => {
    if (!style) return;
    Object.assign(element.style, style);
  }, [element, style]);

  return createPortal(children, element);
}

interface HydrantMarkersProps {
  map: MLMap;
  hydrants: Hydrant[];
  aorBarangays: string[];
  placement: HydrantPlacement;
  clusters: ClusterMarker[];
  clusterZoom: number;
  selectedHydrantId: string | null;
  otwHydrantId: string | null;
  inOtwMode: boolean;
  nearRouteIds?: Set<string> | null;
  /** Hydrants inside a pinned fire's radius; all others are dimmed. */
  fireZoneIds: Set<string> | null;
  /** Hydrant the fire supply line is drawn from. */
  fireSupplyId: string | null;
  /** A map-pick mode (add hydrant / pin fire) is active. */
  crosshair: boolean;
  onHydrantClick: (e: MouseEvent, h: Hydrant) => void;
  onClusterClick: (e: MouseEvent, cluster: ClusterMarker) => void;
}

// The full hydrant + cluster marker set, memoized. MapLibreMap re-renders on
// every GPS fix (user-location marker) and other dashboard churn; the ~50
// markers here only depend on these props, so memoization skips reconciling
// them all on renders that didn't change hydrant/cluster state. Every hydrant
// stays mounted; clustering glides each pin into its cluster centroid with a
// CSS transform + fade instead of mounting/unmounting.
const HydrantMarkers = memo(function HydrantMarkers({
  map, hydrants, aorBarangays, placement, clusters, clusterZoom, selectedHydrantId,
  otwHydrantId, inOtwMode, nearRouteIds, fireZoneIds, fireSupplyId, crosshair, onHydrantClick, onClusterClick,
}: HydrantMarkersProps) {
  return (
    <>
      {hydrants.map((h) => {
        const centroid = placement.get(h.id);
        // OTW target is always shown as individual marker, never absorbed into a cluster
        const isOtwTarget = otwHydrantId === h.id;
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
        const hasAorContext = aorBarangays.length > 0;
        const hasBarangay = h.barangay.length > 0;
        const isOwnAor = hasAorContext && hasBarangay && aorBarangays.includes(h.barangay);
        const pinFilter = !hasAorContext || !hasBarangay
          ? HYDRANT_PIN_FILTER
          : isOwnAor
            ? OWN_AOR_PIN_FILTER
            : OTHER_AOR_PIN_FILTER;

        // OTW mode visual states
        const nearRoute = nearRouteIds?.has(h.id) ?? false;
        const offRoute = inOtwMode && !nearRoute && !isOtwTarget;

        // Fire mode visual states
        const inFireZone = fireZoneIds?.has(h.id) ?? false;
        const offFire = !!fireZoneIds && !inFireZone && !isOtwTarget;
        const isSupply = fireSupplyId === h.id;

        return (
          <MapMarker
            key={h.id}
            map={map}
            longitude={h.lng}
            latitude={h.lat}
            anchor="bottom"
            onClick={(e) => onHydrantClick(e, h)}
          >
            <div
              style={{
                position: 'relative',
                transform: `translate(${dx}px, ${dy}px)`,
                opacity: clustered ? 0 : offRoute || offFire ? 0.25 : 1,
                transition: `transform ${PIN_GLIDE}, opacity 0.3s ease`,
                pointerEvents: clustered ? 'none' : 'auto',
                cursor: crosshair ? 'crosshair' : 'pointer',
                willChange: 'transform, opacity',
                filter: isOtwTarget ? 'drop-shadow(0 0 6px #ef4444)' : nearRoute || inFireZone ? `drop-shadow(0 0 5px ${meta.color})` : undefined,
              }}
            >
              {/* Fire supply hydrant: water-blue pulse ring */}
              {isSupply && !isOtwTarget && !clustered && <div className="fire-supply-ring" />}
              {/* Selected hydrant: yellow single pulse ring (only outside OTW mode) */}
              {selected && !isSupply && !isOtwTarget && !clustered && !inOtwMode && (
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
                    style={{ width: HYDRANT_ICON_WIDTH, height: HYDRANT_ICON_HEIGHT, filter: pinFilter }}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="half bot"
                    src={meta.iconUrl}
                    alt=""
                    aria-hidden
                    width={HYDRANT_ICON_WIDTH}
                    height={HYDRANT_ICON_HEIGHT}
                    style={{ width: HYDRANT_ICON_WIDTH, height: HYDRANT_ICON_HEIGHT, filter: pinFilter }}
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
                      filter: pinFilter,
                    }}
                  />
                  {/* Water only spouts from the focused pin — the selected
                      hydrant or the OTW routing target — so the map isn't a
                      field of spraying water at rest. Operational → strong
                      jet · reduced pressure → weak dribble. */}
                  {(selected || isOtwTarget || isSupply) && !clustered && (
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
          </MapMarker>
        );
      })}

      {clusters.map((cluster) => (
        <MapMarker
          key={`cluster-${clusterZoom}-${cluster.id}`}
          map={map}
          longitude={cluster.lng}
          latitude={cluster.lat}
          anchor="center"
          onClick={(e) => { e.stopPropagation(); onClusterClick(e, cluster); }}
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
              cursor: crosshair ? 'crosshair' : 'pointer',
              // Clusters never hold fire-zone hydrants, so they dim with the
              // rest of the map outside the radius.
              opacity: fireZoneIds ? 0.35 : 1,
              transition: 'opacity 0.3s ease',
            }}
          >
            {cluster.count}
          </div>
        </MapMarker>
      ))}
    </>
  );
});

const OTW_SOURCE = 'otw-route';
const OTW_GLOW_LAYER = 'otw-route-glow';
const OTW_BG_LAYER = 'otw-route-bg';
const OTW_LINE_LAYER = 'otw-route-line';
const OTW_LAYERS = [OTW_GLOW_LAYER, OTW_BG_LAYER, OTW_LINE_LAYER];

const FIRE_RADIUS_SOURCE = 'fire-radius';
const FIRE_RADIUS_FILL = 'fire-radius-fill';
const FIRE_RADIUS_LINE = 'fire-radius-line';
const FIRE_SUPPLY_SOURCE = 'fire-supply-line';
const FIRE_SUPPLY_GLOW = 'fire-supply-glow';
const FIRE_SUPPLY_LINE = 'fire-supply-line';

// OpenFreeMap's vector source and the extruded-buildings layer built from it.
const BUILDINGS_SOURCE = 'openmaptiles';
const BUILDINGS_LAYER = '3d-buildings';

const SUPPLY_LABEL_STYLE: CSSProperties = { pointerEvents: 'none' };

const DASH_SEQUENCE = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5],
  [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 3, 3],
];

// OpenFreeMap styles have no sprite entries for some POI icons; resolve them to
// a transparent pixel instead of logging a warning per missing image.
const TRANSPARENT_PIXEL = { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) };

export default function MapLibreMap({
  hydrants, aorBarangays, selectedHydrantId, onLoad, onError, onMapReady,
  onSelectHydrant, addHydrantMode, onMapClick, onMapBackgroundClick, pendingPin, is3D = false, userLocation, otwHydrant, otwRoute, nearRouteIds, initialCenter, initialZoom, isDark = false, onMapMove,
  firePinMode = false, fire = null, onFirePin, onFireMove,
}: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const otwAnimRef = useRef<number | null>(null);
  // True while the current style can take sources/layers. Cleared the moment a
  // theme swap starts loading a new style, set again on its `style.load`.
  const styleLoadedRef = useRef(false);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [mapInstance, setMapInstance] = useState<MLMap | null>(null);
  const [clusterZoom, setClusterZoom] = useState(clusterLevel(DEFAULT_ZOOM));

  const fireZoneIds = fire?.zoneIds ?? null;
  const crosshair = addHydrantMode || firePinMode;

  // Latest callbacks/modes for the map-level listeners, which are bound once.
  const liveRef = useRef({ onLoad, onError, onMapReady, onMapClick, onMapBackgroundClick, onFirePin, addHydrantMode, firePinMode });
  useEffect(() => {
    liveRef.current = { onLoad, onError, onMapReady, onMapClick, onMapBackgroundClick, onFirePin, addHydrantMode, firePinMode };
  }, [onLoad, onError, onMapReady, onMapClick, onMapBackgroundClick, onFirePin, addHydrantMode, firePinMode]);

  const supercluster = useMemo(() => {
    const index = new Supercluster<HydrantProps>({
      radius: CLUSTER_RADIUS,
      maxZoom: CLUSTER_MAX_ZOOM,
    });
    // Hydrants around a pinned fire are left out of the index so they always
    // render individually — seeing each one is the point of the fire view.
    // With no placement entry they are simply never treated as clustered.
    const clusterable = fireZoneIds ? hydrants.filter((h) => !fireZoneIds.has(h.id)) : hydrants;
    index.load(
      clusterable.map((h) => ({
        type: 'Feature' as const,
        properties: { hydrantId: h.id, status: h.status },
        geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] },
      })),
    );
    return index;
  }, [hydrants, fireZoneIds]);

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

  // Style URL the map currently shows (or is loading).
  const appliedStyleRef = useRef(isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT);

  // ── Map lifecycle ─────────────────────────────────────────────────────────
  // Created once; the theme swaps styles in place and the camera props are
  // initial values only (as with DilimanMap's initialViewState).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
      center: [initialCenter?.lng ?? DILIMAN_CENTER.lng, initialCenter?.lat ?? DILIMAN_CENTER.lat],
      zoom: initialZoom ?? DEFAULT_ZOOM,
      // MapLibre allows -2; Mapbox stops at 0 (whole globe in view).
      minZoom: 0,
      // An automatic fallback (offline / Mapbox error) can mount this map while
      // 3D is on; start tilted so the buildings layer matches.
      pitch: is3D ? 60 : 0,
      // Match Mapbox's pitch range for right-drag tilt.
      maxPitch: 85,
      fadeDuration: 400,
    });

    // OpenFreeMap styles reference a few sprite icons they don't ship; resolve
    // them to a transparent pixel instead of logging a warning for each.
    map.setMissingStyleImageResolver((id) => {
      if (!map.hasImage(id)) map.addImage(id, TRANSPARENT_PIXEL);
    });

    const handleStyleLoad = () => {
      // A full style load resets the projection and sky to the style's own.
      map.setProjection(GLOBE_PROJECTION);
      map.setSky(atmosphereSky(appliedStyleRef.current === MAP_STYLE_DARK));
      styleLoadedRef.current = true;
      setStyleEpoch((e) => e + 1);
    };

    const handleLoad = () => {
      map.resize();
      setClusterZoom(clusterLevel(map.getZoom()));
      liveRef.current.onMapReady?.({
        // Eased +/- zoom (slow silky settle), matching DilimanMap.
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
      liveRef.current.onLoad?.();
    };

    const handleError = (e: maplibregl.ErrorEvent) => {
      console.warn('MapLibre map warning:', e.error);
      liveRef.current.onError?.(e.error);
    };

    // Markers stop propagation of their own clicks, so this only sees taps on
    // the map itself.
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const live = liveRef.current;
      if (live.firePinMode) live.onFirePin?.(e.lngLat.lat, e.lngLat.lng);
      else if (live.addHydrantMode) live.onMapClick(e.lngLat.lat, e.lngLat.lng);
      else live.onMapBackgroundClick();
    };

    map.on('style.load', handleStyleLoad);
    map.on('load', handleLoad);
    map.on('error', handleError);
    map.on('click', handleClick);

    return () => {
      styleLoadedRef.current = false;
      setMapInstance(null);
      map.remove();
    };
    // Intentionally create the MapLibre instance once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme swap. `diff: false` forces a full reload so `style.load` fires and
  // the runtime layers get rebuilt — a diffed MapLibre swap strips them
  // silently and fires nothing.
  useEffect(() => {
    const style = isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
    if (!mapInstance || appliedStyleRef.current === style) return;
    appliedStyleRef.current = style;
    styleLoadedRef.current = false;
    mapInstance.setStyle(style, { diff: false });
  }, [isDark, mapInstance]);

  useEffect(() => {
    if (!mapInstance) return;
    const sync = () => {
      const next = clusterLevel(mapInstance.getZoom());
      setClusterZoom((prev) => (prev === next ? prev : next));
    };
    sync();
    mapInstance.on('zoom', sync);
    return () => { mapInstance.off('zoom', sync); };
  }, [mapInstance]);

  useEffect(() => {
    if (!mapInstance) return;
    mapInstance.getCanvas().style.cursor = crosshair ? 'crosshair' : '';
  }, [crosshair, mapInstance]);

  const crosshairRef = useRef(crosshair);
  useEffect(() => { crosshairRef.current = crosshair; }, [crosshair]);

  // Shift + left-drag rotates (right-drag / ctrl-drag rotate natively).
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
      canvas.style.cursor = crosshairRef.current ? 'crosshair' : '';
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

  // ── GL overlay layers ─────────────────────────────────────────────────────
  // Re-added after every style load (styleEpoch). Order matches DilimanMap's
  // stacking: OTW route, then the fire radius and supply line above it.
  useEffect(() => {
    const map = mapInstance;
    if (!map || !styleLoadedRef.current) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (!map.getSource(OTW_SOURCE)) {
      map.addSource(OTW_SOURCE, { type: 'geojson', data: empty });
      map.addLayer({ id: OTW_GLOW_LAYER, type: 'line', source: OTW_SOURCE, layout: { visibility: 'none' }, paint: { 'line-color': '#DC2626', 'line-width': 22, 'line-opacity': 0.15, 'line-blur': 8 } });
      map.addLayer({ id: OTW_BG_LAYER,   type: 'line', source: OTW_SOURCE, layout: { visibility: 'none' }, paint: { 'line-color': '#F87171', 'line-width': 7, 'line-opacity': 0.5 } });
      map.addLayer({ id: OTW_LINE_LAYER,  type: 'line', source: OTW_SOURCE, layout: { visibility: 'none' }, paint: { 'line-color': '#EF4444', 'line-width': 3, 'line-dasharray': [0, 4, 3] } });
    }
    if (!map.getSource(FIRE_RADIUS_SOURCE)) {
      map.addSource(FIRE_RADIUS_SOURCE, { type: 'geojson', data: empty });
      map.addLayer({ id: FIRE_RADIUS_FILL, type: 'fill', source: FIRE_RADIUS_SOURCE, paint: { 'fill-color': FIRE_COLOR, 'fill-opacity': FIRE_RADIUS_FILL_OPACITY } });
      map.addLayer({ id: FIRE_RADIUS_LINE, type: 'line', source: FIRE_RADIUS_SOURCE, paint: { 'line-color': FIRE_COLOR, 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': FIRE_RADIUS_LINE_DASH } });
    }
    if (!map.getSource(FIRE_SUPPLY_SOURCE)) {
      map.addSource(FIRE_SUPPLY_SOURCE, { type: 'geojson', data: empty });
      map.addLayer({ id: FIRE_SUPPLY_GLOW, type: 'line', source: FIRE_SUPPLY_SOURCE, layout: { 'line-cap': 'round' }, paint: { 'line-color': SUPPLY_LINE_COLOR, 'line-width': 10, 'line-opacity': 0.2, 'line-blur': 4 } });
      map.addLayer({ id: FIRE_SUPPLY_LINE, type: 'line', source: FIRE_SUPPLY_SOURCE, layout: { 'line-cap': 'round' }, paint: { 'line-color': SUPPLY_LINE_COLOR, 'line-width': 3.5, 'line-dasharray': SUPPLY_LINE_DASH } });
    }
  }, [mapInstance, styleEpoch]);

  useEffect(() => {
    if (!mapInstance) return;
    const src = mapInstance.getSource(OTW_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
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

  // Fire overlay geometry — search radius polygon and hydrant → fire line.
  // Keyed on coordinates, not the overlay object, which is rebuilt whenever
  // the hydrant feed ticks.
  const supply = fire?.supply ?? null;
  const fireLat = fire?.lat;
  const fireLng = fire?.lng;
  const fireRadiusM = fire?.radiusM;
  const supplyLat = supply?.lat;
  const supplyLng = supply?.lng;
  const fireRadiusData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: fireLat === undefined || fireLng === undefined || fireRadiusM === undefined ? [] : [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [circleRing(fireLat, fireLng, fireRadiusM)] },
      }],
    }),
    [fireLat, fireLng, fireRadiusM],
  );
  const fireSupplyData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: fireLat === undefined || fireLng === undefined || supplyLat === undefined || supplyLng === undefined ? [] : [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[supplyLng, supplyLat], [fireLng, fireLat]] },
      }],
    }),
    [fireLat, fireLng, supplyLat, supplyLng],
  );

  useEffect(() => {
    (mapInstance?.getSource(FIRE_RADIUS_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(fireRadiusData);
  }, [mapInstance, fireRadiusData, styleEpoch]);

  useEffect(() => {
    (mapInstance?.getSource(FIRE_SUPPLY_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(fireSupplyData);
  }, [mapInstance, fireSupplyData, styleEpoch]);

  // 3D buildings from the OpenMapTiles building layer, slotted under the route
  // and fire overlays so those stay readable on top of the extrusions.
  useEffect(() => {
    const map = mapInstance;
    if (!map || !styleLoadedRef.current) return;
    if (map.getLayer(BUILDINGS_LAYER)) map.removeLayer(BUILDINGS_LAYER);
    if (!is3D || !map.getSource(BUILDINGS_SOURCE)) return;
    map.addLayer({
      id: BUILDINGS_LAYER,
      type: 'fill-extrusion',
      source: BUILDINGS_SOURCE,
      'source-layer': 'building',
      minzoom: 15,
      filter: ['!', ['to-boolean', ['get', 'hide_3d']]],
      paint: {
        'fill-extrusion-color': isDark ? '#2a313a' : '#d4cfc9',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['coalesce', ['get', 'render_height'], 0]],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['coalesce', ['get', 'render_min_height'], 0]],
        'fill-extrusion-opacity': 0.7,
      },
    }, map.getLayer(OTW_GLOW_LAYER) ? OTW_GLOW_LAYER : undefined);
  }, [mapInstance, is3D, isDark, styleEpoch]);

  // Keep onMapMove in a ref so we don't re-register the listener on every render
  const onMapMoveRef = useRef(onMapMove);
  useEffect(() => { onMapMoveRef.current = onMapMove; }, [onMapMove]);

  useEffect(() => {
    if (!mapInstance) return;
    const handler = () => onMapMoveRef.current?.();
    mapInstance.on('move', handler);
    return () => { mapInstance.off('move', handler); };
  }, [mapInstance]);

  // ── Continuous wheel zoom (same loop as DilimanMap) ───────────────────────
  // Replace MapLibre's stock scroll zoom with the accumulate-goal +
  // exponential-glide loop. Each frame drives the camera with
  // `easeTo({ around, duration: 0 })` — an instantaneous zoom pinned to the
  // geographic point under the cursor at gesture start.
  useEffect(() => {
    if (!mapInstance) return;
    const map = mapInstance;
    // Listen on the CONTAINER, not the canvas. Cluster markers and the location
    // orb are DOM elements stacked ON TOP of the canvas; a wheel over one of
    // them targets that div and bubbles to the container but never reaches the
    // canvas (a sibling), so canvas-bound zoom "locks" over a cluster. Capture
    // phase so we still fire even if a marker stops propagation.
    const container = map.getContainer();
    // Our loop owns the wheel now; MapLibre's discrete handler must stand down.
    map.scrollZoom.disable();

    let active = false;   // rAF loop running
    let gesture = false;  // wheel still spinning
    let goalZoom = map.getZoom();
    // Our own authoritative animated zoom, integrated each frame instead of
    // read back from map.getZoom(): during the globe↔mercator transition the
    // camera may not land exactly where we ask, and reading it back would keep
    // the glide from ever converging (a hot rAF loop pinned in place).
    let renderZoom = goalZoom;
    let anchor: maplibregl.LngLat | null = null;   // lng/lat under the cursor, FROZEN at start (null → zoom about center)
    let lastTs = 0;
    let rafId = 0;
    let idleTimer = 0;
    let lastWheelTs = 0;

    const stop = () => { active = false; gesture = false; setMlSmoothZoom(false); cancelAnimationFrame(rafId); };

    const frame = (now: number) => {
      // Frame-rate-independent exponential glide toward the goal — no steps.
      const dt = lastTs ? now - lastTs : 16.7;
      lastTs = now;
      const k = 1 - Math.exp((-dt / 1000) * GLIDE_K);
      renderZoom += (goalZoom - renderZoom) * k;
      // Keep gliding until fully converged once the wheel is idle; ending early
      // is what makes the tail of a scroll feel like a jump.
      const done = !gesture && Math.abs(goalZoom - renderZoom) < WHEEL_CONVERGE;
      if (done) renderZoom = goalZoom;
      // Sub-pixel markers mid-flight; let the settling frame round them crisp.
      setMlSmoothZoom(!done);
      // On the globe, cursor-anchoring rotates the sphere and fights the
      // projection transition. Below the flat threshold zoom about center;
      // above it pin the cursor. Keyed off renderZoom so the switch is
      // deterministic mid-gesture.
      const pin = anchor && renderZoom >= GLOBE_ANCHOR_MIN_ZOOM ? anchor : null;
      map.easeTo(pin ? { zoom: renderZoom, around: pin, duration: 0 } : { zoom: renderZoom, duration: 0 });
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
        // Resync to the map's real zoom in case a flyTo/pan moved it while we
        // were idle, then rebase the goal so re-anchoring hands off with no jump.
        renderZoom = map.getZoom();
        goalZoom = renderZoom;
        const rect = container.getBoundingClientRect();
        // On the globe a cursor over empty space (off-sphere) unprojects to
        // garbage; only pin an anchor once we're flat, else zoom about center.
        if (renderZoom >= GLOBE_ANCHOR_MIN_ZOOM) {
          const p = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
          anchor = Number.isFinite(p.lng) && Number.isFinite(p.lat) ? p : null;
        } else {
          anchor = null;
        }
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
    // our per-frame re-anchoring can't fight a pan.
    const onPointerDown = () => stop();

    container.addEventListener('wheel', onWheel, { passive: false, capture: true });
    container.addEventListener('mousedown', onPointerDown);
    container.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      container.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      container.removeEventListener('mousedown', onPointerDown);
      container.removeEventListener('touchstart', onPointerDown);
      clearTimeout(idleTimer);
      stop();
      if (map.loaded()) map.scrollZoom.enable();
    };
  }, [mapInstance]);

  // In fire-pin mode a tap on a hydrant or cluster marker still means "the
  // fire is HERE" — markers swallow the map click, so resolve the point under
  // the pointer ourselves.
  const pinFireAtEvent = useCallback((ev: MouseEvent) => {
    if (!mapInstance || !onFirePin) return;
    const rect = mapInstance.getContainer().getBoundingClientRect();
    const p = mapInstance.unproject([ev.clientX - rect.left, ev.clientY - rect.top]);
    onFirePin(p.lat, p.lng);
  }, [mapInstance, onFirePin]);

  const handleClusterClick = useCallback((e: MouseEvent, cluster: ClusterMarker) => {
    if (firePinMode) { pinFireAtEvent(e); return; }
    if (addHydrantMode || !mapInstance) return;
    const zoom = Math.min(supercluster.getClusterExpansionZoom(cluster.id), 18);
    mapInstance.flyTo({ center: [cluster.lng, cluster.lat], zoom, speed: 1.4 });
  }, [supercluster, addHydrantMode, firePinMode, pinFireAtEvent, mapInstance]);

  const handleHydrantClick = useCallback((e: MouseEvent, h: Hydrant) => {
    e.stopPropagation();
    if (firePinMode) pinFireAtEvent(e);
    else if (!addHydrantMode) onSelectHydrant(h);
  }, [addHydrantMode, firePinMode, pinFireAtEvent, onSelectHydrant]);

  const map = mapInstance;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Space only once loaded — before the first frame it would flash dark. */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: map ? SPACE_COLOR : undefined }} />

      {map && (
        <HydrantMarkers
          map={map}
          hydrants={hydrants}
          aorBarangays={aorBarangays}
          placement={layout.placement}
          clusters={layout.clusters}
          clusterZoom={clusterZoom}
          selectedHydrantId={selectedHydrantId}
          otwHydrantId={otwHydrant?.id ?? null}
          inOtwMode={!!otwRoute}
          nearRouteIds={nearRouteIds}
          fireZoneIds={fireZoneIds}
          fireSupplyId={supply?.hydrantId ?? null}
          crosshair={crosshair}
          onHydrantClick={handleHydrantClick}
          onClusterClick={handleClusterClick}
        />
      )}

      {map && pendingPin && (
        <MapMarker map={map} longitude={pendingPin.lng} latitude={pendingPin.lat} anchor="center">
          <div style={{ width: 14, height: 14, background: '#FED42E', border: '2.5px solid #e0353b', borderRadius: '50%', boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }} />
        </MapMarker>
      )}

      {map && fire && supply && (
        <MapMarker
          map={map}
          longitude={(supply.lng + fire.lng) / 2}
          latitude={(supply.lat + fire.lat) / 2}
          anchor="center"
          style={SUPPLY_LABEL_STYLE}
        >
          <div className="fire-supply-label">{supply.label}</div>
        </MapMarker>
      )}

      {map && fire && (
        <MapMarker
          map={map}
          longitude={fire.lng}
          latitude={fire.lat}
          anchor="center"
          draggable
          onDragEnd={(p) => onFireMove?.(p.lat, p.lng)}
          // Don't let a tap on the pin read as a background tap (closes panels).
          onClick={(e) => e.stopPropagation()}
        >
          <div className="fire-pin" title="Fire location — drag to adjust">
            <span className="fire-pin-pulse" />
            <span className="fire-pin-pulse fire-pin-pulse-late" />
            <span className="fire-pin-core">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={FLAME_PATH} /></svg>
            </span>
          </div>
        </MapMarker>
      )}

      {map && userLocation && (
        <MapMarker map={map} longitude={userLocation.lng} latitude={userLocation.lat} anchor="center">
          <div style={{ position: 'relative', width: 36, height: 36 }}>
            <div className="user-location-pulse" />
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 24, height: 24, background: '#2fbf4f', borderRadius: '50%', border: '3px solid #fff', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }} />
          </div>
        </MapMarker>
      )}
    </div>
  );
}
