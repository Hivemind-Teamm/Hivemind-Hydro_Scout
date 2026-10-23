/**
 * hose-network.ts
 * The hose path for step 1 of the fire-response formula (docs/formula-spec.md):
 * the shortest way along mapped streets and paths from a hydrant to the fire.
 *
 * A hose is not traffic. It can run against a one-way street, down a
 * residents-only street and through a gate, all of which routing services
 * avoid even on foot. So the street network is read straight from
 * OpenStreetMap vector tiles and the shortest path is found here, with every
 * mapped way open in both directions.
 */

import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

/** `[lng, lat]` */
export type LngLat = [number, number];

export interface StreetPath {
  /** Along the streets, from the first point of `coordinates` to the last, in metres. */
  distanceM: number;
  /** From the point on the network nearest the hydrant to the one nearest the fire. */
  coordinates: LngLat[];
}

// ─── Street graph ─────────────────────────────────────────────────────────────

export interface StreetLine {
  points: LngLat[];
  /** 1 on a bridge, -1 in a tunnel, 0 on the ground. */
  grade: number;
}

export interface StreetGraph {
  coords: LngLat[];
  /** Per vertex: `[neighbour, metres]` pairs. Every way runs both ways. */
  adjacency: [number, number][][];
  /** Every street segment, as a pair of vertex indices. */
  segments: [number, number][];
}

/**
 * A street that ends this close to another is joined to it. Tiles round
 * points to about 0.6 m and can drop the point where a side street meets a
 * straight road, and a hose can be dragged this far anyway.
 */
export const JOIN_TOLERANCE_M = 2.5;

// Self-contained (no relative imports) so the node tests can load it directly.
function metres([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Joins street lines into a graph: where they share a point, where one ends
 * on (or within `JOIN_TOLERANCE_M` of) another, and where two ground-level
 * streets cross. Bridges and tunnels join only at their ends, so a road is
 * never connected to the bridge passing over it.
 */
export function buildStreetGraph(lines: StreetLine[]): StreetGraph {
  const coords: LngLat[] = [];
  const index = new Map<string, number>();
  const vertex = (point: LngLat) => {
    const key = `${point[0]},${point[1]}`;
    let i = index.get(key);
    if (i === undefined) {
      i = coords.push(point) - 1;
      index.set(key, i);
    }
    return i;
  };

  // Segments, once each: tiles overlap at their edges, so the same one can
  // arrive twice.
  const raw: { a: number; b: number; grade: number }[] = [];
  const seen = new Set<string>();
  for (const { points, grade } of lines) {
    for (let k = 1; k < points.length; k++) {
      const a = vertex(points[k - 1]);
      const b = vertex(points[k]);
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (a === b || seen.has(key)) continue;
      seen.add(key);
      raw.push({ a, b, grade });
    }
  }
  if (!coords.length) return { coords, adjacency: [], segments: [] };

  // Local metres for geometry; plenty accurate a few kilometres across.
  const kx = 111320 * Math.cos((coords[0][1] * Math.PI) / 180);
  const xy = (i: number) => [coords[i][0] * kx, coords[i][1] * 111320];

  // Grid of segments by bounding box, for finding neighbours quickly.
  const CELL = 25;
  const grid = new Map<string, number[]>();
  const cellsOf = (s: number, pad: number) => {
    const [ax, ay] = xy(raw[s].a);
    const [bx, by] = xy(raw[s].b);
    const keys: string[] = [];
    for (let cx = Math.floor((Math.min(ax, bx) - pad) / CELL); cx <= Math.floor((Math.max(ax, bx) + pad) / CELL); cx++) {
      for (let cy = Math.floor((Math.min(ay, by) - pad) / CELL); cy <= Math.floor((Math.max(ay, by) + pad) / CELL); cy++) {
        keys.push(`${cx},${cy}`);
      }
    }
    return keys;
  };
  raw.forEach((_, s) => {
    for (const key of cellsOf(s, 0)) {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(s);
    }
  });
  const near = (x: number, y: number, pad: number) => {
    const found = new Set<number>();
    for (let cx = Math.floor((x - pad) / CELL); cx <= Math.floor((x + pad) / CELL); cx++) {
      for (let cy = Math.floor((y - pad) / CELL); cy <= Math.floor((y + pad) / CELL); cy++) {
        for (const s of grid.get(`${cx},${cy}`) ?? []) found.add(s);
      }
    }
    return found;
  };

  // Extra vertices along each segment, by position (0–1) along it.
  const splits: [number, number][][] = raw.map(() => []);

  // Ground-level crossings that have no shared point.
  raw.forEach((s1, i) => {
    if (s1.grade !== 0) return;
    const [ax, ay] = xy(s1.a);
    const [bx, by] = xy(s1.b);
    const candidates = new Set<number>();
    for (const key of cellsOf(i, 0)) for (const j of grid.get(key) ?? []) if (j > i) candidates.add(j);
    for (const j of candidates) {
      const s2 = raw[j];
      if (s2.grade !== 0 || s2.a === s1.a || s2.a === s1.b || s2.b === s1.a || s2.b === s1.b) continue;
      const [cx, cy] = xy(s2.a);
      const [dx, dy] = xy(s2.b);
      const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (denom === 0) continue;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
      const [alng, alat] = coords[s1.a];
      const [blng, blat] = coords[s1.b];
      const v = vertex([alng + (blng - alng) * t, alat + (blat - alat) * t]);
      splits[i].push([t, v]);
      splits[j].push([u, v]);
    }
  });

  // Dead ends that stop on or just short of another street.
  const degree = new Int32Array(coords.length);
  for (const { a, b } of raw) {
    degree[a]++;
    degree[b]++;
  }
  degree.forEach((d, v) => {
    if (d !== 1) return;
    const [px, py] = xy(v);
    let best = -1;
    let bestT = 0;
    let bestD = JOIN_TOLERANCE_M;
    for (const s of near(px, py, JOIN_TOLERANCE_M)) {
      const { a, b } = raw[s];
      if (a === v || b === v) continue;
      const [ax, ay] = xy(a);
      const [bx, by] = xy(b);
      const lengthSq = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lengthSq)) : 0;
      const d = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
      if (d <= bestD) {
        best = s;
        bestT = t;
        bestD = d;
      }
    }
    if (best >= 0) splits[best].push([bestT, v]);
  });

  // Each segment becomes a chain through its extra vertices.
  const graph: StreetGraph = { coords, adjacency: coords.map(() => []), segments: [] };
  const linked = new Set<string>();
  raw.forEach(({ a, b }, s) => {
    const chain = [a, ...splits[s].sort((p, q) => p[0] - q[0]).map(([, v]) => v), b];
    for (let k = 1; k < chain.length; k++) {
      const [p, q] = [chain[k - 1], chain[k]];
      const key = p < q ? `${p}-${q}` : `${q}-${p}`;
      if (p === q || linked.has(key)) continue;
      linked.add(key);
      const length = metres(coords[p], coords[q]);
      graph.adjacency[p].push([q, length]);
      graph.adjacency[q].push([p, length]);
      graph.segments.push([p, q]);
    }
  });
  return graph;
}

