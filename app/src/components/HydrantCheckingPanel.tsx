'use client';

import { useMemo, useState } from 'react';
import { FiCheckCircle, FiClipboard, FiX } from 'react-icons/fi';
import { useAuth } from '@/lib/auth-context';
import { startHydrantCheckingSession, type HydrantCheck, type HydrantCheckingSession } from '@/lib/hydrant-checking';
import type { Hydrant } from '../data/hydrants';

export default function HydrantCheckingPanel({ sessions, selectedSession, onSelectSession, checks, hydrants, onSelectHydrant, onClose }: {
  sessions: HydrantCheckingSession[]; selectedSession: HydrantCheckingSession | null; onSelectSession: (id: string) => void;
  checks: HydrantCheck[]; hydrants: Hydrant[]; onSelectHydrant: (hydrant: Hydrant) => void; onClose: () => void;
}) {
  const { user, role, accountType, stationId, aorBarangays } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = role === 'head' || accountType === 'station';
  const scopedHydrants = role === 'admin' ? [] : hydrants.filter(hydrant => hydrant.status !== 'reference' && aorBarangays.includes(hydrant.barangay));
  const checksByHydrant = useMemo(() => new Map(checks.map(check => [check.hydrantId, check])), [checks]);
  const checked = checks.length;
  const followUps = checks.filter(item => item.status === 'follow-up').length;
  const targetCount = selectedSession?.targetHydrantCount || scopedHydrants.length;
  const remaining = Math.max(0, targetCount - checked);
  const scopedSessions = stationId ? sessions.filter(session => session.stationId === stationId) : sessions;

  async function start() {
    if (!user || !stationId) { setError('Choose a station account to start a checking session.'); return; }
    setSaving(true);
    setError(null);
    try { await startHydrantCheckingSession(name); setName(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start the session.'); }
    finally { setSaving(false); }
  }

  return <>
    <button aria-label="Close hydrant checking" onClick={onClose} className="pointer-events-auto absolute inset-0 z-[3100] bg-black/25" />
    <section className="pointer-events-auto absolute right-4 top-[calc(4.25rem+env(safe-area-inset-top,0px))] z-[3101] flex max-h-[76dvh] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900">
      <header className="flex items-start justify-between gap-3 bg-[#e0353b] px-4 py-3 text-white"><div><h2 className="text-sm font-extrabold uppercase tracking-wide">Hydrant Checking</h2><p className="mt-0.5 text-[11px] text-white/75">Coverage is separate from hydrant condition.</p></div><button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-white/80 hover:bg-white/15"><FiX /></button></header>
      <div className="min-h-0 space-y-3 overflow-y-auto p-4">
        {scopedSessions.length > 0 && <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-300">Session<select value={selectedSession?.id ?? ''} onChange={e => onSelectSession(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-xs dark:border-neutral-700">{scopedSessions.map(session => <option key={session.id} value={session.id}>{session.name}{session.status === 'active' ? ' · Active' : ' · Completed'}</option>)}</select></label>}
        {selectedSession ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20"><div className="flex items-center justify-between"><span className="text-xs font-bold text-amber-900 dark:text-amber-100">{selectedSession.status === 'active' ? 'Checking in progress' : 'Checking completed'}</span><FiClipboard className="text-amber-700" /></div><p className="mt-2 text-lg font-extrabold text-neutral-800 dark:text-white">{checked} / {targetCount} recorded</p><p className="text-[11px] text-neutral-600 dark:text-neutral-300">{remaining ? `${remaining} pending · ` : ''}{followUps} need follow-up</p><p className="mt-3 text-[11px] text-neutral-600 dark:text-neutral-300">The session ends automatically when every hydrant in this coverage list is recorded.</p></div> : <p className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500 dark:bg-neutral-800">No checking sessions have been created yet.</p>}
        {selectedSession && role !== 'admin' && <div><p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500">AoR coverage</p><div className="max-h-48 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">{scopedHydrants.map(hydrant => { const check = checksByHydrant.get(hydrant.id); const label = check ? ({ checked: 'Checked', 'follow-up': 'Follow-up', skipped: 'Skipped' }[check.status]) : 'Pending'; const color = check?.status === 'checked' ? 'text-green-600' : check?.status === 'follow-up' ? 'text-amber-600' : check?.status === 'skipped' ? 'text-neutral-500' : 'text-red-600'; return <button type="button" key={hydrant.id} onClick={() => { onSelectHydrant(hydrant); onClose(); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"><span className="min-w-0"><span className="block truncate text-xs font-semibold text-neutral-800 dark:text-neutral-100">{hydrant.name}</span><span className="block text-[10px] text-neutral-400">{hydrant.id}</span></span><span className={`shrink-0 text-[10px] font-bold ${color}`}>{label}</span></button>; })}</div></div>}
        {canManage && stationId && !scopedSessions.some(session => session.status === 'active') && <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"><p className="text-xs font-bold text-neutral-700 dark:text-neutral-100">Start a checking session</p><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Diliman Field Check — Nov 3" maxLength={120} className="mt-2 w-full rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-xs dark:border-neutral-700"/><button disabled={saving || !name.trim()} onClick={start} className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#e0353b] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"><FiCheckCircle /> Start session</button></div>}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  </>;
}
