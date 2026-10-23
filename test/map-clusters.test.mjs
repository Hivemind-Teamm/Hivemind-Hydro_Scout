import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMapClusterIndex, mapClusterLayout } from '../lib/map-clusters.ts';

const hydrants = [
  { id: 'h1', lat: 14.65, lng: 121.06 },
  { id: 'h2', lat: 14.6501, lng: 121.0601 },
];
test('clusters contain hydrants only', () => {
  const index = createMapClusterIndex(hydrants);
  const layout = mapClusterLayout(index, 12);
  assert.equal(layout.clusters.length, 1);
  assert.equal(layout.clusters[0].count, 2);
  assert.ok(layout.placement.get('h1'));
  const expanded = mapClusterLayout(index, 16);
  assert.equal(expanded.clusters.length, 0);
  assert.equal(expanded.placement.get('h1'), null);
});

test('live location markers are outside the hydrant cluster index', () => {
  const index = createMapClusterIndex(hydrants);
  const layout = mapClusterLayout(index, 12);
  assert.deepEqual(layout.clusters.map(cluster => cluster.count), [2]);
  assert.equal(index.getClusters([-180, -85, 180, 85], 12).length, 1);
});

test('live location devices remain outside hydrant clustering', () => {
  const devices = [
    { id: 'device-1', stationId: 'station-1', lat: 14.6502, lng: 121.0602 },
    { id: 'device-2', stationId: 'station-1', lat: 14.6503, lng: 121.0603 },
  ];

  const index = createMapClusterIndex(hydrants);
  const layout = mapClusterLayout(index, 12);

  assert.equal(layout.clusters.length, 1);
  assert.equal(layout.clusters[0].count, 2);

  // Different devices retain their identities outside the cluster index.
  assert.equal(new Set(devices.map(device => device.id)).size, 2);

  // Only the two hydrants appear in the clustering index.
  assert.equal(index.getClusters([-180, -85, 180, 85], 12).length, 1);
});