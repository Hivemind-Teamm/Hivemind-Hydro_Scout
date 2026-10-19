'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp,
} from 'firebase/firestore';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';

const build = {
  version: process.env.NEXT_PUBLIC_BUILD_VERSION ?? '',
  commit: process.env.NEXT_PUBLIC_BUILD_COMMIT ?? '',
  id: process.env.NEXT_PUBLIC_BUILD_ID ?? '',
  builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? '',
  sourceState: process.env.NEXT_PUBLIC_BUILD_SOURCE_STATE ?? 'unknown',
};

type FrozenBuild = {
  id: string;
  version: string;
  commit: string;
  builtAt: Timestamp;
  frozenAt: Timestamp | null;
  frozenBy: string;
  notes: string;
  sourceState: string;
  pending: boolean;
};

function dateLabel(value: Date | null) {
  return value ? new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
  }).format(value) : 'Awaiting server confirmation';
}

export default function BuildVersionLog({ adminNames = {} }: { adminNames?: Record<string, string> }) {
  const { user, role } = useAuth();
  const [records, setRecords] = useState<FrozenBuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [fromCache, setFromCache] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user || role !== 'admin') return;
    return onSnapshot(query(collection(db, 'buildVersions'), orderBy('frozenAt', 'desc')),
      { includeMetadataChanges: true }, snapshot => {
        setRecords(snapshot.docs.map(entry => ({
          ...entry.data(), id: entry.id, pending: entry.metadata.hasPendingWrites,
        }) as FrozenBuild));
        setFromCache(snapshot.metadata.fromCache);
        setLoading(false);
        setLoadError('');
      }, () => {
        setLoadError('Cannot load the version log. Check your connection and admin access, and ensure the build-log security rules are deployed.');
        setLoading(false);
      });
  }, [user, role]);

  if (!user || role !== 'admin') return null;

  const alreadyFrozen = records.some(record => record.id === build.id);
  const production = process.env.NODE_ENV === 'production';
  const identified = /^[a-f0-9]{40}$/.test(build.commit) && !!build.id && !!build.version && Number.isFinite(Date.parse(build.builtAt));
  const disabled = !production || !identified || loading || !!loadError || fromCache || alreadyFrozen || saving || saved;

  async function freeze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !user) return;
    setSaving(true);
    setSaveError('');
    try {
      await setDoc(doc(db, 'buildVersions', build.id), {
        chapter: 3,
        version: build.version,
        commit: build.commit,
        buildId: build.id,
        sourceState: build.sourceState,
        builtAt: Timestamp.fromDate(new Date(build.builtAt)),
        frozenAt: serverTimestamp(),
        frozenBy: user.uid,
        notes: notes.trim(),
      });
      setSaved(true);
      setNotes('');
    } catch {
      setSaveError('The freeze record could not be saved. Check your connection and permissions. If another admin recorded this build, its entry will appear in the log.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="build-log-title" className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="space-y-4 p-4 md:p-6">
        <div>
          <h2 id="build-log-title" className="text-base font-extrabold text-neutral-800 dark:text-neutral-100">Chapter 3 Build Version Log</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Record the build used for Chapter 3. Freeze records are permanent and shared with all admins.</p>
        </div>
        <dl className="grid gap-3 rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-950 sm:grid-cols-2">
          <div><dt className="text-neutral-500">Running version</dt><dd className="font-bold">{build.version || 'Unavailable'}</dd></div>
          <div><dt className="text-neutral-500">Built at (Philippine time)</dt><dd>{identified ? dateLabel(new Date(build.builtAt)) : 'Unavailable'}</dd></div>
          <div><dt className="text-neutral-500">Source commit</dt><dd className="break-all font-mono text-xs">{build.commit || 'Unavailable'}</dd></div>
          <div><dt className="text-neutral-500">Build ID</dt><dd className="break-all font-mono text-xs">{build.id || 'Unavailable'}</dd></div>
        </dl>
        {build.sourceState !== 'clean' && <p className="text-xs text-amber-700 dark:text-amber-400">{build.sourceState === 'modified' ? 'This build includes uncommitted source changes.' : 'Source working-tree status is unavailable.'} This status will be included in the freeze record.</p>}
        <form onSubmit={freeze} className="space-y-3">
          <label className="block text-sm font-bold" htmlFor="build-freeze-notes">Freeze notes (optional)</label>
          <textarea id="build-freeze-notes" maxLength={1000} rows={2} value={notes} disabled={disabled}
            onChange={event => setNotes(event.target.value)} placeholder="Evaluation scope or reason for this baseline"
            className="w-full rounded-lg border border-neutral-300 p-3 text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950" />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">The freeze date and time are recorded when the server saves this entry. Recording a baseline does not stop future development or create a backup of live data.</p>
          {!production && <p className="text-sm text-amber-700 dark:text-amber-400">Development preview. Open a production build to record a frozen version.</p>}
          {production && !identified && <p role="alert" className="text-sm text-red-600">Build identity is incomplete. Rebuild with the source commit available before recording a freeze.</p>}
          <button type="submit" disabled={disabled} className="rounded-lg bg-[#e0353b] px-4 py-2 text-sm font-bold text-white hover:bg-[#c42d32] disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Recording freeze...' : alreadyFrozen || saved ? 'This build is recorded' : 'Record frozen build'}
          </button>
          {saved && <p role="status" className="text-sm text-green-700 dark:text-green-400">Frozen build recorded successfully.</p>}
          {saveError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
        </form>
        {loadError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
        {loading ? <p role="status" className="text-sm text-neutral-500">Loading version log...</p> : !loadError && <>
          {fromCache && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Showing cached history. Reconnect to record a freeze.</p>}
          {records.length === 0 ? <p className="text-sm text-neutral-500">No frozen builds recorded yet.</p> : (
            <div className="overflow-x-auto">
              <p className="mb-2 text-xs text-neutral-500 sm:hidden">Scroll across to see the full version log.</p>
              <table style={{ minWidth: 800 }} className="w-full text-left text-sm">
                <caption className="sr-only">Chapter 3 frozen build history; all times in Asia/Manila</caption>
                <thead className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-700"><tr>
                  <th scope="col" className="p-3">Version / Build</th><th scope="col" className="p-3">Frozen at (PH)</th><th scope="col" className="p-3">Recorded by</th><th scope="col" className="p-3">Notes</th>
                </tr></thead>
                <tbody>{records.map(record => <tr key={record.id} className="border-b border-neutral-100 align-top dark:border-neutral-800">
                  <td className="p-3"><p className="font-bold">{record.version}{record.id === build.id ? ' (running build)' : ''}</p><p className="mt-1 break-all font-mono text-xs">{record.id}</p><p className="mt-1 break-all font-mono text-xs text-neutral-500">Commit: {record.commit}</p><p className="mt-1 text-xs text-neutral-500">Built: {dateLabel(record.builtAt.toDate())}</p>{record.sourceState !== 'clean' && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{record.sourceState === 'modified' ? 'Includes uncommitted changes' : 'Source status unknown'}</p>}</td>
                  <td className="whitespace-nowrap p-3">{record.pending ? 'Awaiting server confirmation' : dateLabel(record.frozenAt?.toDate() ?? null)}</td>
                  <td className="max-w-48 break-all p-3"><p>{adminNames[record.frozenBy] || 'Admin'}</p><p className="mt-1 font-mono text-xs text-neutral-500">{record.frozenBy}</p></td>
                  <td className="min-w-48 whitespace-pre-wrap break-words p-3">{record.notes || 'No notes'}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </>}
      </div>
    </section>
  );
}
