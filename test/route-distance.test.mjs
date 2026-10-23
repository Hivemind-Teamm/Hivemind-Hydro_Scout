import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchHoseRoute } from '../lib/route-distance.ts';
import { haversineM } from '../lib/haversine.ts';

const hydrant = { lat: 14.65, lng: 121.06 };
const fire = { lat: 14.652, lng: 121.062 };
// Routes start and end on the nearest mapped path, a little off each pin.
const snapped = [[121.0601, 14.6501], [121.061, 14.651], [121.0619, 14.6519]];
const ok = (distance, coordinates = snapped) => ({ code: 'Ok', routes: [{ distance, geometry: { coordinates } }] });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const hang = signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

function setup({ streets, mapbox }, overrides = {}) {
  const calls = [];
  const dependencies = {
    mapboxToken: 'pk.test',
    distanceM: haversineM,
    fetch: async (url, init) => {
      calls.push(url);
      return typeof mapbox === 'function' ? mapbox(init.signal) : mapbox;
    },
    streetPath: async (from, to, signal) => {
      calls.push(`streets ${from} ${to}`);
      return typeof streets === 'function' ? streets(signal) : streets;
    },
    ...overrides,
  };
  return { dependencies, calls };
}

test('uses the street network and adds the gap at each end', async () => {
  const { dependencies, calls } = setup({ streets: { distanceM: 300, coordinates: snapped }, mapbox: json(ok(600)) });
  const route = await fetchHoseRoute(hydrant, fire, dependencies);
  const gaps = haversineM(14.65, 121.06, 14.6501, 121.0601) + haversineM(14.6519, 121.0619, 14.652, 121.062);
  assert.ok(gaps > 20 && gaps < 40);
  assert.equal(route.source, 'streets');
  assert.equal(route.meters, 300 + gaps);
  assert.deepEqual(route.path, [[121.06, 14.65], ...snapped, [121.062, 14.652]]);
  assert.equal(calls[0], 'streets 121.06,14.65 121.062,14.652');
});

test('asks Mapbox walking at the same time and cancels it once the street network answers', async () => {
  let mapboxSignal;
  const { dependencies, calls } = setup({
    streets: { distanceM: 300, coordinates: snapped },
    mapbox: signal => { mapboxSignal = signal; return hang(signal); },
  });
  assert.equal((await fetchHoseRoute(hydrant, fire, dependencies)).source, 'streets');
  assert.match(calls[1], /\/mapbox\/walking\/121\.06,14\.65;121\.062,14\.652\?.*access_token=pk\.test/);
  assert.equal(mapboxSignal.aborted, true);
});

test('falls back to Mapbox walking whenever the street network has no usable path', async () => {
  const failures = [
    null,
    { distanceM: 300, coordinates: [[121.06, 14.65]] },
    { distanceM: NaN, coordinates: snapped },
    { distanceM: 300, coordinates: [[121.06, 'north'], [121.061, 14.651]] },
    () => { throw new TypeError('tiles offline'); },
  ];
  for (const streets of failures) {
    const { dependencies } = setup({ streets, mapbox: json(ok(640)) });
    const route = await fetchHoseRoute(hydrant, fire, dependencies);
    assert.equal(route.source, 'mapbox');
    assert.ok(route.meters > 640);
  }
});

test('returns null when neither source answers so the caller can fall back to a straight line', async () => {
  const mapboxFailures = [
    json({ message: 'Not Authorized' }, 401),
    json({ code: 'NoRoute', routes: [] }),
    json(ok('600')),
    new Response('not json'),
    () => { throw new TypeError('network down'); },
  ];
  for (const mapbox of mapboxFailures) {
    const { dependencies } = setup({ streets: null, mapbox });
    assert.equal(await fetchHoseRoute(hydrant, fire, dependencies), null);
  }
});

test('skips a source it has no means to ask', async () => {
  const noToken = setup({ streets: { distanceM: 300, coordinates: snapped } }, { mapboxToken: undefined });
  assert.equal((await fetchHoseRoute(hydrant, fire, noToken.dependencies)).source, 'streets');
  assert.equal(noToken.calls.length, 1);

  const noStreets = setup({ mapbox: json(ok(640)) }, { streetPath: undefined });
  assert.equal((await fetchHoseRoute(hydrant, fire, noStreets.dependencies)).source, 'mapbox');
});

test('a source that does not answer in time is abandoned', async () => {
  const { dependencies } = setup({ streets: hang, mapbox: json(ok(640)) }, { timeoutMs: 20 });
  assert.equal((await fetchHoseRoute(hydrant, fire, dependencies)).source, 'mapbox');
});

test('cancelling stops the lookup', async () => {
  const controller = new AbortController();
  const { dependencies } = setup({
    streets: signal => { const pending = hang(signal); controller.abort(); return pending; },
    mapbox: json(ok(640)),
  }, { signal: controller.signal });
  assert.equal(await fetchHoseRoute(hydrant, fire, dependencies), null);

  const alreadyCancelled = setup({ streets: { distanceM: 300, coordinates: snapped } }, { signal: controller.signal });
  assert.equal(await fetchHoseRoute(hydrant, fire, alreadyCancelled.dependencies), null);
  assert.equal(alreadyCancelled.calls.length, 0);
});
