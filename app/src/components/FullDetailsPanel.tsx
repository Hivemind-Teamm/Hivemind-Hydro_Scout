'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/lib/auth-context';
import { type Hydrant, STATUS_META } from '../data/hydrants';
import { formatDistance } from '@/lib/haversine';
import { deleteHydrantPhoto, setDisplayPhoto } from '../data/store';

type Tab = 'quick' | 'details' | 'register' | 'admin';

const PRESSURE_COLOR: Record<string, string> = {
  Strong: '#2fbf4f', Moderate: '#f5a623', Low: '#e05c2a', None: '#9aa0a6',
};

interface FullDetailsPanelProps {
  hydrant: Hydrant;
  onClose: () => void;
  onViewUser: (name: string, role: string) => void;
  onFlyTo: (lat: number, lng: number) => void;
  distanceM?: number | null;
  isOtw?: boolean;
}

type PhotoMenu = { url: string; x: number; y: number; confirming: boolean } | null;

export default function FullDetailsPanel({ hydrant, onClose, onViewUser, onFlyTo, distanceM, isOtw }: FullDetailsPanelProps) {
  const { role } = useAuth();
  const [tab, setTab] = useState<Tab>('quick');
  const [photoMenu, setPhotoMenu] = useState<PhotoMenu>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = STATUS_META[hydrant.status];

  const isHeadOrAdmin = role === 'head' || role === 'admin';
  const canAnnotate   = role === 'authorized' || role === 'head' || role === 'admin';

  // Close menu on outside click
  useEffect(() => {
    if (!photoMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setPhotoMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [photoMenu]);

  const handlePhotoContextMenu = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    setPhotoMenu({ url, x: e.clientX, y: e.clientY, confirming: false });
  };

  const handleMakeDisplay = async () => {
    if (!photoMenu) return;
    setMenuBusy(true);
    try { await setDisplayPhoto(hydrant.id, photoMenu.url, hydrant.photos); }
    finally { setMenuBusy(false); setPhotoMenu(null); }
  };

  const handleDelete = async () => {
    if (!photoMenu) return;
    setMenuBusy(true);
    try { await deleteHydrantPhoto(hydrant.id, photoMenu.url); }
    finally { setMenuBusy(false); setPhotoMenu(null); }
  };

  // Admin tab is always visible — non-head/admin see a restricted-access screen.

  return (
    <div className="anim-slide-right pointer-events-auto absolute bottom-0 right-0 top-[69px] z-[3000] flex w-[420px] flex-col bg-white dark:bg-neutral-900 shadow-2xl">

      {/* ── Header ── */}
      <div className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
        {/* lead photo — the additional/detail shot (photos[1]), else the main one */}
        {hydrant.photos.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hydrant.photos[1] ?? hydrant.photos[0]}
            alt={`${hydrant.name} field photo`}
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-500">
            <UploadIcon />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onFlyTo(hydrant.lat, hydrant.lng)}
              className="flex items-center gap-1 text-sm font-bold text-neutral-800 hover:underline dark:text-neutral-100"
              title="Zoom to hydrant"
            >
              <LocateIcon />
              <span className="truncate">{hydrant.name}</span>
            </button>
            <span className="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
              {hydrant.type}
            </span>
          </div>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{hydrant.id} · {hydrant.area}</p>
          <span
            className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
            style={{ background: meta.color }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            {meta.legendLabel.toUpperCase()}
          </span>
        </div>

        <button
          onClick={onClose}
          className="mt-0.5 shrink-0 rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          ✕
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-neutral-200 text-[11px] font-bold uppercase tracking-wide dark:border-neutral-700">
        {(['quick', 'details', 'register', 'admin'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 transition-colors ${
              tab === t
                ? 'border-b-2 border-[#FED42E] text-[#FED42E]'
                : 'text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300'
            }`}
          >
            {t === 'admin' ? (
              <span className="flex items-center justify-center gap-1">
                Admin
                <LockIcon locked={!isHeadOrAdmin} />
              </span>
            ) : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'quick'    && <QuickTab    hydrant={hydrant} meta={meta} distanceM={distanceM} isOtw={isOtw} />}
        {tab === 'details'  && <DetailsTab  hydrant={hydrant} onViewUser={onViewUser} canAnnotate={canAnnotate} isHeadOrAdmin={isHeadOrAdmin} onPhotoContextMenu={handlePhotoContextMenu} />}
        {tab === 'register' && <RegisterTab hydrant={hydrant} onViewUser={onViewUser} />}
        {tab === 'admin'    && <AdminTab    hydrant={hydrant} isHeadOrAdmin={isHeadOrAdmin} />}
      </div>

      {/* Photo context menu — rendered via portal to escape the CSS transform stacking context */}
      {photoMenu && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: photoMenu.y, left: photoMenu.x, zIndex: 99999 }}
          className="min-w-[190px] overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
        >
          {!photoMenu.confirming ? (
            <>
              <button
                onClick={() => { window.open(photoMenu.url, '_blank'); setPhotoMenu(null); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                View Full Image
              </button>
              <button
                onClick={handleMakeDisplay}
                disabled={menuBusy || hydrant.photos[0] === photoMenu.url}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
                {hydrant.photos[0] === photoMenu.url ? 'Already Display Photo' : menuBusy ? 'Updating…' : 'Make Display Photo'}
              </button>
              <div className="mx-3 h-px bg-neutral-100 dark:bg-neutral-700" />
              <button
                onClick={() => setPhotoMenu({ ...photoMenu, confirming: true })}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium text-[#91191E] hover:bg-red-50 dark:text-[#e0353b] dark:hover:bg-red-950/40"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                Delete Image
              </button>
            </>
          ) : (
            <div className="px-4 py-3">
              <p className="mb-2.5 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200">Delete this photo permanently?</p>
              <div className="flex gap-2">
                <button onClick={handleDelete} disabled={menuBusy} className="flex-1 rounded-lg bg-[#91191E] py-1.5 text-[11px] font-bold text-white hover:bg-[#7a1419] disabled:opacity-60">
                  {menuBusy ? 'Deleting…' : 'Delete'}
                </button>
                <button onClick={() => setPhotoMenu(null)} className="flex-1 rounded-lg border border-neutral-200 py-1.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ──────────────────────── QUICK ──────────────────────── */
function QuickTab({ hydrant, meta, distanceM, isOtw }: { hydrant: Hydrant; meta: { color: string; legendLabel: string }; distanceM?: number | null; isOtw?: boolean }) {
  const distanceValue = distanceM != null
    ? (
      <span className={`font-semibold ${isOtw ? 'text-red-600 dark:text-red-400' : 'text-neutral-800 dark:text-neutral-100'}`}>
        {formatDistance(distanceM)}{isOtw && <span className="ml-1.5 font-normal text-red-400">· En Route</span>}
      </span>
    )
    : `${hydrant.distanceM} m · ${hydrant.distanceMin} min`;

  return (
    <div className="px-4 py-4">
      <InfoTable rows={[
        { label: 'Status',   value: <span className="font-bold" style={{ color: meta.color }}>• {meta.legendLabel}</span> },
        { label: 'Pressure', value: <span className="font-bold" style={{ color: PRESSURE_COLOR[hydrant.pressure] }}>{hydrant.pressure}</span> },
        { label: 'Distance', value: distanceValue },
        { label: 'Hazard',   value: hydrant.hazard },
        { label: 'Landmark', value: hydrant.landmark },
      ]} />

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Visible to all roles</span>
          <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
        </div>
        <p className="rounded-lg bg-neutral-100 px-3 py-2.5 text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          General users see station, distance, route, landmark and the lead photo — enough to act, without exposing unverified internal flags.
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────── DETAILS ──────────────────────── */
function DetailsTab({ hydrant, onViewUser, canAnnotate, isHeadOrAdmin, onPhotoContextMenu }: {
  hydrant: Hydrant;
  onViewUser: (name: string, role: string) => void;
  canAnnotate: boolean;
  isHeadOrAdmin: boolean;
  onPhotoContextMenu: (e: React.MouseEvent, url: string) => void;
}) {
  return (
    <div className="px-4 py-4">
      <InfoTable rows={[
        { label: 'Type',           value: `${hydrant.type} · ${hydrant.mounting}` },
        { label: 'Key / Wrench',   value: hydrant.keyWrench },
        { label: 'Area',           value: hydrant.area },
        { label: 'Outlet / s',     value: String(hydrant.outlets) },
        { label: 'Color',          value: hydrant.color },
        { label: 'Concessionaire', value: hydrant.concessionaire },
      ]} />

      {/* Photo plate */}
      <div className="mt-5">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Photo Plate</p>
        {hydrant.photos.length === 0 ? (
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">No photos yet. Add them via Edit Hydrant Status.</p>
        ) : (
          <div className="grid grid-cols-5 gap-1.5">
            {[...hydrant.photos].reverse().map((url, i) => (
              <div
                key={url}
                className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-neutral-200 hover:opacity-90 dark:border-neutral-700"
                onClick={() => window.open(url, '_blank')}
                onContextMenu={isHeadOrAdmin ? (e) => onPhotoContextMenu(e, url) : undefined}
                title={isHeadOrAdmin ? 'Click to view · Right-click for options' : 'Click to view'}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`${hydrant.name} photo ${i + 1}`} className="h-full w-full object-cover" />
                {hydrant.photos[0] === url && (
                  <span className="absolute bottom-0 left-0 right-0 bg-black/50 py-0.5 text-center text-[8px] font-bold uppercase tracking-wide text-white">Display</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>


      {/* Field notes */}
      <div className="mt-5">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Field Notes</p>
        {hydrant.notes.length === 0 && (
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">No notes yet.</p>
        )}
        <div className="flex flex-col gap-3">
          {hydrant.notes.map((n, i) => (
            <div key={i} className="flex gap-2">
              <button
                onClick={() => onViewUser(n.user, 'Authorized User')}
                title={`View ${n.user}'s profile`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-bold text-neutral-600 hover:bg-[#FED42E] transition-colors dark:bg-neutral-700 dark:text-neutral-300"
              >
                {n.initials}
              </button>
              <div className="flex-1 rounded-lg bg-neutral-100 px-2.5 py-2 dark:bg-neutral-800">
                <button
                  onClick={() => onViewUser(n.user, 'Authorized User')}
                  className="text-[10px] font-semibold text-[#91191E] hover:underline mb-0.5 block dark:text-[#e0353b]"
                >
                  {n.user}
                </button>
                <p className="text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-200">{n.text}</p>
                <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">{n.date}</p>
              </div>
            </div>
          ))}
        </div>
        {canAnnotate && (
          <button className="mt-3 w-full text-right text-xs font-medium text-[#91191E] hover:underline dark:text-[#e0353b]">
            Add notes
          </button>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────── REGISTER ──────────────────────── */
function RegisterTab({ hydrant, onViewUser }: { hydrant: Hydrant; onViewUser: (name: string, role: string) => void }) {
  return (
    <div className="px-4 py-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        Status Register — Chronological
      </p>

      <div className="flex flex-col gap-3">
        {hydrant.register.map((entry, i) => (
          <div key={i} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.statusColor }} />
              {i < hydrant.register.length - 1 && <div className="mt-1 w-px flex-1 bg-neutral-200 dark:bg-neutral-700" />}
            </div>
            <div className="pb-3">
              <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-100">{entry.action}</p>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                by{' '}
                <button
                  onClick={() => onViewUser(entry.by, entry.role)}
                  className="font-semibold text-[#91191E] hover:underline dark:text-[#e0353b]"
                >
                  {entry.by}
                </button>
                {' '}· {entry.role}
              </p>
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{entry.date}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        <span className="mt-0.5 shrink-0">ⓘ</span>
        <p>Inspector names stay visible to logged-in users (lawful under RA 10173) so inspectors can confirm their own work. Entries are immutable once signed.</p>
      </div>
    </div>
  );
}

/* ──────────────────────── ADMIN ──────────────────────── */
function AdminTab({ hydrant, isHeadOrAdmin }: { hydrant: Hydrant; isHeadOrAdmin: boolean }) {
  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      {/* Restricted access banner — always shown */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
        <span className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <span className="font-bold">Restricted to Head &amp; Admin</span> — enforced by Firestore security rules, not just hidden in the interface.
        </p>
      </div>

      {/* Everything below is head/admin only */}
      {isHeadOrAdmin && (
        <>
          <table className="w-full text-xs">
            <tbody>
              {[
                { label: 'Internal ID',     value: hydrant.id },
                { label: 'Data Source',     value: 'Field survey' },
                { label: 'GPS Complete',    value: '✓ Yes',      green: true },
                { label: 'Required Fields', value: '✓ Complete', green: true },
                { label: 'Validation',      value: 'No follow-up needed' },
              ].map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-neutral-50 dark:bg-neutral-800/60' : ''}>
                  <td className="w-36 py-1.5 pl-2 font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{r.label}</td>
                  <td className={`py-1.5 pr-2 font-medium ${r.green ? 'text-[#2fbf4f]' : 'text-neutral-700 dark:text-neutral-200'}`}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-col gap-3 pt-2">
            <p className="text-xs font-bold text-[#91191E] dark:text-[#e0353b]">Administrative Actions</p>
            <button className="w-full rounded-lg border border-neutral-200 py-2.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
              Validate Hydrant Record
            </button>
            <button className="w-full rounded-lg border border-neutral-200 py-2.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
              Flag for Re-inspection
            </button>
            <button className="w-full rounded-lg border border-red-200 py-2.5 text-xs font-semibold text-[#91191E] hover:bg-red-50 dark:border-red-500/30 dark:text-[#e0353b] dark:hover:bg-red-950/40">
              Decommission Hydrant
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ──────────────────────── lock icon ──────────────────────── */
function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg
      width="9" height="9" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round"
      className={locked ? 'text-amber-500' : 'text-[#2fbf4f]'}
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d={locked ? 'M7 11V7a5 5 0 0 1 10 0v4' : 'M7 11V7a5 5 0 0 1 9.9-1'} />
    </svg>
  );
}

/* ──────────────────────── shared ──────────────────────── */
function InfoTable({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={i % 2 === 0 ? 'bg-neutral-50 dark:bg-neutral-800/60' : ''}>
            <td className="w-32 py-1.5 pl-2 font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{r.label}</td>
            <td className="py-1.5 pr-2 text-neutral-700 dark:text-neutral-200">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UploadIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <polyline points="16 12 12 8 8 12" />
      <line x1="12" y1="8" x2="12" y2="16" />
    </svg>
  );
}

function LocateIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}
