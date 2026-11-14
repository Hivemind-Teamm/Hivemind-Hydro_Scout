#!/usr/bin/env node
// Thesis timing runs for Hydro-Scout: T1 (Time-to-Nearest-Hydrant) and
// T2 (OTW Mode Load Time), 30 scripted runs each, timed by the app itself.
//
//   node scripts/perf-runs.mjs --login     sign in by hand once; the session is kept in .perf-profile/
//   node scripts/perf-runs.mjs --trial     trial runs (2 per measure, or --trial-runs <n>), marked "trial" in the CSV
//   node scripts/perf-runs.mjs             the real runs: 30 valid T1 runs, then 30 valid T2 runs
//
// Options:
//   --url <address>       dashboard of the app under test (default: APP_URL or http://localhost:3000/dashboard)
//   --network "<text>"    e.g. "Wi-Fi" or "mobile data", written to run_meta.json
//   --speedtest "<text>"  speed test result entered by hand, e.g. "48 Mbps down / 21 Mbps up, 12 ms"
//   --target "<text>"     what the address is, e.g. "test copy (local production build)"
//   --allow-dirty         let real runs start with uncommitted source changes (recorded in run_meta.json)
//   --trial-runs <n>      trial runs per measure (default 2)
//
// The app must be a build of branch perf/t1-t2 (the timing code is only there)
// and is opened with ?perf=1. The script holds no passwords and writes nothing
// to Firestore; it only drives the UI and collects the app's [HS-PERF] lines.
// The browser's HTTP cache is cleared before every run, and each row's note
// says whether the isochrone and route responses came from the network or a cache.
// Outputs: results/t1_t2_runs.csv and results/run_meta.json.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { CSV_HEADER, csvLine, parseCsv } from './perf-csv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_DIR = path.join(ROOT, '.perf-profile');
const RESULTS_DIR = path.join(ROOT, 'results');
const CSV_PATH = path.join(RESULTS_DIR, 't1_t2_runs.csv');
const META_PATH = path.join(RESULTS_DIR, 'run_meta.json');

// Fixed start points: the tabletop fire locations, spread across the four sub-stations' areas.
const START_POINTS = [
  { label: 'SP1', place: 'Sgt. Esguerra Ave. cor. Mother Ignacia Ave., South Triangle', lat: 14.64096, lng: 121.03692 },
  { label: 'SP2', place: 'Timog Ave. cor. EDSA', lat: 14.63319, lng: 121.04385 },
  { label: 'SP3', place: 'Quezon Ave. cor. Timog Ave.', lat: 14.63648, lng: 121.02620 },
  { label: 'SP4', place: 'Kalayaan Ave. cor. Malingap St.', lat: 14.64217, lng: 121.05466 },
  { label: 'SP5', place: 'Magsaysay Ave., UP Campus', lat: 14.65764, lng: 121.06243 },
  { label: 'SP6', place: 'Elliptical Rd. cor. Kalayaan Ave.', lat: 14.64866, lng: 121.05140 },
];

const MEASURES = ['T1', 'T2'];          // all T1 runs first, then all T2 runs
const RUNS_PER_MEASURE = 30;            // 6 start points in turn, 5 rounds
const TRIAL_RUNS_PER_MEASURE = 2;
const MARK_TIMEOUT_MS = 30_000;         // wait this long for an [HS-PERF] line
const SETTLE_TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 60_000;
const PAUSE_BETWEEN_RUNS_MS = 2_000;
// Every run is a page load that reads the whole hydrant collection, so a
// session stops rather than keep redoing runs past this many failures, or
// once the same run has failed this many times in a row.
const MAX_FAILED_RUNS = 10;
const MAX_FAILED_IN_A_ROW = 3;
const VIEWPORT = { width: 1366, height: 768 };
const PERF_PREFIX = '[HS-PERF] ';
const BY_HAND = 'TO BE ENTERED BY HAND';

