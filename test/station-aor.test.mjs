import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { barangayAt, barangayNames } from '../lib/barangay-boundaries.ts';
import { STATION_AOR_PRESETS, aorPresetFor, aorStationIdForProfile, canWriteInAor } from '../lib/station-aor.ts';

const boundaries = JSON.parse(readFileSync('lib/qc-barangays.json', 'utf8'));
const hydrants = JSON.parse(readFileSync('scripts/hydrant-data.json', 'utf8'));
const at = id => {
  const hydrant = hydrants.find(item => item.hydrantId === id);
  return barangayAt(boundaries, hydrant.latitude, hydrant.longitude);
};

test('boundaries cover all 142 Quezon City barangays with PSGC codes', () => {
  const names = barangayNames(boundaries);
  assert.equal(names.length, 142);
  assert.equal(new Set(names).size, 142);
  // Current 10-digit PSGC codes; a few OSM boundaries still carry the pre-2023 9-digit code.
  assert.ok(boundaries.features.every(feature => /^(13813\d{5}|137404\d{3})$/.test(feature.properties.psgc ?? '')));
});

test('every preset barangay is a real boundary name and no barangay has two stations', () => {
  const names = new Set(barangayNames(boundaries));
  const seen = new Set();
  for (const preset of STATION_AOR_PRESETS) {
    for (const barangay of preset.barangays) {
      assert.ok(names.has(barangay), `${preset.label}: "${barangay}" is not in lib/qc-barangays.json`);
      assert.ok(!seen.has(barangay), `${barangay} appears in two presets`);
      seen.add(barangay);
    }
  }
  assert.equal(seen.size, 18);
});

test('presets match station names', () => {
  assert.equal(aorPresetFor('Krus Na Ligas Fire Station')?.key, 'krus-na-ligas');
  assert.equal(aorPresetFor('LAGING HANDA FS')?.key, 'laging-handa');
  assert.equal(aorPresetFor('Paligsahan')?.key, 'paligsahan');
  assert.equal(aorPresetFor('Central Fire Station')?.key, 'central');
  assert.equal(aorPresetFor('Holy Spirit Fire Station'), null);
});

test('surveyed hydrants resolve to the barangay their address names', () => {
  assert.equal(at('HYD-018'), 'Central');          // Kalayaan Ave
  assert.equal(at('HYD-036'), 'Paligsahan');       // Mother Ignacia Ave
  assert.equal(at('HYD-005'), 'U.P. Campus');      // Asian Institute of Tourism
  assert.equal(at('HYD-015'), 'East Kamias');      // K-9th Street, East Kamias
  assert.equal(at('HYD-028'), 'South Triangle');   // Tomas Morato, South Triangle
  assert.equal(at('HYD-032'), 'Laging Handa');     // Sct. Fuentebella
  // Every surveyed hydrant is inside exactly one Quezon City barangay.
  for (const hydrant of hydrants) assert.ok(at(hydrant.hydrantId), `${hydrant.hydrantId} has no barangay`);
});

test('points outside Quezon City have no barangay', () => {
  assert.equal(barangayAt(boundaries, 14.5547, 121.0244), null); // Makati CBD
  assert.equal(barangayAt(boundaries, NaN, 121), null);
});

test('AOR station follows the rules: station account or approved member only', () => {
  assert.equal(aorStationIdForProfile({ accountType: 'station', stationId: 'KNL' }), 'KNL');
  assert.equal(aorStationIdForProfile({ accountType: 'person', stationId: 'KNL', stationMembershipStatus: 'approved' }), 'KNL');
  assert.equal(aorStationIdForProfile({ accountType: 'person', stationId: 'KNL', stationMembershipStatus: 'pending' }), null);
  assert.equal(aorStationIdForProfile({ accountType: 'station', stationId: '../KNL' }), null);
  assert.equal(aorStationIdForProfile(null), null);
});

test('UI write check mirrors the rules', () => {
  const knl = ['Krus na Ligas', 'U.P. Campus'];
  assert.equal(canWriteInAor('admin', [], 'Laging Handa'), true);
  assert.equal(canWriteInAor('admin', [], null), true);
  assert.equal(canWriteInAor('head', knl, 'U.P. Campus'), true);
  assert.equal(canWriteInAor('head', knl, 'Laging Handa'), false);
  assert.equal(canWriteInAor('authorized', knl, 'Krus na Ligas'), true);
  assert.equal(canWriteInAor('head', knl, 'Unassigned'), false);
  assert.equal(canWriteInAor('general', knl, 'U.P. Campus'), false);
});
