import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchHoseRoute } from '../lib/route-distance.ts';
import { haversineM } from '../lib/haversine.ts';

const hydrant = { lat: 14.65, lng: 121.06 };
const fire = { lat: 14.652, lng: 121.062 };
// The services snap both ends onto the nearest mapped path.
const snapped = [[121.0601, 14.6501], [121.061, 14.651], [121.0619, 14.6519]];
const ok = (distance, coordinates = snapped) => ({ code: 'Ok', routes: [{ distance, geometry: { coordinates } }] });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function setup(answers, overrides = {}) {
  const urls = [];
  const dependencies = {
    mapboxToken: 'pk.test',
    distanceM: haversineM,
    fetch: async (url, init) => {
      urls.push(url);
      const answer = answers[url.includes('api.mapbox.com') ? 'mapbox' : 'osrm'];
      return typeof answer === 'function' ? answer(init) : answer;
    },
    ...overrides,
  };
  return { dependencies, urls };
}

test('uses the Mapbox walking route and adds the gap at each end', async () => {
  const { dependencies, urls } = setup({ mapbox: json(ok(600)) });
  const route = await fetchHoseRoute(hydrant, fire, dependencies);
  const gaps = haversineM(14.65, 121.06, 14.6501, 121.0601) + haversineM(14.6519, 121.0619, 14.652, 121.062);
  assert.ok(gaps > 20 && gaps < 40);
  assert.equal(route.source, 'mapbox');
  assert.equal(route.meters, 600 + gaps);
  assert.deepEqual(route.path, [[121.06, 14.65], ...snapped, [121.062, 14.652]]);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/mapbox\/walking\/121\.06,14\.65;121\.062,14\.652\?.*access_token=pk\.test/);
});

test('falls back to OSRM whenever Mapbox does not return a usable route', async () => {
  const failures = [
    json({ message: 'Not Authorized' }, 401),
    json({ code: 'NoRoute', routes: [] }),
    json({ code: 'Ok', routes: [] }),
    json(ok('600')),
    json(ok(600, [[121.06, 14.65]])),
    json(ok(600, [[121.06, 'north'], [121.061, 14.651]])),
    new Response('not json'),
    () => { throw new TypeError('network down'); },
  ];
  for (const mapbox of failures) {
    const { dependencies, urls } = setup({ mapbox, osrm: json(ok(640)) });
    const route = await fetchHoseRoute(hydrant, fire, dependencies);
    assert.equal(route.source, 'osrm');
    assert.ok(route.meters > 640);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /router\.project-osrm\.org\/route\/v1\/driving\/121\.06,14\.65;121\.062,14\.652/);
  }
});

test('goes straight to OSRM when there is no Mapbox token', async () => {
  const { dependencies, urls } = setup({ osrm: json(ok(640)) }, { mapboxToken: undefined });
  assert.equal((await fetchHoseRoute(hydrant, fire, dependencies)).source, 'osrm');
  assert.equal(urls.length, 1);
});

test('returns null when no service answers so the caller can fall back to a straight line', async () => {
  const { dependencies, urls } = setup({ mapbox: json({}, 500), osrm: () => { throw new TypeError('offline'); } });
  assert.equal(await fetchHoseRoute(hydrant, fire, dependencies), null);
  assert.equal(urls.length, 2);
});

test('a service that does not answer in time is abandoned for the next one', async () => {
  const hang = init => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const { dependencies } = setup({ mapbox: hang, osrm: json(ok(640)) }, { timeoutMs: 20 });
  assert.equal((await fetchHoseRoute(hydrant, fire, dependencies)).source, 'osrm');
});

test('cancelling stops the lookup without trying the next service', async () => {
  const controller = new AbortController();
  const cancelMidRequest = init => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    controller.abort();
  });
  const { dependencies, urls } = setup({ mapbox: cancelMidRequest, osrm: json(ok(640)) }, { signal: controller.signal });
  assert.equal(await fetchHoseRoute(hydrant, fire, dependencies), null);
  assert.equal(urls.length, 1);

  const alreadyCancelled = setup({ mapbox: json(ok(600)) }, { signal: controller.signal });
  assert.equal(await fetchHoseRoute(hydrant, fire, alreadyCancelled.dependencies), null);
  assert.equal(alreadyCancelled.urls.length, 0);
});