// How the app decides a timed step is over (lib/perf.ts), written into each session of run_meta.json.
const TIMING = {
  endRule: 'Each timer (T1a, T1b, T2) stops on the first frame the map renders (its "render" event) at which all three hold: '
    + '(1) the new result is on the map with its data loaded: for T1a the nearest hydrant has been listed and selected and the camera has been sent to it; '
    + 'for T1b and T2 the fetched route has been set, the route line\'s GeoJSON source ("otw-route") reports loaded (map.isSourceLoaded) and the on-route hydrant markers have been set; '
    + '(2) the camera has stopped moving (map.isMoving() is false); '
    + '(3) all visible tiles are loaded (map.areTilesLoaded() is true). '
    + 'The route line\'s dash animation keeps running throughout. '
    + `If no such frame comes within ${MARK_TIMEOUT_MS / 1000} s of the click, the runner records the run as a timeout.`,
  cameraAnimations: {
    T1a: 'flyTo the nearest hydrant at zoom 17 with speed 1.4 and the default curve 1.42. flyTo has no fixed duration: the map derives it from the distance and zoom change, so it varies by start point.',
    T1b_T2: 'fitBounds to the route\'s bounding box with 60 px padding and a fixed duration of 900 ms.',
    note: 'The camera move starts before the timer is told to stop and its whole length counts in the time. The map skips camera animations when the browser reports prefers-reduced-motion: see reducedMotion under screen.',
  },
  cacheRule: 'Before every run the browser\'s HTTP cache is cleared (DevTools protocol Network.clearBrowserCache). '
    + 'The sign-in (cookies and site storage) and the Firestore offline cache (IndexedDB) are kept. '
    + 'Each row\'s note says where the isochrone and route API responses came from, "network" or "cache", read from the DevTools protocol network events '
    + '(a response served from the memory, disk or prefetch cache, by a service worker, or as a 304 revalidation counts as "cache"). '
    + '"network" means the response came over the network rather than from the browser; Mapbox\'s CDN may still have answered it from its own edge cache, which the runner cannot clear. '
    + 'A run whose isochrone or route response did not come from the network is recorded with status "aborted" and stops the session. '
    + 'Not cleared: Mapbox GL\'s own tile store (Cache Storage "mapbox-tiles") and the app\'s service-worker caches (same-origin scripts and styles, and CARTO tiles used only by the MapLibre fallback), '
    + 'so map tiles already seen in an earlier run can be served from there.',
  settleRule: 'The untimed waits (after the page loads, after locating, and after selecting the hydrant before the Route click) end on the first frame the map renders at which '
    + 'the camera has stopped moving (map.isMoving() is false) and all visible tiles are loaded (map.areTilesLoaded() is true), plus any named source loaded; '
    + 'none is named for these waits, as no route has been requested before the Route click. They are not part of any time. '
    + `If the map does not settle within ${SETTLE_TIMEOUT_MS / 1000} s the run is recorded as an error and its note says which condition was still unmet. `
    + 'Sessions whose timing has no settleRule used the map\'s "idle" event for these waits.',
  markTimeoutMs: MARK_TIMEOUT_MS,
  settleTimeoutMs: SETTLE_TIMEOUT_MS,
  stopRule: `A session stops after ${MAX_FAILED_RUNS} failed runs, or when the same run fails ${MAX_FAILED_IN_A_ROW} times in a row.`,
};

/** A problem that would repeat on every run (signed out, wrong build, no location): stop the session. */
class AbortRun extends Error {}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const firstLine = error => String(error?.message ?? error).split('\n')[0];

function usage(problem) {
  if (problem) console.error(`${problem}\n`);
  console.error('Usage: node scripts/perf-runs.mjs [--login | --trial [--trial-runs <n>]] [--url <address>] [--network "<text>"] [--speedtest "<text>"] [--target "<text>"] [--allow-dirty]');
  process.exit(problem ? 1 : 0);
}