interface Snap {
  segment: number;
  point: LngLat;
}

/** The point on the network nearest `point`. */
function snap(graph: StreetGraph, point: LngLat): Snap | null {
  // Planar, with longitude scaled by latitude: plenty for picking the
  // nearest segment a few hundred metres across.
  const kx = Math.cos((point[1] * Math.PI) / 180);
  let best: Snap | null = null;
  let bestD2 = Infinity;
  graph.segments.forEach(([a, b], segment) => {
    const [ax, ay] = graph.coords[a];
    const [bx, by] = graph.coords[b];
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const px = (point[0] - ax) * kx;
    const py = point[1] - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq)) : 0;
    const d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { segment, point: [ax + (bx - ax) * t, ay + (by - ay) * t] };
    }
  });
  return best;
}

/**
 * Shortest path along the network between the points nearest `from` and `to`,
 * or `null` when they are not connected (or there is no network).
 */
export function shortestStreetPath(graph: StreetGraph, from: LngLat, to: LngLat): StreetPath | null {
  const start = snap(graph, from);
  const end = snap(graph, to);
  if (!start || !end) return null;

  // Two extra vertices for the snapped points, joined to the ends of their
  // segments (and to each other when they share one).
  const S = graph.coords.length;
  const T = S + 1;
  const coords = [...graph.coords, start.point, end.point];
  const extra = new Map<number, [number, number][]>();
  const link = (a: number, b: number) => {
    const length = metres(coords[a], coords[b]);
    if (!extra.has(a)) extra.set(a, []);
    if (!extra.has(b)) extra.set(b, []);
    extra.get(a)!.push([b, length]);
    extra.get(b)!.push([a, length]);
  };
  for (const [v, s] of [[S, start], [T, end]] as const) {
    const [a, b] = graph.segments[s.segment];
    link(v, a);
    link(v, b);
  }
  if (start.segment === end.segment) link(S, T);

  // Dijkstra with a binary heap.
  const dist = new Float64Array(coords.length).fill(Infinity);
  const prev = new Int32Array(coords.length).fill(-1);
  const heap: [number, number][] = [];
  const push = (item: [number, number]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  dist[S] = 0;
  push([0, S]);
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    if (v === T) break;
    for (const [w, length] of [...(graph.adjacency[v] ?? []), ...(extra.get(v) ?? [])]) {
      if (d + length < dist[w]) {
        dist[w] = d + length;
        prev[w] = v;
        push([dist[w], w]);
      }
    }
  }
  if (dist[T] === Infinity) return null;

  const path: LngLat[] = [];
  for (let v = T; v !== -1; v = prev[v]) path.push(coords[v]);
  path.reverse();
  // A route needs two points even when both ends snap to the same spot.
  if (path.length === 1) path.push(path[0]);
  return { distanceM: dist[T], coordinates: path };
}

