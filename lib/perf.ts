/**
 * Thesis timing marks: T1a (nearest-hydrant search), T1b (route drawn) and
 * T2 (OTW Mode load).
 *
 * Inert unless the page URL has `?perf=1`: every export returns early, so a
 * normal session runs no timing code. A mark ends on the map's next `idle`
 * event, which fires once the camera has stopped and everything requested is
 * on screen. Results go to `window.__hsPerf` and to one console line each,
 * prefixed `[HS-PERF]`, for the runner script to collect.
 */

export type PerfMeasure = 'T1a' | 'T1b' | 'T2';
export type PerfRenderer = 'mapbox' | 'maplibre';
type PerfDetail = Record<string, string | number>;

export interface PerfRecord {
  measure: PerfMeasure;
  /** ISO time the record was written. */
  ts: string;
  /** Elapsed whole milliseconds; absent on a failed run. */
  ms?: number;
  status?: 'error';
  message?: string;
  [detail: string]: string | number | undefined;
}

declare global {
  interface Window {
    __hsPerf?: PerfRecord[];
    /** For the runner: resolves on the map's next idle, so every timed step starts from a settled map. */
    __hsPerfIdle?: () => Promise<void>;
  }
}

/** The parts of a Mapbox GL / MapLibre map the marks rely on. */
interface IdleMap {
  once(type: 'idle', listener: () => void): unknown;
  triggerRepaint(): void;
}

let attached: { map: IdleMap; renderer: PerfRenderer } | null = null;

export function perfEnabled(): boolean {
  return typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('perf') === '1';
}

function emit(record: PerfRecord) {
  (window.__hsPerf ??= []).push(record);
  console.info('[HS-PERF]', JSON.stringify(record));
}

/** A loaded map registers itself as the one whose `idle` ends the marks. Returns the cleanup. */
export function perfAttachMap(map: IdleMap, renderer: PerfRenderer): () => void {
  if (!perfEnabled()) return () => {};
  const entry = { map, renderer };
  attached = entry;
  const idle = () => new Promise<void>((resolve) => {
    map.once('idle', () => resolve());
    map.triggerRepaint();
  });
  window.__hsPerfIdle = idle;
  return () => {
    if (attached === entry) attached = null;
    if (window.__hsPerfIdle === idle) delete window.__hsPerfIdle;
  };
}

/** Start time for a mark; call on the first line of the handler being timed. */
export function perfStart(): number {
  return perfEnabled() ? performance.now() : 0;
}

/**
 * Close the marks on the map's next `idle`. Call right after the change being
 * timed has been handed to the map (camera move started, source data set).
 */
export function perfEnd(measures: PerfMeasure[], t0: number, detail: PerfDetail = {}) {
  if (!perfEnabled()) return;
  const target = attached;
  if (!target) {
    perfFail(measures, 'Map is not ready', detail);
    return;
  }
  target.map.once('idle', () => {
    const ms = Math.round(performance.now() - t0);
    const ts = new Date().toISOString();
    for (const measure of measures) emit({ measure, ms, ts, renderer: target.renderer, ...detail });
  });
  // An already-settled map renders no further frame on its own, so it would
  // never report idle. While it is moving or loading this is a no-op.
  target.map.triggerRepaint();
}

/** Record a flow that failed (no hydrant found, no route, API error) instead of timing it. */
export function perfFail(measures: PerfMeasure[], message: string, detail: PerfDetail = {}) {
  if (!perfEnabled()) return;
  const ts = new Date().toISOString();
  for (const measure of measures) emit({ measure, status: 'error', message, ts, ...detail });
}
