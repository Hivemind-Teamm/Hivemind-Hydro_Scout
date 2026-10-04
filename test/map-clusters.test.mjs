import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMapClusterIndex, mapClusterLayout } from '../lib/map-clusters.ts';

const hydrants = [
  { id: 'h1', lat: 14.65, lng: 121.06 },
  { id: 'h2', lat: 14.6501, lng: 121.0601 },
];
const station = { stationId: 'station-1', lat: 14.6502, lng: 121.0602 };

test('a nearby station joins the hydrant cluster without increasing its hydrant count', () => {
  const index = createMapClusterIndex(hydrants, [station]);
  const layout = mapClusterLayout(index, 12);
  assert.equal(layout.clusters.length, 1);
  assert.equal(layout.clusters[0].count, 2);
  assert.deepEqual(layout.clusters[0].stationIds, ['station-1']);
  assert.equal(layout.clusteredStationIds.has('station-1'), true);
  assert.ok(layout.placement.get('h1'));
  const expanded = mapClusterLayout(index, 16);
  assert.equal(expanded.clusters.length, 0);
  assert.equal(expanded.clusteredStationIds.size, 0);
  assert.equal(expanded.placement.get('h1'), null);
});

test('distant and station-only groups remain individual station icons', () => {
  const distant = { ...station, stationId: 'distant', lat: 15.5, lng: 122.5 };
  const layout = mapClusterLayout(createMapClusterIndex(hydrants, [distant]), 12);
  assert.equal(layout.clusteredStationIds.size, 0);
  assert.deepEqual(layout.clusters[0].stationIds, []);
  const onlyStations = mapClusterLayout(createMapClusterIndex([], [station, { ...station, stationId: 'station-2' }]), 12);
  assert.equal(onlyStations.clusters.length, 0);
  assert.equal(onlyStations.clusteredStationIds.size, 0);
});

test('multiple stations share one badge membership and IDs cannot collide with hydrants', () => {
  const layout = mapClusterLayout(createMapClusterIndex(hydrants, [station, { ...station, stationId: 'h1' }]), 12);
  assert.equal(layout.clusters[0].count, 2);
  assert.equal(layout.clusteredStationIds.size, 2);
  assert.ok(layout.placement.get('h1'));
});

test('a new location or deletion removes station membership from its previous cluster', () => {
  for (const stations of [[], [{ ...station, lat: 15.5, lng: 122.5 }]]) {
    const layout = mapClusterLayout(createMapClusterIndex(hydrants, stations), 12);
    assert.equal(layout.clusteredStationIds.has(station.stationId), false);
    assert.deepEqual(layout.clusters[0].stationIds, []);
  }
});
