'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import Supercluster from 'supercluster';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';
import { HYDRANT_ICON_WIDTH, HYDRANT_ICON_HEIGHT, HYDRANT_PIN_FILTER } from './hydrantIcon';
import { STATUS_META, type Hydrant, type HydrantStatus } from '../data/hydrants';
import type { MapController, PendingPin } from './MapView';

// ── Smooth, continuous wheel zoom ──────────────────────────────────────────
// Leaflet's stock scroll-wheel zoom fires one short, discrete zoom animation
// per wheel notch, so fast scrolling reads as a fragmented stair-step. This
// handler (a compact port of the well-known Leaflet.SmoothWheelZoom technique)
// accumulates wheel delta into a target zoom and eases toward it every frame
// via the internal `map._move`, giving Mapbox-like continuous zoom that keeps
// the point under the cursor fixed. Registered once, globally, at module load
// (before any MapContainer mounts). The dynamic import is SSR-disabled, so `L`
// is always the browser build here.
/* eslint-disable @typescript-eslint/no-explicit-any */
function installSmoothWheelZoom(Lref: any) {
  if (Lref.Map.SmoothWheelZoom) return;
  Lref.Map.mergeOptions({ smoothWheelZoom: true, smoothSensitivity: 1 });
  Lref.Map.SmoothWheelZoom = Lref.Handler.extend({
    addHooks() {
      Lref.DomEvent.on(this._map._container, 'wheel', this._onWheelScroll, this);
    },
    removeHooks() {
      Lref.DomEvent.off(this._map._container, 'wheel', this._onWheelScroll, this);
      clearTimeout(this._timeoutId);
      this._stopWheelAnim();
    },
    _onWheelScroll(e: any) {
      if (!this._active) this._onWheelStart(e);
      this._onWheeling(e);
    },
    _onWheelStart(e: any) {
      const map = this._map;
      this._active = true;   // rAF loop running
      this._gesture = true;  // fingers still on the wheel
      this._wheelMousePosition = map.mouseEventToContainerPoint(e);
      this._centerPoint = map.getSize()._divideBy(2);
      this._wheelStartLatLng = map.containerPointToLatLng(this._wheelMousePosition);
      map._stop();
      if (map._panAnim) map._panAnim.stop();
      this._goalZoom = map.getZoom();
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();
      this._lastFrameTs = 0;
      this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
    },
    _onWheeling(e: any) {
      const map = this._map;
      // Normalise line-mode deltas (Firefox) to ~pixel scale.
      const dy = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      this._goalZoom = this._goalZoom - dy * 0.0035 * map.options.smoothSensitivity;
      if (this._goalZoom < map.getMinZoom() || this._goalZoom > map.getMaxZoom()) {
        this._goalZoom = map._limitZoom(this._goalZoom);
      }
      this._wheelMousePosition = map.mouseEventToContainerPoint(e);
      this._gesture = true;
      clearTimeout(this._timeoutId);
      this._timeoutId = setTimeout(() => { this._gesture = false; }, 180);
      Lref.DomEvent.preventDefault(e);
      Lref.DomEvent.stopPropagation(e);
    },
    _stopWheelAnim() {
      this._active = false;
      this._gesture = false;
      cancelAnimationFrame(this._zoomAnimationId);
    },
    _updateWheelZoom(now: number) {
      const map = this._map;
      // Bail if some other interaction moved the map out from under us.
      if (!map.getCenter().equals(this._prevCenter) || map.getZoom() !== this._prevZoom) {
        this._stopWheelAnim();
        return;
      }
      // Time-based exponential glide toward the goal zoom — frame-rate
      // independent and with no quantisation, so there are no visible steps.
      const dt = this._lastFrameTs ? now - this._lastFrameTs : 16.7;
      this._lastFrameTs = now;
      const k = 1 - Math.exp((-dt / 1000) * 9);
      let zoom = map.getZoom() + (this._goalZoom - map.getZoom()) * k;
      // Once the wheel is idle, keep gliding until we've fully converged —
      // ending early is what made the tail of each scroll feel like a jump.
      const done = !this._gesture && Math.abs(this._goalZoom - zoom) < 0.003;
      if (done) zoom = this._goalZoom;
      // Recentre so the pixel under the cursor stays pinned as the zoom eases.
      const delta = this._wheelMousePosition.subtract(this._centerPoint);
      const center = map.unproject(
        map.project(this._wheelStartLatLng, zoom).subtract(delta),
        zoom,
      );
      map._move(center, zoom);
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();
      if (done) {
        this._active = false;
        map._moveEnd(true);
        return;
      }
      this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
    },
  });
  Lref.Map.addInitHook('addHandler', 'smoothWheelZoom', Lref.Map.SmoothWheelZoom);
}
installSmoothWheelZoom(L);

