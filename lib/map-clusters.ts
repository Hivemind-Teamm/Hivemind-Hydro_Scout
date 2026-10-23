import Supercluster from 'supercluster';

type MapPoint = { id: string; lat: number; lng: number };
type PointProperties = { id: string };

export interface ClusterMarker {
  id: number;
  lng: number;
  lat: number;
  /** The bubble continues to count hydrants only. */
  count: number;
}

export type HydrantPlacement = Map<string, { lng: number; lat: number } | null>;
export interface ClusterLayout {
  clusters: ClusterMarker[];
  placement: HydrantPlacement;
}

export function createMapClusterIndex(hydrants: MapPoint[]) {
  const index = new Supercluster<PointProperties>({ radius: 60, maxZoom: 15 });
  const points: Supercluster.PointFeature<PointProperties>[] = hydrants.map(point => ({
    type: 'Feature' as const,
    properties: { id: point.id },
    geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
  }));
  index.load(points);
  return index;
}

export function mapClusterLayout(index: ReturnType<typeof createMapClusterIndex>, zoom: number): ClusterLayout {
  const clusters: ClusterMarker[] = [];
  const placement: HydrantPlacement = new Map();
  for (const feature of index.getClusters([-180, -85, 180, 85], zoom)) {
    const [lng, lat] = feature.geometry.coordinates;
    if ('cluster' in feature.properties && feature.properties.cluster) {
      const id = feature.properties.cluster_id;
      const leaves = index.getLeaves(id, Infinity);
      clusters.push({ id, lng, lat, count: leaves.length });
      for (const leaf of leaves) placement.set(leaf.properties.id, { lng, lat });
    } else {
      placement.set(feature.properties.id, null);
    }
  }
  return { clusters, placement };
}
