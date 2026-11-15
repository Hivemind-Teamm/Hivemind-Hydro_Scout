'use client';

import { useMemo, useState } from 'react';
import type { Hydrant, HydrantStatus } from '../data/hydrants';
import { rankOperationalHydrants } from '@/lib/nearest-hydrant';
import { perfRecord } from '@/lib/perf';

type DatasetKey = 'live' | 'synthetic-48' | 'synthetic-480' | 'synthetic-4800' | 'synthetic-48000';
type Phase = 'trial' | 'valid';

const FIXED_POINT = { lat: 14.63319, lng: 121.04385 };
const DATASETS: Array<{ key: DatasetKey; label: string; size: number | null }> = [
  { key: 'synthetic-48', label: 'Synthetic 48', size: 48 },
  { key: 'synthetic-480', label: 'Synthetic 480', size: 480 },
  { key: 'synthetic-4800', label: 'Synthetic 4,800', size: 4_800 },
  { key: 'synthetic-48000', label: 'Synthetic 48,000', size: 48_000 },
  { key: 'live', label: 'Live test-project data', size: null },
];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function syntheticHydrants(source: Hydrant[], size: number): Hydrant[] {
  const usable = source.filter(h => Number.isFinite(h.lat) && Number.isFinite(h.lng));
  if (usable.length === 0) return [];

  const latitudes = usable.map(h => h.lat);
  const longitudes = usable.map(h => h.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const statuses = usable.map(h => h.status);
  const random = seededRandom(20_261_114 + size);

  return Array.from({ length: size }, (_, index) => {
    const template = usable[index % usable.length];
    const status = statuses[index % statuses.length] as HydrantStatus;
    return {
      ...template,
      id: `P3-SYN-${size}-${index + 1}`,
      name: `P3 synthetic hydrant ${index + 1}`,
      lat: minLat + random() * (maxLat - minLat),
      lng: minLng + random() * (maxLng - minLng),
      status,
    };
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function nextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

export default function P3PerformancePanel({ hydrants, loading }: { hydrants: Hydrant[]; loading: boolean }) {
  const [datasetKey, setDatasetKey] = useState<DatasetKey>('synthetic-48');
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<string>('No P3 run recorded yet.');
  const [lastValidMedian, setLastValidMedian] = useState<number | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  const datasets = useMemo(() => {
    const entries = new Map<DatasetKey, Hydrant[]>();
    entries.set('live', hydrants);
    for (const { key, size } of DATASETS) {
      if (size !== null) entries.set(key, syntheticHydrants(hydrants, size));
    }
    return entries;
  }, [hydrants]);

  const selected = datasets.get(datasetKey) ?? [];
  const selectedLabel = DATASETS.find(dataset => dataset.key === datasetKey)?.label ?? datasetKey;

  async function runSingle(repetitions: number, phase: Phase) {
    if (running || selected.length === 0) return;
    setRunning(true);
    const times: number[] = [];
    try {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const started = performance.now();
        const candidates = rankOperationalHydrants(selected, FIXED_POINT.lat, FIXED_POINT.lng);
        const ms = performance.now() - started;
        times.push(ms);
        perfRecord({
          measure: 'P3',
          ts: new Date().toISOString(),
          ms,
          phase,
          mode: 'single',
          repetition,
          dataset: datasetKey,
          n: selected.length,
          candidatesAfterPrefilter: candidates.length,
          fixedLat: FIXED_POINT.lat,
          fixedLng: FIXED_POINT.lng,
        });
        if (repetition < repetitions) await nextFrame();
      }
      const resultMedian = median(times);
      if (phase === 'valid') {
        setLastValidMedian(resultMedian);
        // The runbook asks for a five-second pause between dataset sizes.
        setCooldownUntil(Date.now() + 5_000);
        window.setTimeout(() => setCooldownUntil(0), 5_000);
      }
      setLastResult(`${phase === 'trial' ? 'Practice' : 'Valid'} ${selectedLabel}: ${repetitions} runs, median ${resultMedian.toFixed(3)} ms.`);
    } finally {
      setRunning(false);
    }
  }

  async function runBatch() {
    if (running || selected.length === 0) return;
    setRunning(true);
    const perCallTimes: number[] = [];
    try {
      for (let repetition = 1; repetition <= 100; repetition += 1) {
        const started = performance.now();
        let candidateCount = 0;
        for (let call = 0; call < 1_000; call += 1) {
          candidateCount = rankOperationalHydrants(selected, FIXED_POINT.lat, FIXED_POINT.lng).length;
        }
        const ms = (performance.now() - started) / 1_000;
        perCallTimes.push(ms);
        perfRecord({
          measure: 'P3',
          ts: new Date().toISOString(),
          ms,
          phase: 'valid',
          mode: 'batch1000',
          repetition,
          callsPerBatch: 1_000,
          dataset: datasetKey,
          n: selected.length,
          candidatesAfterPrefilter: candidateCount,
          fixedLat: FIXED_POINT.lat,
          fixedLng: FIXED_POINT.lng,
        });
        if (repetition < 100) await nextFrame();
      }
      setLastResult(`Valid ${selectedLabel}: 100 batches × 1,000 calls, median ${median(perCallTimes).toFixed(5)} ms per call.`);
    } finally {
      setRunning(false);
    }
  }

  function downloadDataset() {
    if (selected.length === 0) return;
    const contents = JSON.stringify({
      source: datasetKey,
      generatedAt: new Date().toISOString(),
      seed: datasetKey === 'live' ? null : 20_261_114 + selected.length,
      fixedStartPoint: FIXED_POINT,
      hydrants: selected,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `p3-${datasetKey}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadResultsCsv() {
    let records: Array<Record<string, unknown>> = [];
    try {
      const saved = JSON.parse(window.localStorage.getItem('hsPerfLog') ?? '[]');
      records = Array.isArray(saved) ? saved.filter(record => record?.measure === 'P3') : [];
    } catch { /* empty export is still useful evidence of a storage issue */ }
    const header = ['source', 'n', 'mode', 'rep', 'ms', 'candidates_after_prefilter', 'note'];
    const rows = records.map(record => [
      record.dataset ?? '', record.n ?? '', record.mode ?? '', record.repetition ?? '',
      record.ms ?? '', record.candidatesAfterPrefilter ?? '', record.phase ?? '',
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'p3_runs.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const canBatch = lastValidMedian !== null && lastValidMedian < 0.2;
  const coolingDown = cooldownUntil > 0;

  return (
    <aside className="absolute left-3 top-20 z-[3500] w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-cyan-300/50 bg-slate-950/95 p-4 text-slate-100 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black tracking-[0.16em] text-cyan-300 uppercase">Performance test</p>
          <h2 className="mt-1 text-base font-bold">P3: nearest hydrant computation</h2>
        </div>
        <span className="rounded bg-cyan-400/15 px-2 py-1 text-[10px] font-bold text-cyan-200">?perf=p3</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-300">Measures only the production ranking helper: operational filter, 4 km Haversine prefilter, and distance sort. No Firestore, Mapbox, or rendering is timed.</p>

      <label className="mt-4 block text-xs font-semibold text-slate-200" htmlFor="p3-dataset">Dataset</label>
      <select id="p3-dataset" value={datasetKey} onChange={event => { setDatasetKey(event.target.value as DatasetKey); setLastValidMedian(null); }} disabled={running || loading} className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
        {DATASETS.map(dataset => <option key={dataset.key} value={dataset.key}>{dataset.label}{dataset.size === null ? ` (${hydrants.length})` : ''}</option>)}
      </select>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={running || loading || selected.length === 0 || coolingDown} onClick={() => void runSingle(2, 'trial')} className="rounded-md bg-slate-700 px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50">Run 2 practice</button>
        <button type="button" disabled={running || loading || selected.length === 0 || coolingDown} onClick={() => void runSingle(100, 'valid')} className="rounded-md bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">Run 100 valid</button>
      </div>
      <button type="button" disabled={running || loading || selected.length === 0} onClick={downloadDataset} className="mt-2 w-full rounded-md border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50">Download this dataset JSON</button>
      <button type="button" onClick={downloadResultsCsv} className="mt-2 w-full rounded-md border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200">Download P3 CSV</button>
      {canBatch && <button type="button" disabled={running} onClick={() => void runBatch()} className="mt-2 w-full rounded-md bg-amber-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50">Run 100 batches × 1,000 calls</button>}
      {lastValidMedian !== null && !canBatch && <p className="mt-2 text-[11px] text-slate-400">Batch timing is not needed because the median is at least 0.2 ms.</p>}
      <p className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-xs leading-5 text-slate-300">{running ? 'Running… do not change dataset or refresh the page.' : lastResult}</p>
      {coolingDown && <p className="mt-2 text-[11px] text-amber-200">Five-second pause between dataset sizes is active.</p>}
      {loading && <p className="mt-2 text-[11px] text-amber-200">Waiting for the live test-project hydrants to load.</p>}
      {!loading && selected.length === 0 && <p className="mt-2 text-[11px] text-red-300">No usable hydrants are loaded, so P3 cannot run.</p>}
    </aside>
  );
}
