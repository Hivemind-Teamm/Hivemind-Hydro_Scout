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
// per wheel notch, so fast scrolling reads as a fragmented stair-step. We
// replace it with a continuous, eased zoom (the well-known SmoothWheelZoom
// technique) that keeps the point under the cursor *at gesture start* pinned —
// Mapbox-like. It lives in the <SmoothWheelZoom/> map child at the bottom of
// this file, NOT as a global `L.Map.addInitHook`: Leaflet's `L` is a singleton
// that survives Next.js Fast Refresh, so a module-level install patches it once
// and never updates on edit (tweaks silently did nothing until a hard reload),
// and a stale install could double up with a new one. Keeping the whole
// algorithm in component code makes it hot-reloadable and collision-free.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Crisp vector paths during continuous zoom ──────────────────────────────
// On the `zoom` event Leaflet's SVG renderer only CSS-*scales* its whole <svg>
// container (`_updateTransform`) and re-projects the actual path geometry just
// once, on `moveend`. Our smooth-wheel and eased animations drive zoom every
// frame via `map._move` (which fires `zoom` continuously but never `moveend`
// until the very end), so the OTW route polyline gets scaled up for the entire
// gesture — it "stays big" and only snaps to the right size a beat after you
// stop. Markers already re-project on every `zoom` (that's why they track the
// map perfectly); make vector paths do the same by fully re-projecting
// (`_reset`) on each `zoom` instead of scaling. The route now tracks the map
// crisply and instantly, exactly like the Mapbox GL line. Native CSS zoom
// animations (e.g. fitBounds) still use `zoomanim` for their smooth tween and
// only hit this at the end, so they're unaffected. Patched once, globally.
function installCrispVectorZoom(Lref: any) {
  if (Lref.SVG._hsCrispZoom) return;
  Lref.SVG._hsCrispZoom = true;
  Lref.SVG.prototype._onZoom = function () { this._reset(); };
}
installCrispVectorZoom(L);

// ── Sub-pixel marker positions during continuous zoom ──────────────────────
// `Marker.update()` (fired on every `zoom` event) *rounds* the marker's layer
// point to a whole pixel. Native Leaflet zoom/pan never notices because it
// moves the entire pane with one CSS transform — markers aren't re-projected
// per frame. Our eased click-to-zoom and wheel-zoom drive `_move` every frame,
// so each frame re-projects and re-*rounds* every marker while the tiles scale
// sub-pixel-smoothly: the ±0.5px snapping reads as the pins shivering for the
// whole zoom (but not while panning, which is a pure pane translate). Drop the
// rounding so pins track the map at sub-pixel precision, exactly like the
// Mapbox markers. translate3d keeps them GPU-crisp at rest. Patched once.
function installSmoothMarkerZoom(Lref: any) {
  if (Lref.Marker._hsSmoothZoom) return;
  Lref.Marker._hsSmoothZoom = true;
  Lref.Marker.prototype.update = function () {
    if (this._icon && this._map) {
      this._setPos(this._map.latLngToLayerPoint(this._latlng));
    }
    return this;
  };
}
installSmoothMarkerZoom(L);

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
  // The `data` arg matters: passing `{ flyTo: true }` routes the tile layer
  // through its lightweight, GPU-transform-only zoom path (no per-frame grid
  // rebuild against a rounded pixel origin), exactly like Leaflet's own flyTo.
  // Without it the whole map shivers for the duration of a programmatic zoom.
  _move: (center: L.LatLng, zoom: number, data?: { flyTo?: boolean; pinch?: boolean }) => void;
  _moveEnd: (zoomChanged: boolean) => void;
  _stop: () => void;
};

