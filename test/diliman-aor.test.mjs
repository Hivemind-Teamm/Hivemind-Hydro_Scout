import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const outline = JSON.parse(readFileSync('lib/diliman-aor.json', 'utf8'));
const barangays = JSON.parse(readFileSync('lib/qc-barangays.json', 'utf8')).features;
const [ring] = outline.geometry.coordinates;

function inside(lng, lat) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}

/** Share of a barangay's boundary points that fall inside the outline. */
function shareInside(name) {
  const points = barangays.find(f => f.properties.name === name).geometry.coordinates.flatMap(polygon => polygon[0]);
  return points.filter(([lng, lat]) => inside(lng, lat)).length / points.length;
}

test('the outline is one closed ring with OpenStreetMap attribution', () => {
  assert.equal(outline.geometry.type, 'Polygon');
  assert.equal(outline.geometry.coordinates.length, 1, 'no holes');
  assert.deepEqual(ring[0], ring.at(-1));
  assert.ok(ring.length > 50 && ring.length < 1000, `${ring.length} points`);
  assert.match(outline.properties.attribution, /OpenStreetMap/);
});

test('the outline has no out-and-back spurs, like the old one up West Avenue', () => {
  const points = ring.slice(0, -1);
  const metres = ([x1, y1], [x2, y2]) => Math.hypot((x1 - x2) * 0.9675, y1 - y2) * 111_320;
  points.forEach((point, i) => {
    const before = points[(i - 1 + points.length) % points.length];
    const after = points[(i + 1) % points.length];
    assert.ok(metres(before, after) >= 1, `spur at point ${i} ${point}`);
  });
});

test('landmarks fall on the same side as the Google Maps Diliman outline', () => {
  const landmarks = {
    'Quezon Memorial Circle': [121.04929, 14.65145, true],
    'UP Diliman Oblation': [121.0652, 14.6544, true],
    'Veterans Memorial Medical Center': [121.0405, 14.6573, true],
    'Sikatuna Village': [121.0606, 14.6353, true],
    'Timog Avenue': [121.033, 14.635, true],
    'TriNoma': [121.03369, 14.65314, false],
    'SM North EDSA': [121.03132, 14.65709, false],
    'Fisher Mall': [121.01938, 14.6338, false],
    'Balara Filters': [121.082, 14.656, false],
    // North-east corner follows Commonwealth and Tandang Sora Avenues.
    'below Commonwealth Ave, near the Tandang Sora interchange': [121.0705, 14.6636, true],
    'across Commonwealth Ave': [121.0705, 14.665, false],
    // Southern edge follows Kamuning Road from Tomas Morato to EDSA.
    'just north of Kamuning Road, Sacred Heart side': [121.040, 14.62925, true],
    'just south of Kamuning Road, Kamuning side': [121.040, 14.6288, false],
  };
  for (const [name, [lng, lat, expected]] of Object.entries(landmarks)) {
    assert.equal(inside(lng, lat), expected, name);
  }
});

test('the north-west corner between Quezon Avenue and North Avenue is left out', () => {
  for (const name of ['Phil-Am', 'West Triangle']) assert.ok(shareInside(name) < 0.15, name);
  for (const name of ['Central', 'Pinyahan', 'South Triangle', 'U.P. Village', "Teachers' Village East", 'Malaya']) {
    assert.ok(shareInside(name) > 0.85, name);
  }
});
