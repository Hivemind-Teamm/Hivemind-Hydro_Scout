'use client';
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { FiX } from 'react-icons/fi';
import { db } from '@/lib/firebase';
import { fireIncidentDetails, type FireIncidentDetails } from '@/lib/fire-incident-details';

export default function FireIncidentDetailsPanel({ incidentId, onClose, onViewMap }: {
  incidentId: string; onClose: () => void; onViewMap: (lat: number, lng: number) => void;
}) {
  const [state, setState] = useState<{ details: FireIncidentDetails | null; error: boolean }>({ details: null, error: false });
  useEffect(() => onSnapshot(doc(db, 'fireIncidents', incidentId), snapshot => {
    setState({ details: snapshot.exists() ? fireIncidentDetails(snapshot.data()) : null, error: !snapshot.exists() });
  }, () => setState({ details: null, error: true })), [incidentId]);
  const details = state.details;
  return <section aria-label="Fire incident details" className="pointer-events-auto absolute bottom-24 left-3 right-3 z-[1150] overflow-hidden rounded-xl bg-white shadow-xl dark:bg-neutral-900 sm:bottom-auto sm:left-auto sm:right-4 sm:top-[4.75rem] sm:w-80">
    <header className="flex items-center justify-between bg-[#e0353b] px-4 py-3 text-white">
      <h2 className="text-sm font-bold">Fire Incident Details</h2>
      <button type="button" onClick={onClose} aria-label="Close fire incident details" className="rounded p-1 hover:bg-white/15"><FiX /></button>
    </header>
    <div className="space-y-3 p-4 text-xs">
      {state.error ? <p role="alert">Incident details are unavailable. Please try again.</p> : !details ? <p role="status">Loading incident details…</p> : <>
        <dl className="space-y-2 text-neutral-800 dark:text-neutral-100">
          <div><dt className="text-neutral-500">Status</dt><dd className="font-semibold">{details.status === 'active' ? 'Active' : 'Cleared'}</dd></div>
          <div><dt className="text-neutral-500">Latitude</dt><dd>{details.lat.toFixed(6)}</dd></div>
          <div><dt className="text-neutral-500">Longitude</dt><dd>{details.lng.toFixed(6)}</dd></div>
          <div><dt className="text-neutral-500">Pinned on</dt><dd>{details.pinnedAt === null ? 'Updating…' : `${new Date(details.pinnedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} (PHT)`}</dd></div>
        </dl>
        <button type="button" className="font-semibold text-[#e0353b] hover:underline" onClick={() => onViewMap(details.lat, details.lng)}>View in map</button>
      </>}
    </div>
  </section>;
}