// ── Mapbox-parity zoom scale ───────────────────────────────────────────────
// mapbox-gl renders 512px tiles, Leaflet 256px — so Mapbox zoom N covers the
// same ground as Leaflet zoom N+1. The whole app (dashboard, controller calls,
// saved viewports) speaks *Mapbox* zoom units; this controller converts at the
// boundary. Without this, `flyTo(h, 16)` lands visibly further out on OSM than
// on Mapbox — the "not as zoomed in" complaint.
const OSM_ZOOM_OFFSET = 1;
const toLeafletZoom = (z: number) => z + OSM_ZOOM_OFFSET;
const fromLeafletZoom = (z: number) => z - OSM_ZOOM_OFFSET;

// ── Eased view animation (Mapbox easeTo feel) ──────────────────────────────
// Leaflet's flyTo interpolates *linearly* for centre-fixed zooms and its
// setZoom CSS animation is a fixed 0.25s — neither reads like Mapbox. This
// drives the view each frame through the same internal `_move` the wheel
// handler uses, with an easeOutQuint curve (drastic attack, long silky
// settle) and the centre interpolated in projected space at the current
// frame's zoom so the path bends into the target exactly like Mapbox.
type AnimatableMap = L.Map & {
  _hsAnim?: number;
  _hsCleanup?: () => void;
  _move: (center: L.LatLng, zoom: number) => void;
  _moveEnd: (zoomChanged: boolean) => void;
  _stop: () => void;
};

function cancelViewAnimation(map: L.Map) {
  const m = map as AnimatableMap;
  if (m._hsAnim !== undefined) {
    cancelAnimationFrame(m._hsAnim);
    m._hsAnim = undefined;
  }
  m._hsCleanup?.();
  m._hsCleanup = undefined;
}

const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

function animateView(map: L.Map, target: L.LatLng, targetZoom: number, duration: number) {
  const m = map as AnimatableMap;
  cancelViewAnimation(map);
  m._stop();
  const startCenter = map.getCenter();
  const startZoom = map.getZoom();
  const endZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), targetZoom));
  if (Math.abs(endZoom - startZoom) < 0.01 && startCenter.distanceTo(target) < 1) return;

  // Any direct user input takes over immediately.
  const container = map.getContainer();
  const cancelOnInput = () => cancelViewAnimation(map);
  container.addEventListener('pointerdown', cancelOnInput);
  container.addEventListener('wheel', cancelOnInput);
  m._hsCleanup = () => {
    container.removeEventListener('pointerdown', cancelOnInput);
    container.removeEventListener('wheel', cancelOnInput);
  };

  const start = performance.now();
  const frame = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    const e = easeOutQuint(t);
    const zoom = startZoom + (endZoom - startZoom) * e;
    const p0 = map.project(startCenter, zoom);
    const p1 = map.project(target, zoom);
    const center = map.unproject(p0.add(p1.subtract(p0).multiplyBy(e)), zoom);
    m._move(center, zoom);
    if (t < 1) {
      m._hsAnim = requestAnimationFrame(frame);
    } else {
      m._hsAnim = undefined;
      m._hsCleanup?.();
      m._hsCleanup = undefined;
      m._moveEnd(true);
    }
  };
  m._hsAnim = requestAnimationFrame(frame);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Clustering (mirrors the Mapbox side in DilimanMap) ─────────────────────