function parseArgs(argv) {
  const options = {
    login: false, trial: false, allowDirty: false, trialRuns: TRIAL_RUNS_PER_MEASURE,
    url: process.env.APP_URL || 'http://localhost:3000/dashboard',
    network: null, speedtest: null, target: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) usage(`${arg} needs a value.`);
      return argv[i];
    };
    if (arg === '--login') options.login = true;
    else if (arg === '--trial') options.trial = true;
    else if (arg === '--allow-dirty') options.allowDirty = true;
    else if (arg === '--url') options.url = value();
    else if (arg === '--network') options.network = value();
    else if (arg === '--speedtest') options.speedtest = value();
    else if (arg === '--target') options.target = value();
    else if (arg === '--trial-runs') {
      options.trialRuns = Number(value());
      if (!Number.isInteger(options.trialRuns) || options.trialRuns < 1) usage('--trial-runs needs a whole number of 1 or more.');
    }
    else if (arg === '--help' || arg === '-h') usage();
    else usage(`Unknown option ${arg}.`);
  }
  if (options.login && options.trial) usage('Use --login and --trial separately.');
  let url;
  try { url = new URL(options.url); } catch { usage(`"${options.url}" is not a valid address.`); }
  // The timed flows are on the dashboard; a bare site address means that page.
  if (url.pathname === '/') url.pathname = '/dashboard';
  options.appUrl = url;
  return options;
}

/* ── git and machine details for run_meta.json ─────────────────────────────── */

function git(...args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

/** Source changes not yet committed (the results folder itself does not count). */
function uncommittedChanges() {
  const status = git('status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude)results');
  return status === null ? null : status.split('\n').filter(Boolean);
}

function screenResolution() {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_VideoController | ForEach-Object { '{0}x{1}' -f $_.CurrentHorizontalResolution, $_.CurrentVerticalResolution }",
    ], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return output.split(/\r?\n/).map(line => line.trim()).filter(line => /^\d+x\d+$/.test(line)).join(', ') || null;
  } catch { return null; }
}

function pageEnvironment(page) {
  return page.evaluate(async () => {
    let versions = null;
    try {
      const data = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList']);
      versions = data?.fullVersionList?.map(item => `${item.brand} ${item.version}`) ?? null;
    } catch { /* not available in this browser */ }
    let webglRenderer = null;
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      webglRenderer = gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
    } catch { /* leave unknown */ }
    let onMainsPower = null;
    try { onMainsPower = (await navigator.getBattery?.())?.charging ?? null; } catch { /* leave unknown */ }
    const connection = navigator.connection;
    return {
      userAgent: navigator.userAgent,
      versions,
      webglRenderer,
      onMainsPower,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      // Next.js adds this element only when the app runs under `next dev`.
      developmentBuild: !!document.querySelector('nextjs-portal'),
      hydrantMarkers: document.querySelectorAll('[data-hydrant-id]').length,
      browserNetworkEstimate: connection
        ? { effectiveType: connection.effectiveType, downlinkMbps: connection.downlink, rttMs: connection.rtt }
        : null,
    };
  });
}

function describeTarget(options) {
  if (options.target) return options.target;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(options.appUrl.hostname);
  return local
    ? 'test copy (local build of branch perf/t1-t2, not the live app)'
    : `${BY_HAND} (live app or test copy?)`;
}

function loadMeta() {
  try { return JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch { return null; }
}

function saveMeta(sessions) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const meta = {
    study: 'Hydro-Scout thesis timing: T1 (Time-to-Nearest-Hydrant) and T2 (OTW Mode Load Time)',
    definitions: {
      T1: 'T1 = T1a + T1b. T1a: from the Find Nearest Hydrant click until the nearest hydrant is listed and the camera has flown to it. T1b: from the Route click on that hydrant until the route is drawn. The pause between the result appearing and the Route click is not counted.',
      T2: 'From the Route click (OTW Mode turned on) until the route and the hydrants along it are shown.',
      endOfTimer: 'When "until" is reached is given by timing.endRule in each session.',
    },
    notes: [
      'Times are measured inside the app with performance.now() and recorded in whole milliseconds. The timing code runs only when the page address has ?perf=1.',
      'With ?perf=1 the app skips its account-presence write (accountPresenceSessions), so the runs write nothing to Firestore. A normal session does write it.',
      'In this build T1b and T2 cover the same interval (Route click to the end rule being met): the route line and the hydrants along it reach the map in one update.',
      'The camera move counts in the time: T1a includes the fly-to animation and T1b and T2 include the route-fit animation (see timing.cameraAnimations in each session).',
      'A session without a "timing" field used the earlier end rule: the map\'s next "idle" event. In OTW Mode the route line\'s dash animation repaints the map continuously, so idle never came after the Route click and those runs timed out.',
      'Every run routes to the nearest operational hydrant that the app\'s own search returns from that start point. In T2 runs the search only picks the destination; its time is not part of T2.',
      'Runs follow the six start points in turn (SP1 to SP6), five rounds, all T1 runs first and then all T2 runs, with 2 s between runs.',
      'Failed and timed-out runs stay in the CSV with their status and are redone under the same run number. No run is removed and no outlier is excluded.',
      'Each CSV row belongs to the session whose startedAt to finishedAt range contains its iso_time; each session names the commit that was built and timed.',
    ],
    startPoints: START_POINTS,
    sessions,
  };
  fs.writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
}