// Passed as `_move`'s data during eased frames — see the comment above.
const SMOOTH_MOVE = { flyTo: true } as const;

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
    if (t < 1) {
      // Mid-flight: lightweight GPU-transform tile path (no shiver).
      m._move(center, zoom, SMOOTH_MOVE);
      m._hsAnim = requestAnimationFrame(frame);
    } else {
      // Settle with a full `_move` so the tile grid rebuilds/prunes cleanly.
      m._hsAnim = undefined;
      m._hsCleanup?.();
      m._hsCleanup = undefined;
      m._move(center, zoom);
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
    // Spout is baked in hidden; the positioner reveals it only for the selected
    // (or OTW-target) pin, so at rest the map isn't a field of spraying water.
    content =
      `<img src="${iconUrl}" width="${W}" height="${H}" style="${imgStyle}" />` +
      `<div class="hydrant-fx" style="display:none;"><div class="hydrant-spout ${power}">` +
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

// Mapbox-parity continuous wheel zoom (see the note at the top of the file for
// why this is a component and not a global L.Handler). Accumulates wheel delta
// into a goal zoom and eases the map toward it each frame via the internal
// `_move`, keeping the point that was under the cursor WHEN THE GESTURE BEGAN
// pinned for the whole gesture — moving the mouse mid-scroll can't drag the map
// toward the cursor, which is what made the old handler feel jittery / like it
// "zoomed to the cursor". Requires `scrollWheelZoom={false}` on the container
// so Leaflet's discrete native handler doesn't also fire.
function SmoothWheelZoom() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const m = map as AnimatableMap;

    // Defensive: if an earlier dev session installed the old *global* handler on
    // Leaflet's singleton, disable it so two zoomers don't run at once.
    const legacy = (map as unknown as { smoothWheelZoom?: { disable?: () => void } }).smoothWheelZoom;
    legacy?.disable?.();

    let active = false;                    // rAF loop running
    let gesture = false;                   // wheel still spinning
    let goalZoom = 0;
    let wheelMouse = L.point(0, 0);        // cursor px, FROZEN at gesture start
    let centerPoint = L.point(0, 0);
    let startLatLng = map.getCenter();     // latlng under the cursor at start
    let prevCenter = map.getCenter();
    let prevZoom = 0;
    let lastTs = 0;
    let rafId = 0;
    let idleTimer = 0;
    let lastWheelTs = 0;
    // A gap longer than this between wheel ticks starts a fresh gesture and
    // re-pins the anchor to the current cursor — so after you pause and move the
    // mouse, the next scroll zooms toward the new spot immediately instead of
    // waiting ~1s for the previous glide to fully settle (Mapbox-like). Ticks
    // closer than this stay pinned to the original point, so a continuous scroll
    // still can't chase tiny cursor drifts.
    const REANCHOR_MS = 180;

    const stop = () => { active = false; gesture = false; cancelAnimationFrame(rafId); };

    const frame = (now: number) => {
      // Bail if some other interaction moved the map out from under us.
      if (!map.getCenter().equals(prevCenter) || map.getZoom() !== prevZoom) { stop(); return; }
      // Frame-rate-independent exponential glide toward the goal — no steps.
      const dt = lastTs ? now - lastTs : 16.7;
      lastTs = now;
      const k = 1 - Math.exp((-dt / 1000) * 9);
      let zoom = map.getZoom() + (goalZoom - map.getZoom()) * k;
      // Keep gliding until fully converged once the wheel is idle; ending early
      // is what made the tail of each scroll feel like a jump.
      const done = !gesture && Math.abs(goalZoom - zoom) < 0.003;
      if (done) zoom = goalZoom;
      // Recentre so the frozen cursor pixel stays pinned as the zoom eases.
      const delta = wheelMouse.subtract(centerPoint);
      const center = map.unproject(map.project(startLatLng, zoom).subtract(delta), zoom);
      // Mid-gesture uses the lightweight GPU-transform tile path so the map
      // doesn't shiver; the final frame settles with a full `_move`.
      m._move(center, zoom, done ? undefined : SMOOTH_MOVE);
      prevCenter = map.getCenter();
      prevZoom = map.getZoom();
      if (done) { active = false; m._moveEnd(true); return; }
      rafId = requestAnimationFrame(frame);
    };

    const onWheel = (e: WheelEvent) => {
      // Start a fresh gesture on the first tick, or when there's been a pause
      // since the last one — both re-pin the anchor to the current cursor.
      const reanchor = !active || e.timeStamp - lastWheelTs > REANCHOR_MS;
      lastWheelTs = e.timeStamp;
      if (reanchor) {
        // Freeze the anchor: cursor pixel + the latlng under it, captured once
        // per gesture. Rebase the goal onto the current (maybe mid-glide) zoom
        // so re-anchoring hands off smoothly with no jump.
        wheelMouse = map.mouseEventToContainerPoint(e);
        centerPoint = map.getSize().divideBy(2);
        startLatLng = map.containerPointToLatLng(wheelMouse);
        goalZoom = map.getZoom();
        if (!active) {
          active = true;
          m._stop();
          prevCenter = map.getCenter();
          prevZoom = map.getZoom();
          lastTs = 0;
          rafId = requestAnimationFrame(frame);
        }
      }
      // Normalise line-mode deltas (Firefox) to ~pixel scale.
      const dy = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      goalZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), goalZoom - dy * 0.0035));
      gesture = true;
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => { gesture = false; }, 180);
      e.preventDefault();
      e.stopPropagation();
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
      clearTimeout(idleTimer);
      stop();
    };
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

      // Water only spouts from the pin the user is focused on — the selected
      // hydrant, or the OTW routing target. Everything else sits dry.
      const showSpout = !clustered && (selectedHydrantId === h.id || isOtwTarget);
      const fx = wrapper.querySelector('.hydrant-fx') as HTMLElement | null;
      if (fx) fx.style.display = showSpout ? 'block' : 'none';

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
      // Native wheel zoom is the discrete/jumpy one — disabled here and replaced
      // by the continuous <SmoothWheelZoom/> child rendered below.
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
      <SmoothWheelZoom />
    </MapContainer>
  );
}