// The Mapbox map keeps every hydrant marker mounted and, when a marker is
// absorbed into a cluster, slides it (CSS transform) onto the cluster centroid
// and fades it out — markers never mount/unmount, so panning and zooming stay
// glassy. We do the exact same thing here with Supercluster instead of
// react-leaflet-cluster (which re-created DOM markers on every move, causing
// the jitter/pop-in). Cluster geometry only recomputes when the rounded zoom
// level changes, and the per-marker offset is applied imperatively to a child
// wrapper (never the Leaflet-positioned root icon).
const CLUSTER_RADIUS = 60;
const CLUSTER_MAX_ZOOM = 15;
const WORLD_BBOX: [number, number, number, number] = [-180, -85, 180, 85];
const clusterLevel = (zoom: number) => Math.round(zoom);
// Same easing/timing as the Mapbox PIN_GLIDE so both providers feel identical.
const PIN_GLIDE = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';

type HydrantProps = { hydrantId: string; status: HydrantStatus };

interface ClusterMarker {
  id: number;
  lng: number;
  lat: number;
  count: number;
}

type HydrantPlacement = Map<string, { lng: number; lat: number } | null>;

// Stable divIcon per status — reused across renders so the Marker DOM (and the
// CSS transition on its wrapper) survives re-renders. Selection / OTW rings are
// baked in hidden and toggled imperatively, so the icon reference never changes.
const iconCache = new Map<HydrantStatus, L.DivIcon>();
function hydrantIcon(status: HydrantStatus): L.DivIcon {
  const cached = iconCache.get(status);
  if (cached) return cached;

  const iconUrl = STATUS_META[status].iconUrl;
  const W = HYDRANT_ICON_WIDTH, H = HYDRANT_ICON_HEIGHT;
  const imgStyle = `display:block;width:${W}px;height:${H}px;object-fit:contain;filter:${HYDRANT_PIN_FILTER};cursor:pointer;`;

  let content: string;
  if (status === 'out') {
    // Out of service → sliced hydrant (two clipped halves + glint sweep).
    content =
      `<div class="hydrant-slice" style="width:${W}px;height:${H}px;">` +
        `<img class="half top" src="${iconUrl}" width="${W}" height="${H}" style="${imgStyle}" />` +
        `<img class="half bot" src="${iconUrl}" width="${W}" height="${H}" style="${imgStyle}" />` +
        `<span class="cut"></span>` +
      `</div>`;
  } else {
    // Operational → strong jet · reduced pressure → weak dribble.
    const power = status === 'operational' ? 'strong' : 'weak';
    content =
      `<img src="${iconUrl}" width="${W}" height="${H}" style="${imgStyle}" />` +
      `<div class="hydrant-fx"><div class="hydrant-spout ${power}">` +
        `<span class="drop"></span><span class="drop"></span><span class="drop"></span><span class="drop"></span><span class="drop"></span>` +
      `</div></div>`;
  }

  // Selection pulse (yellow) and OTW beacon (triple red) — hidden until the
  // positioner toggles their `display`, which restarts the CSS keyframes.
  const selRing =
    `<div class="sel-ring" style="position:absolute;inset:-5px;border-radius:50%;border:2px solid #FED42E;animation:route-ring-pulse 2s ease-out infinite;display:none;pointer-events:none;"></div>`;
  const otwRings = [0, 0.33, 0.66]
    .map(
      (d) =>
        `<div class="otw-ring" style="position:absolute;inset:-5px;border-radius:50%;border:2.5px solid #ef4444;animation:emergency-beacon-pulse 1s ease-out ${d}s infinite;display:none;pointer-events:none;"></div>`,
    )
    .join('');

  // Hazard "!" badge — baked in hidden for non-operational hydrants, toggled on
  // by the positioner while routing (OTW mode). Operational pins never get one.
  const hazardBadge = status !== 'operational'
    ? `<div class="hydrant-hazard-badge" style="display:none;">!</div>`
    : '';

  const icon = L.divIcon({
    html:
      `<div class="hydrant-anim" style="position:relative;width:${W}px;height:${H}px;transition:${PIN_GLIDE};will-change:transform,opacity;">` +
        selRing +
        otwRings +
        content +
        hazardBadge +
      `</div>`,
    className: 'hydrant-pin',
    iconSize: [W, H],
    iconAnchor: [W / 2, H],
  });
  iconCache.set(status, icon);
  return icon;
}

