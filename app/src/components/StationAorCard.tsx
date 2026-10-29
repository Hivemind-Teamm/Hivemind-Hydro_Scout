'use client';

// Admin: edit each station's Area of Responsibility and keep hydrant barangays
// in sync with their GPS position. Firestore rules compare hydrant.barangay to
// stations/{id}.aorBarangays, so both use names from lib/qc-barangays.json.

import { useEffect, useMemo, useState } from 'react';
import { useStations, updateStationAor } from '../data/stations';
import { assignHydrantBarangays } from '../data/store';
import type { Hydrant } from '../data/hydrants';
import { barangayAt, barangayNames, loadBarangayBoundaries, type BarangayCollection } from '@/lib/barangay-boundaries';
import { aorPresetFor } from '@/lib/station-aor';

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(item => b.includes(item));

export default function StationAorCard({ hydrants }: { hydrants: Hydrant[] }) {
  const { stations, loading } = useStations();
  const [boundaries, setBoundaries] = useState<BarangayCollection | null>(null);
  const [boundaryError, setBoundaryError] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<{ stationId: string; barangays: string[] } | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBarangayBoundaries()
      .then(data => { if (!cancelled) setBoundaries(data); })
      .catch(() => { if (!cancelled) setBoundaryError(true); });
    return () => { cancelled = true; };
  }, []);

  const names = useMemo(() => boundaries ? barangayNames(boundaries) : [], [boundaries]);
  const station = stations.find(item => item.id === selectedId) ?? stations[0] ?? null;
  const editing = draft && station && draft.stationId === station.id ? draft.barangays : station?.aorBarangays ?? [];
  const dirty = !!station && !sameSet(editing, station.aorBarangays);
  const preset = station ? aorPresetFor(station.name) : null;
  const unknown = editing.filter(name => boundaries && !names.includes(name));
  const query = search.trim().toLowerCase();
  const visibleNames = names.filter(name => name.toLowerCase().includes(query))
    .sort((a, b) => Number(editing.includes(b)) - Number(editing.includes(a)) || a.localeCompare(b));

  // Which other station already covers each barangay (overlaps are allowed, but flagged).
  const owners = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of stations) {
      if (item.id === station?.id) continue;
      for (const name of item.aorBarangays) map.set(name, [...(map.get(name) ?? []), item.name]);
    }
    return map;
  }, [stations, station?.id]);

  const covered = new Set(stations.flatMap(item => item.aorBarangays));
  const coverage = stations.map(item => ({
    station: item, count: hydrants.filter(hydrant => item.aorBarangays.includes(hydrant.barangay)).length,
  }));
  const uncovered = hydrants.filter(hydrant => !covered.has(hydrant.barangay));

  const changes = useMemo(() => !boundaries ? [] : hydrants.flatMap(hydrant => {
    const next = barangayAt(boundaries, hydrant.lat, hydrant.lng);
    return next && next !== hydrant.barangay ? [{ id: hydrant.id, from: hydrant.barangay, barangay: next }] : [];
  }), [boundaries, hydrants]);

  function setBarangays(barangays: string[]) {
    if (!station) return;
    setMessage(null);
    setDraft({ stationId: station.id, barangays });
  }

  function toggle(name: string) {
    setBarangays(editing.includes(name) ? editing.filter(item => item !== name) : [...editing, name]);
  }

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(null);
    setActionError(null);
    try {
      await action();
      setMessage(done);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      setActionError(code === 'permission-denied'
        ? 'Firestore denied this change. Confirm you are an admin and the updated Firestore rules are deployed.'
        : error instanceof Error ? error.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="min-w-0 w-full rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 md:p-5">
      <h2 className="text-base font-extrabold text-neutral-800 dark:text-neutral-100">Areas of Responsibility</h2>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        Station accounts and approved members can pin, edit and report hydrants only inside their station&apos;s barangays. Admins are not restricted.
      </p>
      {boundaryError && <p role="alert" className="mt-2 text-xs text-red-600">Barangay boundaries could not load. Refresh the page to try again.</p>}
      {message && <p role="status" className="mt-2 text-xs text-[#2fbf4f]">{message}</p>}
      {actionError && <p role="alert" className="mt-2 text-xs text-red-600">{actionError}</p>}

      {/* Hydrant barangays (backfill) */}
      <div className="mt-4 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
        <h3 className="text-sm font-bold text-neutral-700 dark:text-neutral-200">Hydrant barangays</h3>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          {!boundaries ? 'Loading barangay boundaries…'
            : changes.length === 0 ? 'Every hydrant’s barangay matches its GPS position.'
              : `${changes.length} hydrant${changes.length === 1 ? '' : 's'} need a barangay from GPS. Hydrants without one can only be edited by an admin.`}
        </p>
        {changes.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void run(() => assignHydrantBarangays(changes), `Assigned barangays to ${changes.length} hydrants.`)}
              className="rounded-lg bg-[#e0353b] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
              {busy ? 'Saving…' : `Assign barangays to ${changes.length} hydrants`}
            </button>
            <button type="button" onClick={() => setShowChanges(current => !current)} className="text-xs font-semibold text-neutral-500 hover:underline dark:text-neutral-400">
              {showChanges ? 'Hide changes' : 'Review changes'}
            </button>
          </div>
        )}
        {showChanges && changes.length > 0 && (
          <ul className="mt-2 max-h-40 overflow-y-auto text-[11px] text-neutral-600 dark:text-neutral-300">
            {changes.map(change => <li key={change.id}><code>{change.id}</code>: {change.from} → <b>{change.barangay}</b></li>)}
          </ul>
        )}
      </div>

      {/* Coverage */}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
        {coverage.map(({ station: item, count }) => (
          <span key={item.id} className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {item.name}: <b>{item.aorBarangays.length}</b> barangays · <b>{count}</b> hydrants
          </span>
        ))}
        {uncovered.length > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            {uncovered.length} hydrants outside every station AOR (admin-only)
          </span>
        )}
      </div>

      {/* Station editor */}
      {loading ? <p className="mt-4 text-sm text-neutral-400">Loading stations…</p> : !station ? <p className="mt-4 text-sm text-neutral-400">No active stations yet.</p> : (
        <div className="mt-4">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
            Station
            <select value={station.id} onChange={event => { setSelectedId(event.target.value); setDraft(null); setMessage(null); }} className="admin-input">
              {stations.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
            </select>
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-semibold text-neutral-600 dark:text-neutral-300">{editing.length} barangays selected</span>
            {preset && !sameSet(editing, preset.barangays) && (
              <button type="button" onClick={() => setBarangays(preset.barangays)} className="rounded-lg border border-neutral-200 px-2 py-1 font-bold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
                Use BFP sheet for {preset.label}
              </button>
            )}
          </div>

          {unknown.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              Not a known barangay boundary, so no hydrant can match it: {unknown.map(name => (
                <button key={name} type="button" onClick={() => toggle(name)} className="ml-1 font-bold underline">{name} ×</button>
              ))}
            </p>
          )}

          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search Quezon City barangays" className="admin-input mt-2 w-full" />
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
            {visibleNames.map(name => (
              <label key={name} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                <input type="checkbox" checked={editing.includes(name)} onChange={() => toggle(name)} className="accent-[#e0353b]" />
                <span className="text-neutral-700 dark:text-neutral-200">{name}</span>
                {owners.has(name) && <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400">also {owners.get(name)!.join(', ')}</span>}
              </label>
            ))}
            {boundaries && visibleNames.length === 0 && <p className="px-3 py-3 text-xs text-neutral-400">No matching barangays.</p>}
          </div>

          <div className="mt-3 flex gap-2">
            <button type="button" disabled={!dirty || busy} onClick={() => void run(async () => { await updateStationAor(station.id, editing); setDraft(null); }, `Saved ${station.name}'s area of responsibility.`)}
              className="rounded-lg bg-[#e0353b] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save AOR'}
            </button>
            {dirty && <button type="button" onClick={() => setDraft(null)} className="rounded-lg px-3 py-2 text-sm font-semibold text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">Discard</button>}
          </div>
        </div>
      )}
    </section>
  );
}