/* ── CSV ───────────────────────────────────────────────────────────────────── */

function readExistingRows() {
  if (!fs.existsSync(CSV_PATH)) return [];
  const { header, rows } = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  if (header.join(',') !== CSV_HEADER) {
    throw new Error(`${path.relative(ROOT, CSV_PATH)} has different columns than this script writes. Move it aside before running.`);
  }
  return rows;
}

function appendRow(row) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  if (!fs.existsSync(CSV_PATH)) fs.writeFileSync(CSV_PATH, `${CSV_HEADER}\n`);
  const line = csvLine(row);
  fs.appendFileSync(CSV_PATH, `${line}\n`);
  return line;
}

/* ── Driving the app ───────────────────────────────────────────────────────── */

/** Collect every [HS-PERF] console line the page prints. */
function collectMarks(page) {
  const marks = [];
  page.on('console', (message) => {
    const text = message.text();
    if (!text.startsWith(PERF_PREFIX)) return;
    try { marks.push(JSON.parse(text.slice(PERF_PREFIX.length))); } catch { /* not a record */ }
  });
  return marks;
}

/** Which timed API request a URL is, or null: the nearest-hydrant isochrone or the route (Mapbox or OSRM). */
function apiKind(url) {
  if (url.includes('api.mapbox.com/isochrone/')) return 'isochrone';
  if (url.includes('api.mapbox.com/directions/') || url.includes('router.project-osrm.org/route/')) return 'route';
  return null;
}

/**
 * Watch the isochrone and route requests through the DevTools protocol, which
 * says whether each response came from the network or from a cache.
 */
async function watchApiRequests(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const requests = new Map();   // requestId -> { kind, source }
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    const kind = apiKind(request.url);
    if (kind) requests.set(requestId, { kind, source: null });
  });
  cdp.on('Network.requestServedFromCache', ({ requestId }) => {
    const entry = requests.get(requestId);
    if (entry) entry.source = 'cache';
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    const entry = requests.get(requestId);
    if (!entry || entry.source === 'cache') return;
    const cached = response.fromDiskCache || response.fromPrefetchCache || response.fromServiceWorker || response.status === 304;
    entry.source = cached ? 'cache' : 'network';
  });
  return {
    /** Clear the browser's HTTP cache (not cookies, site storage or IndexedDB) and forget earlier requests. */
    async startRun() {
      await cdp.send('Network.clearBrowserCache');
      requests.clear();
    },
    /** Where each request of this kind was answered from, in request order. */
    sources(kind) {
      return [...requests.values()].filter(entry => entry.kind === kind).map(entry => entry.source ?? 'no response');
    },
  };
}

/** "isochrone: network; route: network", for the note column. */
function describeSources(api) {
  return ['isochrone', 'route'].map(kind => `${kind}: ${api.sources(kind).join(', ') || 'none'}`).join('; ');
}

/** Why a completed run's API responses are not all from the network, or ''. */
function cacheProblem(api) {
  for (const kind of ['isochrone', 'route']) {
    const sources = api.sources(kind);
    if (!sources.length) return `no ${kind} request was seen`;
    if (sources.some(source => source !== 'network')) return `the ${kind} response did not come from the network`;
  }
  return '';
}