function createClusterIcon(count: number) {
  return L.divIcon({
    html: `<div style="
      width:42px;height:42px;
      background:linear-gradient(135deg,rgba(254,212,46,0.38) 0%,rgba(254,212,46,0.16) 100%);
      border:1.5px solid rgba(254,212,46,0.55);
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
      box-shadow:0 0 12px rgba(254,212,46,0.35),0 3px 8px rgba(0,0,0,0.4);
      color:#e0353b;font-size:13px;font-weight:800;font-family:Arial,sans-serif;
      text-shadow:0 1px 2px rgba(255,255,255,0.4);
    ">${count}</div>`,
    className: 'hydrant-cluster-icon',
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

const pendingPinIcon = L.divIcon({
  html: `<div style="width:14px;height:14px;background:#FED42E;border:2.5px solid #e0353b;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.45)"></div>`,
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const userLocationIcon = L.divIcon({
  html: `<div style="position:relative;width:36px;height:36px;"><div class="user-location-pulse"></div><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:24px;height:24px;background:#2fbf4f;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,0.4);"></div></div>`,
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

function MapClickHandler({ addHydrantMode, onMapClick, onMapBackgroundClick }: { addHydrantMode: boolean; onMapClick: (lat: number, lng: number) => void; onMapBackgroundClick: () => void }) {
  const map = useMap();
  useMapEvents({
    click(e) {
      if (addHydrantMode) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      } else {
        onMapBackgroundClick();
      }
    },
  });
  useEffect(() => {
    map.getContainer().style.cursor = addHydrantMode ? 'crosshair' : '';
  }, [map, addHydrantMode]);
  return null;
}

function ZoomBridge({ onMapReady }: { onMapReady?: (controller: MapController) => void }) {
  const map = useMap();
  useEffect(() => {
    onMapReady?.({
      // Everything below speaks Mapbox zoom units (see OSM_ZOOM_OFFSET) and
      // animates through animateView — the same drastic-attack/silky-settle
      // ease the Mapbox provider reads as.
      zoomIn: () => animateView(map, map.getCenter(), map.getZoom() + 1, 700),
      zoomOut: () => animateView(map, map.getCenter(), map.getZoom() - 1, 700),
      flyTo: (lat, lng, zoom = 17) => {
        const target = L.latLng(lat, lng);
        const lZoom = toLeafletZoom(zoom);
        const zoomChanged = Math.abs(map.getZoom() - lZoom) > 0.1;
        const moved = map.getCenter().distanceTo(target) > 3; // metres
        // Already at this view → do nothing (re-clicking the selected hydrant).
        if (!moved && !zoomChanged) return;
        animateView(map, target, lZoom, 950);
      },
      setPitch: () => { /* Leaflet does not support pitch */ },
      fitRoute: (coords, padding = 60) => {
        if (!coords.length) return;
        const bounds = L.latLngBounds(coords.map(([lng, lat]) => L.latLng(lat, lng)));
        map.fitBounds(bounds, { padding: [padding, padding] });
      },
      setZoomLimits: (min, max) => {
        // Callers pass Mapbox units; convert. Keep the 3 floor even when
        // callers "clear" the limit (null) — below it the world wraps and
        // Leaflet's projection/cluster math can throw.
        map.setMinZoom(min !== null ? toLeafletZoom(min) : 3);
        map.setMaxZoom(max !== null ? toLeafletZoom(max) : 22);
      },
      getCenter: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
      getZoom: () => fromLeafletZoom(map.getZoom()),
      project: (lat, lng) => {
        try {
          const p = map.latLngToContainerPoint(L.latLng(lat, lng));
          return { x: p.x, y: p.y };
        } catch { return null; }
      },
    });
  }, [map, onMapReady]);
  return null;
}

function MapMoveHandler({ onMapMove }: { onMapMove?: () => void }) {
  const cbRef = useRef(onMapMove);
  useEffect(() => { cbRef.current = onMapMove; }, [onMapMove]);
  const map = useMap();
  useEffect(() => {
    const handler = () => cbRef.current?.();
    map.on('move', handler);
    return () => { map.off('move', handler); };
  }, [map]);
  return null;
}

interface HydrantLayerProps {
  hydrants: Hydrant[];
  selectedHydrantId: string | null;
  onSelectHydrant: (hydrant: Hydrant) => void;
  addHydrantMode: boolean;
  otwHydrant?: Hydrant | null;
  otwRoute?: [number, number][] | null;
  nearRouteIds?: Set<string> | null;
}

// Supercluster-driven hydrant + cluster markers with Mapbox-style glide.
function HydrantLayer({ hydrants, selectedHydrantId, onSelectHydrant, addHydrantMode, otwHydrant, otwRoute, nearRouteIds }: HydrantLayerProps) {
  const map = useMap();
  const markerRefs = useRef(new Map<string, L.Marker>());
  // Cluster in Mapbox zoom units so bubbles form/split at the same visual
  // scale as the Mapbox provider.
  const [clusterZoom, setClusterZoom] = useState(() => clusterLevel(fromLeafletZoom(map.getZoom())));

  // Re-cluster only when the *rounded* zoom crosses an integer boundary. The
  // smooth-wheel handler fires `zoom` every frame via _move, so this keeps
  // clustering live during a continuous wheel zoom without thrashing.
  useEffect(() => {
    const sync = () => {
      const next = clusterLevel(fromLeafletZoom(map.getZoom()));
      setClusterZoom((prev) => (prev === next ? prev : next));
    };
    sync();
    map.on('zoom', sync);
    return () => { map.off('zoom', sync); };
  }, [map]);

  const supercluster = useMemo(() => {
    const index = new Supercluster<HydrantProps>({ radius: CLUSTER_RADIUS, maxZoom: CLUSTER_MAX_ZOOM });
    index.load(
      hydrants.map((h) => ({
        type: 'Feature' as const,
        properties: { hydrantId: h.id, status: h.status },
        geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] },
      })),
    );
    return index;
  }, [hydrants]);

  const { clusters, placement } = useMemo(() => {
    const cs: ClusterMarker[] = [];
    const pl: HydrantPlacement = new Map();
    for (const feature of supercluster.getClusters(WORLD_BBOX, clusterZoom)) {
      const [lng, lat] = feature.geometry.coordinates;
      if ('cluster' in feature.properties && feature.properties.cluster) {
        const clusterId = feature.properties.cluster_id;
        cs.push({ id: clusterId, lng, lat, count: feature.properties.point_count });
        for (const leaf of supercluster.getLeaves(clusterId, Infinity)) {
          pl.set(leaf.properties.hydrantId, { lng, lat });
        }
      } else {
        pl.set(feature.properties.hydrantId, null);
      }
    }
    return { clusters: cs, placement: pl };
  }, [supercluster, clusterZoom]);

  // Imperatively position each persistent marker: slide clustered pins onto
  // their cluster centroid and fade them out; the CSS transition on the wrapper
  // gives the smooth glide. Runs after the Marker layout effects (children run
  // first), so getElement() is valid. Clustered pins are invisible, so their
  // slightly-stale offset during a fractional zoom is never seen.
  useEffect(() => {
    const inOtwMode = !!otwRoute;
    for (const h of hydrants) {
      const root = markerRefs.current.get(h.id)?.getElement();
      const wrapper = root?.querySelector('.hydrant-anim') as HTMLElement | null;
      if (!root || !wrapper) continue;

      const isOtwTarget = otwHydrant?.id === h.id;
      const centroid = isOtwTarget ? null : placement.get(h.id);
      const clustered = !!centroid;

      let dx = 0, dy = 0;
      if (centroid) {
        const here = map.latLngToLayerPoint([h.lat, h.lng]);
        const there = map.latLngToLayerPoint([centroid.lat, centroid.lng]);
        dx = there.x - here.x;
        dy = there.y - here.y;
      }

      const nearRoute = nearRouteIds?.has(h.id) ?? false;
      const offRoute = inOtwMode && !nearRoute && !isOtwTarget;
      const meta = STATUS_META[h.status];

      wrapper.style.transform = `translate(${dx}px, ${dy}px)`;
      wrapper.style.opacity = clustered ? '0' : offRoute ? '0.25' : '1';
      wrapper.style.filter = isOtwTarget
        ? 'drop-shadow(0 0 6px #ef4444)'
        : nearRoute
          ? `drop-shadow(0 0 5px ${meta.color})`
          : '';
      root.style.pointerEvents = clustered ? 'none' : '';

      const showSel = selectedHydrantId === h.id && !isOtwTarget && !clustered && !inOtwMode;
      const selRing = wrapper.querySelector('.sel-ring') as HTMLElement | null;
      if (selRing) selRing.style.display = showSel ? 'block' : 'none';

      const showOtw = isOtwTarget && !clustered;
      wrapper.querySelectorAll('.otw-ring').forEach((r) => {
        (r as HTMLElement).style.display = showOtw ? 'block' : 'none';
      });

      // Hazard "!" — visible while routing on any non-operational nearby hydrant.
      const showHazard = inOtwMode && !clustered && h.status !== 'operational';
      const hazard = wrapper.querySelector('.hydrant-hazard-badge') as HTMLElement | null;
      if (hazard) hazard.style.display = showHazard ? 'flex' : 'none';
    }
  }, [map, hydrants, placement, selectedHydrantId, otwHydrant, otwRoute, nearRouteIds]);

  // Cluster click → slow, eased flyTo to the expansion zoom, capped like the
  // Mapbox side (≤18). This is the "reveal the hydrants" gesture.
  const handleClusterClick = (cluster: ClusterMarker) => {
    if (addHydrantMode) return;
    // Expansion zoom is in Mapbox/supercluster units; cap at 18 like Mapbox.
    const expansionZoom = Math.min(supercluster.getClusterExpansionZoom(cluster.id), 18);
    animateView(map, L.latLng(cluster.lat, cluster.lng), toLeafletZoom(expansionZoom), 850);
  };

  return (
    <>
      {hydrants.map((h) => (
        <Marker
          key={h.id}
          position={[h.lat, h.lng]}
          icon={hydrantIcon(h.status)}
          ref={(m) => {
            if (m) markerRefs.current.set(h.id, m);
            else markerRefs.current.delete(h.id);
          }}
          eventHandlers={{ click: () => { if (!addHydrantMode) onSelectHydrant(h); } }}
        />
      ))}
      {clusters.map((c) => (
        <Marker
          key={`cluster-${clusterZoom}-${c.id}`}
          position={[c.lat, c.lng]}
          icon={createClusterIcon(c.count)}
          eventHandlers={{ click: () => handleClusterClick(c) }}
        />
      ))}
    </>
  );
}

interface LeafletMapProps {
  hydrants: Hydrant[];
  selectedHydrantId: string | null;
  onMapReady?: (controller: MapController) => void;
  onSelectHydrant: (hydrant: Hydrant) => void;
  addHydrantMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onMapBackgroundClick: () => void;
  pendingPin: PendingPin | null;
  userLocation?: { lat: number; lng: number } | null;
  otwHydrant?: Hydrant | null;
  otwRoute?: [number, number][] | null;
  nearRouteIds?: Set<string> | null;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  isDark?: boolean;
  onMapMove?: () => void;
}

export default function LeafletMap({ hydrants, selectedHydrantId, onMapReady, onSelectHydrant, addHydrantMode, onMapClick, onMapBackgroundClick, pendingPin, userLocation, otwHydrant, otwRoute, nearRouteIds, initialCenter, initialZoom, isDark, onMapMove }: LeafletMapProps) {
  // Leaflet (and its zoom/pan animation frame) can throw *outside* React's
  // render cycle — an error boundary can't catch it and it escapes to `window`,
  // where Next's dev overlay grabs it. The throw is non-fatal: the map stays on
  // screen. Swallow ONLY errors originating from the map libraries so nothing
  // disappears and no error screen appears; app errors still surface normally.
  useEffect(() => {
    const fromMapLib = (stack: string, file: string) =>
      /leaflet|markercluster|supercluster/i.test(stack) ||
      /leaflet|markercluster|supercluster/i.test(file);
    const onError = (e: ErrorEvent) => {
      if (fromMapLib(e.error?.stack ?? '', e.filename ?? '')) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { stack?: string } | undefined;
      if (fromMapLib(r?.stack ?? '', '')) e.preventDefault();
    };
    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection, true);
    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onRejection, true);
    };
  }, []);

  return (
    <MapContainer
      center={[initialCenter?.lat ?? DILIMAN_CENTER.lat, initialCenter?.lng ?? DILIMAN_CENTER.lng]}
      // initialZoom arrives in Mapbox units (the app-wide convention).
      zoom={toLeafletZoom(initialZoom ?? DEFAULT_ZOOM)}
      // Floor the zoom-out: below ~3 the world wraps into multiple copies and
      // Leaflet's projection/cluster math can throw. This keeps a very wide
      // regional view available while staying in a valid range.
      minZoom={3}
      maxZoom={22}
      // Fractional zoom levels (no snap-back) so the smooth-wheel handler and
      // the eased button zoom both settle continuously instead of stair-stepping.
      zoomSnap={0}
      zoomControl={false}
      // Native wheel zoom is the discrete/jumpy one — replaced by the smooth
      // handler installed above (enabled via the smoothWheelZoom map option).
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
    >
      {/* Dark mode uses CARTO's "dark_all" basemap; light mode uses standard OSM.
          The `key` forces a clean tile-layer remount when the theme flips. */}
      {isDark ? (
        <TileLayer
          key="dark"
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          subdomains="abcd"
          maxNativeZoom={20}
          maxZoom={22}
          className="leaflet-tiles-dark"
        />
      ) : (
        <TileLayer
          key="light"
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          subdomains="abcd"
          maxNativeZoom={20}
          maxZoom={22}
        />
      )}

      {otwHydrant && userLocation && (() => {
        // Use real road route if available (coords are [lng,lat]), else straight line
        const positions: [number, number][] = otwRoute
          ? otwRoute.map(([lng, lat]) => [lat, lng])
          : [[userLocation.lat, userLocation.lng], [otwHydrant.lat, otwHydrant.lng]];
        return (
          <>
            <Polyline interactive={false} positions={positions} pathOptions={{ color: '#DC2626', weight: 16, opacity: 0.18 }} />
            <Polyline interactive={false} positions={positions} pathOptions={{ color: '#F87171', weight: 6, opacity: 0.55 }} />
            <Polyline interactive={false} positions={positions} pathOptions={{ color: '#EF4444', weight: 3, opacity: 1, dashArray: '8 8', className: 'otw-route-line' }} />
          </>
        );
      })()}

      <HydrantLayer
        hydrants={hydrants}
        selectedHydrantId={selectedHydrantId}
        onSelectHydrant={onSelectHydrant}
        addHydrantMode={addHydrantMode}
        otwHydrant={otwHydrant}
        otwRoute={otwRoute}
        nearRouteIds={nearRouteIds}
      />

      {pendingPin && (
        <Marker position={[pendingPin.lat, pendingPin.lng]} icon={pendingPinIcon} />
      )}
      {userLocation && (
        <Marker position={[userLocation.lat, userLocation.lng]} icon={userLocationIcon} />
      )}
      <MapClickHandler addHydrantMode={addHydrantMode} onMapClick={onMapClick} onMapBackgroundClick={onMapBackgroundClick} />
      <ZoomBridge onMapReady={onMapReady} />
      <MapMoveHandler onMapMove={onMapMove} />
    </MapContainer>
  );
}
