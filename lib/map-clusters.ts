import Supercluster from 'supercluster';

type MapPoint = { id: string; lat: number; lng: number };
type StationPoint = { stationId: string; lat: number; lng: number };
type PointProperties = { kind: 'hydrant' | 'station'; id: string };

export interface ClusterMarker {
  id: number;
  lng: number;
  lat: number;
  /** The bubble continues to count hydrants only. */
  count: number;
  stationIds: string[];
}

export type HydrantPlacement = Map<string, { lng: number; lat: number } | null>;
export interface ClusterLayout {
  clusters: ClusterMarker[];
  placement: HydrantPlacement;
  clusteredStationIds: Set<string>;
}

export function createMapClusterIndex(hydrants: MapPoint[], stations: StationPoint[]) {
  const index = new Supercluster<PointProperties>({ radius: 60, maxZoom: 15 });
  const points: Supercluster.PointFeature<PointProperties>[] = [
    ...hydrants.map(point => ({ type: 'Feature' as const,
      properties: { kind: 'hydrant' as const, id: point.id },
      geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] } })),
    ...stations.map(point => ({ type: 'Feature' as const,
      properties: { kind: 'station' as const, id: point.stationId },
      geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] } })),
  ];
  index.load(points);
  return index;
}

export function mapClusterLayout(index: ReturnType<typeof createMapClusterIndex>, zoom: number): ClusterLayout {
  const clusters: ClusterMarker[] = [];
  const placement: HydrantPlacement = new Map();
  const clusteredStationIds = new Set<string>();
  for (const feature of index.getClusters([-180, -85, 180, 85], zoom)) {
    const [lng, lat] = feature.geometry.coordinates;
    if ('cluster' in feature.properties && feature.properties.cluster) {
      const id = feature.properties.cluster_id;
      const leaves = index.getLeaves(id, Infinity);
      const hydrants = leaves.filter(leaf => leaf.properties.kind === 'hydrant');
      // Stations without nearby hydrants remain individual station pins.
      if (!hydrants.length) continue;
      const stationIds = leaves.filter(leaf => leaf.properties.kind === 'station').map(leaf => leaf.properties.id);
      clusters.push({ id, lng, lat, count: hydrants.length, stationIds });
      for (const leaf of hydrants) placement.set(leaf.properties.id, { lng, lat });
      for (const stationId of stationIds) clusteredStationIds.add(stationId);
    } else if (feature.properties.kind === 'hydrant') {
      placement.set(feature.properties.id, null);
    }
  }
  return { clusters, placement, clusteredStationIds };
}
