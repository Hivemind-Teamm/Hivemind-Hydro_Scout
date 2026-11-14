import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { perfAttachMap, perfEnabled, perfEnd, perfFail, perfStart } from '../lib/perf.ts';

// A stand-in for the Mapbox GL / MapLibre map: `idle` fires only when the test says so.
function fakeMap() {
  const listeners = [];
  return {
    repaints: 0,
    once(type, listener) { assert.equal(type, 'idle'); listeners.push(listener); },
    triggerRepaint() { this.repaints += 1; },
    idle() { listeners.splice(0).forEach(listener => listener()); },
    get waiting() { return listeners.length; },
  };
}

let logged;
const realInfo = console.info;

beforeEach(() => {
  logged = [];
  console.info = (...args) => logged.push(args);
  globalThis.window = { location: { search: '?perf=1' } };
});

afterEach(() => {
  console.info = realInfo;
  delete globalThis.window;
});

test('without ?perf=1 nothing is timed, recorded or attached', () => {
  for (const search of ['', '?perf=0', '?perf', '?other=1']) {
    window.location.search = search;
    const map = fakeMap();
    const detach = perfAttachMap(map, 'mapbox');
    assert.equal(perfEnabled(), false);
    assert.equal(perfStart(), 0);
    perfEnd(['T1a'], 0);
    perfFail(['T1a'], 'ignored');
    detach();
    assert.equal(map.waiting, 0);
    assert.equal(map.repaints, 0);
    assert.equal(window.__hsPerf, undefined);
    assert.equal(window.__hsPerfIdle, undefined);
  }
  assert.deepEqual(logged, []);
});

test('the runner hook resolves on the next map idle and goes away with the map', async () => {
  const map = fakeMap();
  const detach = perfAttachMap(map, 'mapbox');
  let settled = false;
  const waiting = window.__hsPerfIdle().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(map.repaints, 1);
  map.idle();
  await waiting;
  assert.equal(settled, true);
  assert.equal(window.__hsPerf, undefined, 'settling records nothing');
  detach();
  assert.equal(window.__hsPerfIdle, undefined);
});

test('a mark is recorded on the next map idle, not before', () => {
  const map = fakeMap();
  const detach = perfAttachMap(map, 'mapbox');
  const t0 = perfStart();
  assert.ok(t0 > 0);

  perfEnd(['T1a'], t0, { hydrantId: 'HYD-001' });
  assert.equal(window.__hsPerf, undefined, 'no record until the map is idle');
  assert.equal(map.repaints, 1, 'a settled map is asked for one more frame');

  map.idle();
  assert.equal(window.__hsPerf.length, 1);
  const [record] = window.__hsPerf;
  assert.equal(record.measure, 'T1a');
  assert.equal(record.renderer, 'mapbox');
  assert.equal(record.hydrantId, 'HYD-001');
  assert.ok(Number.isInteger(record.ms) && record.ms >= 0);
  assert.ok(!Number.isNaN(Date.parse(record.ts)));
  assert.equal(record.status, undefined);

  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], '[HS-PERF]');
  assert.deepEqual(JSON.parse(logged[0][1]), record);

  map.idle();
  assert.equal(window.__hsPerf.length, 1, 'later idles add nothing');
  detach();
});

test('one Route click closes T1b and T2 with the same elapsed time', () => {
  const map = fakeMap();
  const detach = perfAttachMap(map, 'maplibre');
  perfEnd(['T1b', 'T2'], perfStart(), { hydrantId: 'HYD-002', routeM: 812, onRouteHydrants: 3 });
  map.idle();
  const [t1b, t2] = window.__hsPerf;
  assert.deepEqual([t1b.measure, t2.measure], ['T1b', 'T2']);
  assert.equal(t1b.ms, t2.ms);
  assert.equal(t1b.ts, t2.ts);
  assert.equal(t2.routeM, 812);
  assert.equal(t2.onRouteHydrants, 3);
  assert.equal(t2.renderer, 'maplibre');
  detach();
});

test('a failed flow is recorded as an error with no time', () => {
  perfFail(['T1b', 'T2'], 'Directions API 503', { hydrantId: 'HYD-003' });
  assert.equal(window.__hsPerf.length, 2);
  for (const record of window.__hsPerf) {
    assert.equal(record.status, 'error');
    assert.equal(record.message, 'Directions API 503');
    assert.equal(record.hydrantId, 'HYD-003');
    assert.equal(record.ms, undefined);
  }
  assert.equal(logged.length, 2);
});

test('ending a mark with no map attached is an error, never a made-up time', () => {
  const map = fakeMap();
  perfAttachMap(map, 'mapbox')();
  perfEnd(['T1a'], perfStart());
  assert.equal(map.waiting, 0);
  assert.equal(window.__hsPerf.length, 1);
  assert.equal(window.__hsPerf[0].status, 'error');
  assert.equal(window.__hsPerf[0].ms, undefined);
});
