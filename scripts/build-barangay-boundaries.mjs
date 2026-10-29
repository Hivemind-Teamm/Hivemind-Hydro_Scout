// build-barangay-boundaries.mjs
//
// Regenerates lib/qc-barangays.json: the 142 Quezon City barangay boundaries
// used to derive hydrants/{id}.barangay and to edit station AORs.
//
// Source: OpenStreetMap administrative boundaries (admin_level=10) inside
// Quezon City, via the Overpass API. Data © OpenStreetMap contributors (ODbL).
// Each feature keeps the barangay's PSGC code (OSM `ref`).
//
//   node scripts/build-barangay-boundaries.mjs              # fetch from Overpass
//   node scripts/build-barangay-boundaries.mjs dump.json    # use a saved `out geom` dump
//
// Renaming a barangay here changes the strings stored in Firestore; existing
// hydrants and station AORs would then need the same rename.

import { readFile, writeFile } from 'node:fs/promises';

const OUTPUT = new URL('../lib/qc-barangays.json', import.meta.url);
const QUERY = '[out:json][timeout:170];area["name"="Quezon City"]["admin_level"="6"]->.qc;'
  + 'rel(area.qc)["boundary"="administrative"]["admin_level"="10"];out geom;';
// ~1 m at Manila's latitude. Streets are often barangay borders, so keep it tight.
const TOLERANCE = 0.00001;

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Join way coordinate lists into closed rings by matching endpoints. */
function stitch(ways) {
  const pending = ways.filter(way => way.length >= 2).map(way => [...way]);
  const rings = [];
  while (pending.length) {
    let ring = pending.shift();
    let changed = true;
    while (!same(ring[0], ring.at(-1)) && changed) {
      changed = false;
      for (let i = 0; i < pending.length; i++) {
        const way = pending[i];
        if (same(way[0], ring.at(-1))) ring = ring.concat(way.slice(1));
        else if (same(way.at(-1), ring.at(-1))) ring = ring.concat([...way].reverse().slice(1));
        else if (same(way.at(-1), ring[0])) ring = way.slice(0, -1).concat(ring);
        else if (same(way[0], ring[0])) ring = [...way].reverse().slice(0, -1).concat(ring);
        else continue;
        pending.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (!same(ring[0], ring.at(-1))) throw new Error('Boundary ring does not close.');
    rings.push(ring);
  }
  return rings;
}

function distanceToSegment([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
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

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const round = value => Math.round(value * 1e6) / 1e6;

async function loadElements() {
  if (process.argv[2]) return JSON.parse(await readFile(process.argv[2], 'utf8')).elements;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'HydroScout-boundaries/1.0' },
    body: new URLSearchParams({ data: QUERY }),
  });
  if (!response.ok) throw new Error(`Overpass request failed: ${response.status}`);
  return (await response.json()).elements;
}

const elements = (await loadElements()).sort((a, b) => a.tags.name.localeCompare(b.tags.name, 'en'));
const features = elements.map(relation => {
  const ways = { outer: [], inner: [] };
  for (const member of relation.members) {
    if (member.type === 'way' && member.role in ways) {
      ways[member.role].push(member.geometry.map(point => [round(point.lon), round(point.lat)]));
    }
  }
  const outers = stitch(ways.outer);
  const inners = stitch(ways.inner);
  const coordinates = outers.map(outer => [outer, ...inners.filter(hole => ringContains(outer, ...hole[0]))]
    .map(ring => {
      const simplified = simplify(ring);
      if (!same(simplified[0], simplified.at(-1))) simplified.push(simplified[0]);
      return simplified.map(([x, y]) => [round(x), round(y)]);
    }));
  return {
    type: 'Feature',
    properties: { name: relation.tags.name, psgc: relation.tags.ref ?? null },
    geometry: { type: 'MultiPolygon', coordinates },
  };
});

if (features.length !== 142) throw new Error(`Expected 142 Quezon City barangays, got ${features.length}.`);
await writeFile(OUTPUT, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`Wrote ${features.length} barangays to lib/qc-barangays.json`);
