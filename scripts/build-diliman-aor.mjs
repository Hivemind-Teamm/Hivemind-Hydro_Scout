// build-diliman-aor.mjs
//
// Regenerates lib/diliman-aor.json: the outline of the Diliman area of
// responsibility (the thesis scope) drawn on the dashboard maps.
//
// It is OpenStreetMap's Diliman boundary (relation 17877944) without its
// north-west corner between Quezon Avenue and North Avenue (Phil-Am, West
// Triangle, Bagong Pag-asa, and Project 6 below North Avenue), and with its
// north-east corner following Commonwealth and Tandang Sora Avenues instead of
// cutting straight across. That is the Diliman outline Google Maps shows.
// The barangays come from lib/qc-barangays.json. Data © OpenStreetMap
// contributors (ODbL).
//
//   node scripts/build-diliman-aor.mjs                   # fetch Diliman from Nominatim
//   node scripts/build-diliman-aor.mjs diliman.geojson   # use a saved Nominatim lookup
//
// Uses martinez-polygon-clipping, installed with mapbox-gl.
import { readFile, writeFile } from 'node:fs/promises';
import { diff, intersection, union } from 'martinez-polygon-clipping';

const OUTPUT = new URL('../lib/diliman-aor.json', import.meta.url);
const BARANGAYS = new URL('../lib/qc-barangays.json', import.meta.url);
const DILIMAN_LOOKUP = 'https://nominatim.openstreetmap.org/lookup?osm_ids=R17877944&format=geojson&polygon_geojson=1';
const REMOVED_BARANGAYS = ['Phil-Am', 'West Triangle', 'Bagong Pag-asa'];

// North Avenue from EDSA to the Elliptical Road, along Project 6's border.
// Everything of Project 6 south of it (the parks by the circle) is removed.
const NORTH_AVE = [[121.035139, 14.654527], [121.038583, 14.65376], [121.043072, 14.652785], [121.046508, 14.652026]];
const SOUTH_OF_NORTH_AVE = [[
  [121.025, 14.6567], ...NORTH_AVE, [121.055, 14.6501], [121.055, 14.63], [121.025, 14.63], [121.025, 14.6567],
]];

// South side of Commonwealth Avenue from Central Avenue to the Tandang Sora
// interchange, then down Tandang Sora Avenue, west to east. Both ends are
// points of OSM's Diliman boundary; the edge replaces its straight cut between
// them. From OSM relation 3304424 (a parish boundary that follows these roads).
const COMMONWEALTH_TANDANG_SORA = [
  [121.065781, 14.662263], [121.068429, 14.663982], [121.068865, 14.663953], [121.069144, 14.663941],
  [121.069217, 14.663939], [121.069307, 14.663937], [121.069397, 14.663935], [121.069503, 14.663937],
  [121.069608, 14.663944], [121.069697, 14.663962], [121.069834, 14.663997], [121.069928, 14.664024],
  [121.070612, 14.664221], [121.070992, 14.664331], [121.071254, 14.664407], [121.071329, 14.664424],
  [121.071385, 14.664433], [121.071455, 14.664443], [121.071471, 14.664445], [121.071489, 14.664445],
  [121.071517, 14.664444], [121.071576, 14.66444], [121.071641, 14.66443], [121.071694, 14.664417],
  [121.071731, 14.664407], [121.071763, 14.664396], [121.071795, 14.664384], [121.072695, 14.664141],
  [121.073692, 14.663652], [121.073831, 14.663571], [121.073892, 14.66353], [121.073937, 14.663496],
  [121.073983, 14.66346], [121.074055, 14.663398],
];

// ~1 m at Manila's latitude, as in build-barangay-boundaries.mjs.
const TOLERANCE = 0.00001;
const round = value => Math.round(value * 1e6) / 1e6;
const metres = ([x1, y1], [x2, y2]) => Math.hypot((x1 - x2) * Math.cos(14.65 * Math.PI / 180), y1 - y2) * 111_320;

/** Replaces the shorter stretch of a closed ring between the edge's two ends with the edge. */
function spliceEdge(ring, edge) {
  const open = ring.slice(0, -1);
  const indexOf = point => open.findIndex(p => metres(p, point) < 2);
  const start = indexOf(edge[0]);
  const end = indexOf(edge.at(-1));
  if (start < 0 || end < 0) throw new Error('Commonwealth/Tandang Sora edge no longer meets the Diliman boundary.');
  const arc = (from, to) => {
    const points = [];
    for (let i = from; ; i = (i + 1) % open.length) {
      points.push(open[i]);
      if (i === to) return points;
    }
  };
  const forward = arc(start, end);
  const backward = arc(end, start);
  // Keep the long way round; the edge closes it.
  const spliced = forward.length > backward.length
    ? [...forward, ...edge.slice(1, -1).reverse()]
    : [...backward, ...edge.slice(1, -1)];
  return [...spliced, spliced[0]];
}

function distanceToSegment([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Douglas–Peucker line simplification. */
function simplify(points) {
  if (points.length < 3) return points;
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i], points[0], points.at(-1));
    if (distance > max) { index = i; max = distance; }
  }
  if (max <= TOLERANCE) return [points[0], points.at(-1)];
  return simplify(points.slice(0, index + 1)).slice(0, -1).concat(simplify(points.slice(index)));
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(area / 2);
}

async function loadDiliman() {
  const text = process.argv[2]
    ? await readFile(process.argv[2], 'utf8')
    : await (await fetch(DILIMAN_LOOKUP, { headers: { 'User-Agent': 'HydroScout-boundaries/1.0' } })).text();
  const geometry = JSON.parse(text).features[0].geometry;
  if (geometry.type !== 'Polygon') throw new Error(`Expected Diliman as one polygon, got ${geometry.type}.`);
  return geometry.coordinates;
}

const diliman = await loadDiliman();
const barangays = JSON.parse(await readFile(BARANGAYS, 'utf8')).features;
const polygonsOf = name => {
  const feature = barangays.find(item => item.properties.name === name);
  if (!feature) throw new Error(`Barangay ${name} is missing from qc-barangays.json.`);
  return feature.geometry.coordinates;
};

let removed = intersection(polygonsOf('Project 6'), SOUTH_OF_NORTH_AVE);
for (const name of REMOVED_BARANGAYS) removed = union(removed, polygonsOf(name));

// The barangays are simplified slightly differently from Diliman, so the cut
// can leave metre-wide slivers along shared borders: keep the main area only.
const pieces = diff(diliman, removed);
const outer = pieces.map(polygon => polygon[0]).sort((a, b) => ringArea(b) - ringArea(a))[0];
const ring = simplify(spliceEdge(outer, COMMONWEALTH_TANDANG_SORA)).map(([x, y]) => [round(x), round(y)]);
if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ring.push(ring[0]);

const feature = {
  type: 'Feature',
  properties: {
    name: 'Diliman',
    source: 'OpenStreetMap relation 17877944 without Phil-Am, West Triangle, Bagong Pag-asa and Project 6 south of North Avenue, '
      + 'following Commonwealth and Tandang Sora Avenues in the north-east',
    attribution: '© OpenStreetMap contributors (ODbL)',
  },
  geometry: { type: 'Polygon', coordinates: [ring] },
};
await writeFile(OUTPUT, JSON.stringify(feature));
console.log(`Wrote lib/diliman-aor.json: ${ring.length} points (${pieces.length} piece(s) before cleanup).`);