async function waitForMark(marks, measure, fromIndex) {
  const deadline = Date.now() + MARK_TIMEOUT_MS;
  for (;;) {
    const found = marks.slice(fromIndex).find(mark => mark.measure === measure);
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await sleep(50);
  }
}

/** Which settle conditions a timed-out wait was stuck on, from window.__hsPerfState. */
function describeSettleState(state) {
  if (!state) return 'its state could not be read';
  const unmet = [];
  if (state.cameraMoving) unmet.push('camera still moving');
  if (!state.visibleTilesLoaded) unmet.push('visible tiles still loading');
  if (state.sourcesLoading.length) unmet.push(`sources still loading: ${state.sourcesLoading.join(' ')}`);
  if (state.sourcesMissing.length) unmet.push(`sources missing: ${state.sourcesMissing.join(' ')}`);
  return unmet.length ? unmet.join(', ') : 'every condition held when checked, but no frame was rendered';
}

/**
 * Untimed wait for a settled map: camera stopped, all visible tiles loaded and
 * every source in `sources` loaded, so the next timed step starts from rest.
 */
async function settle(page, when, sources = []) {
  const settled = page.evaluate(list => (window.__hsPerfSettle ? window.__hsPerfSettle(list).then(() => 'settled') : 'missing'), sources);
  settled.catch(() => {});
  const outcome = await Promise.race([settled, sleep(SETTLE_TIMEOUT_MS).then(() => 'timeout')]);
  if (outcome === 'missing') throw new AbortRun('The page lost its timing code (the map was replaced or the address lost ?perf=1).');
  if (outcome === 'timeout') {
    const state = await page.evaluate(list => window.__hsPerfState?.(list) ?? null, sources).catch(() => null);
    throw new Error(`The map did not settle within ${SETTLE_TIMEOUT_MS / 1000} s ${when}: ${describeSettleState(state)}.`);
  }
}

