/**
 * Thesis timing marks: T1a (nearest-hydrant search), T1b (route drawn) and
 * T2 (OTW Mode load).
 *
 * Inert unless the page URL has `?perf=1`: every export returns early, so a
 * normal session runs no timing code. A mark ends on the first frame the map
 * renders at which the new result's data is loaded, the camera has stopped and
 * every visible tile is loaded. (Not on `idle`: in OTW Mode the route line's
 * dash animation repaints the map forever, so `idle` never fires.) Results go
 * to `window.__hsPerf` and to one console line each, prefixed `[HS-PERF]`, for
 * the runner script to collect.
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
    /**
     * For the runner's untimed waits: resolves on the first rendered frame at
     * which the camera has stopped, all visible tiles are loaded and every
     * source in `sources` has loaded, so every timed step starts from a settled map.
     */
    __hsPerfSettle?: (sources?: string[]) => Promise<void>;
    /** For the runner: the settle conditions right now, to say which one a timed-out wait was stuck on. */
    __hsPerfState?: (sources?: string[]) => PerfMapState;
  }
}

export interface PerfMapState {
  cameraMoving: boolean;
  visibleTilesLoaded: boolean;
  /** Style sources whose visible tiles or data are still loading. */
  sourcesLoading: string[];
  /** The requested sources that are missing from the map. */
  sourcesMissing: string[];
}

/** The parts of a Mapbox GL / MapLibre map the marks rely on. */
interface PerfMap {
  on(type: 'render', listener: () => void): unknown;
  off(type: 'render', listener: () => void): unknown;
  triggerRepaint(): void;
  isMoving(): boolean;
  areTilesLoaded(): boolean;
  getSource(id: string): unknown;
  isSourceLoaded(id: string): boolean;
  getStyle(): { sources?: Record<string, unknown> } | undefined;
}

let attached: { map: PerfMap; renderer: PerfRenderer } | null = null;

export function perfEnabled(): boolean {
  return typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('perf') === '1';
}

function emit(record: PerfRecord) {
  (window.__hsPerf ??= []).push(record);
  console.info('[HS-PERF]', JSON.stringify(record));
}

/** A loaded map registers itself as the one whose frames end the marks. Returns the cleanup. */
export function perfAttachMap(map: PerfMap, renderer: PerfRenderer): () => void {
  if (!perfEnabled()) return () => {};
  const entry = { map, renderer };
  attached = entry;
  const settled = (sources: string[]) => !map.isMoving() && map.areTilesLoaded()
    && sources.every(id => map.getSource(id) && map.isSourceLoaded(id));
  const settle = (sources: string[] = []) => new Promise<void>((resolve) => {
    const onRender = () => {
      if (!settled(sources)) return;
      map.off('render', onRender);
      resolve();
    };
    map.on('render', onRender);
    map.triggerRepaint();
  });
  const state = (sources: string[] = []): PerfMapState => {
    const styleSources = Object.keys(map.getStyle()?.sources ?? {});
    return {
      cameraMoving: map.isMoving(),
      visibleTilesLoaded: map.areTilesLoaded(),
      sourcesLoading: [...new Set([...styleSources, ...sources])]
        .filter(id => map.getSource(id) && !map.isSourceLoaded(id)),
      sourcesMissing: sources.filter(id => !map.getSource(id)),
    };
  };
  window.__hsPerfSettle = settle;
  window.__hsPerfState = state;
  return () => {
    if (attached === entry) attached = null;
    if (window.__hsPerfSettle === settle) delete window.__hsPerfSettle;
    if (window.__hsPerfState === state) delete window.__hsPerfState;
  };
}

/** Start time for a mark; call on the first line of the handler being timed. */
export function perfStart(): number {
  return perfEnabled() ? performance.now() : 0;
}

/**
 * Close the marks on the first rendered frame at which every source in
 * `sources` has its data loaded, the camera has stopped and all visible tiles
 * are loaded. Call right after the change being timed has been handed to the
 * map (camera move started, source data set).
 */
export function perfEnd(measures: PerfMeasure[], t0: number, detail: PerfDetail = {}, sources: string[] = []) {
  if (!perfEnabled()) return;
  const target = attached;
  if (!target) {
    perfFail(measures, 'Map is not ready', detail);
    return;
  }
  const { map, renderer } = target;
  const onRender = () => {
    if (map.isMoving() || !map.areTilesLoaded()) return;
    if (!sources.every(id => map.getSource(id) && map.isSourceLoaded(id))) return;
    map.off('render', onRender);
    const ms = Math.round(performance.now() - t0);
    const ts = new Date().toISOString();
    for (const measure of measures) emit({ measure, ms, ts, renderer, ...detail });
  };
  map.on('render', onRender);
  // An already-settled map renders no further frame on its own. While it is
  // moving or loading this is a no-op.
  map.triggerRepaint();
}

/** Record a flow that failed (no hydrant found, no route, API error) instead of timing it. */
export function perfFail(measures: PerfMeasure[], message: string, detail: PerfDetail = {}) {
  if (!perfEnabled()) return;
  const ts = new Date().toISOString();
  for (const measure of measures) emit({ measure, status: 'error', message, ts, ...detail });
}
