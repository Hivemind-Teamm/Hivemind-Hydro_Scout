'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, { Marker, type MapRef, type MarkerEvent } from 'react-map-gl/mapbox';
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
}

export default function DilimanMap({
  hydrants, selectedHydrantId, onLoad, onError, onMapReady,
  onSelectHydrant, addHydrantMode, onMapClick, onMapBackgroundClick, pendingPin,
}: DilimanMapProps) {
  const mapRef = useRef<MapRef>(null);
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

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.resize();
    setClusterZoom(clusterLevel(map.getZoom()));
    onMapReady?.({
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      flyTo: (lat, lng, zoom = 17) => map.flyTo({ center: [lng, lat], zoom, speed: 1.4 }),
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
          longitude: DILIMAN_CENTER.lng,
          latitude: DILIMAN_CENTER.lat,
          zoom: DEFAULT_ZOOM,
        }}
        style={{ position: 'absolute', inset: 0 }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
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
                background: '#FED42E',
                border: '3px solid #91191E',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 3px 10px rgba(0,0,0,0.45)',
                color: '#91191E',
                fontSize: 13,
                fontWeight: 800,
                fontFamily: 'Arial, sans-serif',
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
      </MapGL>
    </div>
  );
}