/** Fresh load of the dashboard with ?perf=1 at the given start point. */
async function openDashboard(page, context, perfUrl, startPoint) {
  await context.setGeolocation({ latitude: startPoint.lat, longitude: startPoint.lng, accuracy: 10 });
  await page.goto(perfUrl, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
  await page.waitForFunction(
    () => window.location.pathname.startsWith('/login')
      || [...document.querySelectorAll('button')].some(button => (button.textContent ?? '').includes('Find Nearest Hydrant')),
    null, { timeout: LOAD_TIMEOUT_MS },
  );
  if (new URL(page.url()).pathname.startsWith('/login')) {
    throw new AbortRun('Not signed in. Run "node scripts/perf-runs.mjs --login" and sign in by hand first.');
  }
  // The splash covers the map until both the map and the hydrants have loaded.
  await page.getByText('Loading map…').waitFor({ state: 'detached', timeout: LOAD_TIMEOUT_MS });
  const timed = await page.waitForFunction(() => typeof window.__hsPerfSettle === 'function', null, { timeout: 15_000 })
    .then(() => true, () => false);
  if (!timed) {
    throw new AbortRun('This page has no timing code. The app must be a build of branch perf/t1-t2, opened with ?perf=1.');
  }
  await settle(page, 'after loading');
}

/** Press "Go to my location" and wait for the fix: the search needs one. */
async function locate(page) {
  await page.getByRole('button', { name: 'Go to my location' }).filter({ visible: true }).first().click({ timeout: 15_000 });
  const fixed = await page.locator('.user-location-pulse').first().waitFor({ state: 'attached', timeout: 20_000 })
    .then(() => true, () => false);
  if (!fixed) {
    throw new AbortRun('No location fix after pressing "Go to my location". If the account belongs to a station, run --login again and choose Allow on the location notice.');
  }
  await settle(page, 'after locating');
}

/** Click the hydrant's marker so its card (with the Route button) opens. Returns a note, or ''. */
async function selectHydrant(page, hydrantId) {
  const marker = page.locator(`[data-hydrant-id="${hydrantId.replace(/["\\]/g, '\\$&')}"]`);
  let note = '';
  try {
    await marker.click({ timeout: 5_000 });
  } catch {
    // Another marker (often the location dot) sits on top of the pin. Send the
    // click to the pin itself; this step is not timed.
    await marker.dispatchEvent('click');
    note = 'hydrant pin was covered, so its click was sent directly';
  }
  const shown = await page.getByRole('button', { name: 'Route', exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true, () => false);
  if (!shown) {
    throw new AbortRun('No Route button on the hydrant card. The signed-in account needs the authorized, head or admin role.');
  }
  await settle(page, 'after selecting the hydrant');
  return note;
}

/** One scripted run. Always returns a CSV row, whatever happened. */
async function runOnce({ page, context, perfUrl, marks, api, measure, run, startPoint, phase }) {
  const row = { measure, run, start: startPoint.label, lat: startPoint.lat, lng: startPoint.lng, phase };
  const failed = (status, note, extra = {}) => ({
    ...row, ...extra, status, note: `${describeSources(api)}; ${note}`, iso_time: new Date().toISOString(),
  });
  let partial = {};
  try {
    if (page.isClosed()) throw new AbortRun('The browser window was closed.');
    marks.length = 0;
    await api.startRun();
    await openDashboard(page, context, perfUrl, startPoint);
    await locate(page);

    // Search for the nearest hydrant. The app times this as T1a.
    let from = marks.length;
    await page.getByRole('button', { name: 'Find Nearest Hydrant' }).click({ timeout: 15_000 });
    const search = await waitForMark(marks, 'T1a', from);
    if (!search) return failed('timeout', `no [HS-PERF] T1a line within ${MARK_TIMEOUT_MS / 1000} s of the search click`);
    if (search.status === 'error') return failed('error', `search: ${search.message}`);
    partial = { dest: search.hydrantId, renderer: search.renderer, ...(measure === 'T1' ? { t1a_ms: search.ms } : {}) };
    const notes = [];
    if (search.ranking === 'straight-line') notes.push('Isochrone API unavailable: nearest ranked by straight-line distance');
    if (search.renderer === 'maplibre') notes.push('MapLibre fallback renderer');

    // Open that hydrant's card. Not timed: the pause before Route is not counted.
    const selectNote = await selectHydrant(page, search.hydrantId);
    if (selectNote) notes.push(selectNote);

    // Route. The app times this click as T1b and as T2.
    from = marks.length;
    await page.getByRole('button', { name: 'Route', exact: true }).click({ timeout: 15_000 });
    const routeMeasure = measure === 'T1' ? 'T1b' : 'T2';
    const route = await waitForMark(marks, routeMeasure, from);
    if (!route) return failed('timeout', `no [HS-PERF] ${routeMeasure} line within ${MARK_TIMEOUT_MS / 1000} s of the Route click`, partial);
    if (route.status === 'error') return failed('error', `route: ${route.message}`, partial);
    if (route.hydrantId !== search.hydrantId) {
      return failed('error', `routed to ${route.hydrantId}, not the nearest hydrant ${search.hydrantId}`, partial);
    }

    // Every run must fetch the isochrone and the route from the network; a
    // cached response stops the session (the row keeps its times).
    const problem = cacheProblem(api);
    return {
      ...row,
      ...partial,
      route_m: route.routeM,
      on_route_hydrants: route.onRouteHydrants,
      ms: measure === 'T1' ? search.ms + route.ms : route.ms,
      ...(measure === 'T1' ? { t1b_ms: route.ms } : {}),
      status: problem ? 'aborted' : 'ok',
      iso_time: route.ts,
      note: [describeSources(api), ...notes, ...(problem ? [`stopped: ${problem}`] : [])].join('; '),
    };
  } catch (error) {
    return failed(error instanceof AbortRun ? 'aborted' : 'error', firstLine(error), partial);
  }
}

function describeRow(row) {
  const head = `${row.measure} run ${String(row.run).padStart(2)} ${row.start} ${row.status.toUpperCase()}`;
  if (row.status !== 'ok') return `${head}  ${row.note}`;
  const time = row.measure === 'T1' ? `T1a ${row.t1a_ms} + T1b ${row.t1b_ms} = ${row.ms} ms` : `${row.ms} ms`;
  return `${head}  ${time}  to ${row.dest}, ${row.route_m ?? '?'} m${row.note ? `  (${row.note})` : ''}`;
}

/* ── Modes ─────────────────────────────────────────────────────────────────── */

function launch() {
  // Headed, with the installed Chrome: Mapbox needs real WebGL, and headless
  // software rendering would distort the times.
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: VIEWPORT,
    permissions: ['geolocation'],
  });
}