// ─── Streets from vector tiles ────────────────────────────────────────────────

/** OpenFreeMap's OpenMapTiles TileJSON, the source the MapLibre map draws from. */
export const STREET_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const ZOOM = 14;
/** Never fetch more than this many tiles for one lookup. */
const MAX_TILES = 9;

// `transportation` classes a hose cannot be laid along: grade-separated
// motorways, rail and transit lines, ferries, cable cars, race tracks.
const NOT_FOR_HOSE = new Set(['motorway', 'rail', 'transit', 'ferry', 'aerialway', 'raceway', 'bus_guideway']);

/**
 * Street lines in one decoded tile's `transportation` layer, as `[lng, lat]`.
 * Points are built from the zoom-wide integer grid, so a point shared by two
 * tiles comes out identical in both and joins up in the graph.
 */
export function streetLinesFromTile(tile: VectorTile, x: number, y: number, z: number): StreetLine[] {
  const layer = tile.layers.transportation;
  if (!layer) return [];
  const size = layer.extent * 2 ** z;
  const toLngLat = (px: number, py: number): LngLat => {
    const gx = x * layer.extent + px;
    const gy = y * layer.extent + py;
    return [(gx / size) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / size))) * 180) / Math.PI];
  };
  const lines: StreetLine[] = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const { class: kind, indoor, expressway, brunnel } = feature.properties;
    if (feature.type !== 2 || NOT_FOR_HOSE.has(String(kind)) || indoor === 1 || expressway === 1) continue;
    const grade = brunnel === 'bridge' ? 1 : brunnel === 'tunnel' ? -1 : 0;
    for (const line of feature.loadGeometry()) {
      if (line.length > 1) lines.push({ points: line.map((point) => toLngLat(point.x, point.y)), grade });
    }
  }
  return lines;
}

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

export interface StreetNetworkDependencies {
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  signal: AbortSignal;
}

/**
 * The hose path from `hydrant` to `fire` along the street network, or `null`
 * when the tiles cannot be loaded or hold no connected path.
 */
export async function fetchStreetPath(hydrant: LngLat, fire: LngLat, deps: StreetNetworkDependencies): Promise<StreetPath | null> {
  const { fetch, signal } = deps;
  // Room around the two points for the path to bend: half their distance,
  // and at least 300 m.
  const padM = Math.max(300, metres(hydrant, fire) / 2);
  const padLat = padM / 111320;
  const padLng = padLat / Math.cos((hydrant[1] * Math.PI) / 180);
  const west = Math.min(hydrant[0], fire[0]) - padLng;
  const east = Math.max(hydrant[0], fire[0]) + padLng;
  const south = Math.min(hydrant[1], fire[1]) - padLat;
  const north = Math.max(hydrant[1], fire[1]) + padLat;
  const [x0, x1, y0, y1] = [tileX(west, ZOOM), tileX(east, ZOOM), tileY(north, ZOOM), tileY(south, ZOOM)];
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return null;

  const tileJson = await (await fetch(STREET_TILEJSON_URL, { signal })).json() as { tiles?: unknown };
  const template = Array.isArray(tileJson.tiles) ? tileJson.tiles[0] : undefined;
  if (typeof template !== 'string') return null;

  const requests: Promise<StreetLine[]>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const url = template.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
      requests.push(fetch(url, { signal }).then(async (response) => {
        if (!response.ok) throw new Error(`tile ${x}/${y}: ${response.status}`);
        return streetLinesFromTile(new VectorTile(new Pbf(await response.arrayBuffer())), x, y, ZOOM);
      }));
    }
  }
  // Every tile is needed: a missing one could hide the shortest way.
  const lines = (await Promise.all(requests)).flat();
  return shortestStreetPath(buildStreetGraph(lines), hydrant, fire);
}