async function loginMode(options) {
  const context = await launch();
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(new URL('/login', options.appUrl).href, { timeout: LOAD_TIMEOUT_MS });
  console.log('A Chrome window is open on the login page.');
  console.log('  1. Sign in by hand, with an "authorized" account that is not responding to an incident.');
  console.log('  2. If a location privacy notice appears, choose Allow.');
  console.log('  3. Wait for the dashboard map to show.');
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  await prompt.question('Then press Enter here to save the session and close the window. ');
  prompt.close();
  let signedIn = false;
  try { signedIn = !page.isClosed() && new URL(page.url()).pathname.startsWith('/dashboard'); } catch { /* window closed */ }
  await context.close().catch(() => {});
  if (signedIn) console.log('Signed-in session saved in .perf-profile/. Next: node scripts/perf-runs.mjs --trial');
  else console.log('The dashboard was not showing, so the sign-in may not have been saved. Run --login again.');
  process.exit(signedIn ? 0 : 1);
}

async function runMode(options) {
  const phase = options.trial ? 'trial' : 'real';
  const target = options.trial ? options.trialRuns : RUNS_PER_MEASURE;

  const changes = uncommittedChanges();
  if (phase === 'real' && changes?.length && !options.allowDirty) {
    console.error('The source tree has uncommitted changes, so run_meta.json could not name the exact code that was timed:');
    changes.slice(0, 10).forEach(line => console.error(`  ${line}`));
    console.error('Commit them first, or pass --allow-dirty to run anyway (it is recorded).');
    process.exit(1);
  }

  // Real runs can resume: valid runs already in the CSV are not repeated.
  const existing = readExistingRows();
  const validSoFar = Object.fromEntries(MEASURES.map(measure => [measure,
    phase === 'real' ? existing.filter(row => row.phase === 'real' && row.measure === measure && row.status === 'ok').length : 0]));
  if (MEASURES.every(measure => validSoFar[measure] >= target)) {
    console.log(`The CSV already has ${target} valid ${phase} runs for each measure. Nothing to do.`);
    return;
  }

  const perfUrl = new URL(options.appUrl);
  perfUrl.searchParams.set('perf', '1');
  const context = await launch();
  // A route left active by the previous run must not be restored on the next load.
  await context.addInitScript(() => {
    try {
      localStorage.removeItem('hydroscout_otw_hydrant_id');
      localStorage.removeItem('hydroscout_otw_route');
    } catch { /* storage unavailable on this page */ }
  });
  const page = context.pages()[0] ?? await context.newPage();
  const marks = collectMarks(page);
  const api = await watchApiRequests(context, page);

  // One untimed load first: checks the sign-in and the build, and reads the machine details.
  let environment;
  try {
    await openDashboard(page, context, perfUrl.href, START_POINTS[0]);
    environment = await pageEnvironment(page);
  } catch (error) {
    await context.close().catch(() => {});
    console.error(`Cannot start: ${firstLine(error)}`);
    process.exit(1);
  }
  if (environment.developmentBuild) {
    console.warn('Note: this is a development server (next dev). It is slower than a production build; use "npm run build" then "npm start" for the real runs.');
  }

  const require = createRequire(import.meta.url);
  const sessions = loadMeta()?.sessions ?? [];
  const session = {
    phase,
    date: new Date().toLocaleDateString('en-CA'),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    app: {
      url: perfUrl.href,
      target: describeTarget(options),
      build: environment.developmentBuild ? 'development server (next dev)' : 'production build',
    },
    git: { commit: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), uncommittedChanges: changes },
    timing: TIMING,
    browser: {
      name: 'Google Chrome, headed, driven by Playwright (channel "chrome")',
      versions: environment.versions,
      userAgent: environment.userAgent,
      webglRenderer: environment.webglRenderer,
      playwright: require('playwright/package.json').version,
    },
    os: { platform: process.platform, name: os.type(), release: os.release(), version: os.version(), arch: os.arch() },
    cpu: { model: os.cpus()[0]?.model.trim() ?? null, logicalCores: os.cpus().length },
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    screen: {
      resolution: screenResolution() ?? BY_HAND,
      viewport: environment.viewport,
      devicePixelRatio: environment.devicePixelRatio,
      reducedMotion: environment.reducedMotion,
    },
    onMainsPower: environment.onMainsPower,
    network: {
      type: options.network ?? `${BY_HAND} (Wi-Fi or mobile data)`,
      speedTest: options.speedtest ?? BY_HAND,
      browserEstimate: environment.browserNetworkEstimate,
    },
    // Reference points are hidden by the default status filter, so they are not counted.
    hydrantMarkersShown: environment.hydrantMarkers,
    node: process.version,
    runs: Object.fromEntries(MEASURES.map(measure => [measure, { valid: 0, failed: 0 }])),
    stopped: null,
  };
  sessions.push(session);
  saveMeta(sessions);

  console.log(`${phase === 'trial' ? 'Trial' : 'Real'} runs against ${perfUrl.href}`);
  console.log(`Commit ${session.git.commit ?? 'unknown'}${changes?.length ? ' (with uncommitted changes)' : ''}, ${session.app.build}, ${environment.hydrantMarkers} hydrant markers shown.\n`);

  const written = [];
  let failedRuns = 0;
  let failedInARow = 0;
  try {
    for (const measure of MEASURES) {
      let valid = validSoFar[measure];
      if (valid > 0 && valid < target) console.log(`${measure}: resuming after ${valid} valid runs already in the CSV.`);
      while (valid < target && !session.stopped) {
        const run = valid + 1;
        const startPoint = START_POINTS[(run - 1) % START_POINTS.length];
        const row = await runOnce({ page, context, perfUrl: perfUrl.href, marks, api, measure, run, startPoint, phase });
        written.push(appendRow(row));
        console.log(describeRow(row));
        if (row.status === 'ok') {
          valid += 1;
          failedInARow = 0;
          session.runs[measure].valid += 1;
        } else {
          failedRuns += 1;
          failedInARow += 1;
          session.runs[measure].failed += 1;
          if (row.status === 'aborted') session.stopped = row.note;
          else if (failedInARow >= MAX_FAILED_IN_A_ROW) {
            session.stopped = `${measure} run ${run} (${startPoint.label}) failed ${MAX_FAILED_IN_A_ROW} times in a row`;
          } else if (failedRuns >= MAX_FAILED_RUNS) session.stopped = `${MAX_FAILED_RUNS} failed runs in this session`;
        }
        saveMeta(sessions);
        if (!session.stopped) await sleep(PAUSE_BETWEEN_RUNS_MS);
      }
      if (session.stopped) break;
    }
  } finally {
    session.finishedAt = new Date().toISOString();
    saveMeta(sessions);
    await context.close().catch(() => {});
  }

  console.log(`\nRows written this session to ${path.relative(ROOT, CSV_PATH)}:`);
  console.log(CSV_HEADER);
  written.forEach(line => console.log(line));
  console.log(`\nMachine and run details: ${path.relative(ROOT, META_PATH)}`);
  if (session.stopped) {
    console.log(`\nStopped early: ${session.stopped}`);
    process.exit(1);
  }
  console.log(`Summary: node scripts/perf-summary.mjs${phase === 'trial' ? ' --trial' : ''}`);
}

const options = parseArgs(process.argv.slice(2));
await (options.login ? loginMode(options) : runMode(options));
