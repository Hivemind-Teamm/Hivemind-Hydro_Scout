'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-media-query';
import { type Hydrant, STATUS_META } from '../data/hydrants';
import { type Report, STATUS_COLORS } from '../data/reports';
import { formatDistance } from '@/lib/haversine';
import { proxiedPhotoUrl } from '@/lib/photo-url';
import { deleteHydrantPhoto, setDisplayPhoto, validateHydrant, flagForReinspection, deleteHydrant } from '../data/store';
import PillBadge from './PillBadge';
import AvatarPlaceholder from './AvatarPlaceholder';
import { FiX, FiCheck } from 'react-icons/fi';

type Tab = 'quick' | 'details' | 'log' | 'admin';

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
  linkedReports?: Report[];
}

type PhotoMenu = { url: string; x: number; y: number; confirming: boolean } | null;

export default function FullDetailsPanel({ hydrant, onClose, onViewUser, onFlyTo, distanceM, isOtw, linkedReports = [] }: FullDetailsPanelProps) {
  const { role } = useAuth();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('quick');
  const [photoMenu, setPhotoMenu] = useState<PhotoMenu>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = STATUS_META[hydrant.status];

  const isAdmin       = role === 'admin';
  const isHeadOrAdmin = role === 'head' || role === 'admin';
  const canAnnotate   = role === 'authorized' || role === 'head' || role === 'admin';
  // General users (and not-signed-in guests) get the restricted, view-only,
  // anonymized version of the panel.
  const isGeneralView = !role || role === 'general';

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

  // General/guest: Quick + Details only (Log & Admin hidden completely).
  const tabs: Tab[] = isAdmin
    ? ['quick', 'details', 'log', 'admin']
    : isGeneralView
      ? ['quick', 'details']
      : ['quick', 'details', 'log'];

  const tabLabel: Record<Tab, string> = { quick: 'Quick', details: 'Details', log: 'Log', admin: 'Admin' };

  return (
    <div className={
      isMobile
        ? 'anim-slide-up pointer-events-auto absolute inset-x-0 bottom-0 z-[3000] flex h-[80vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-neutral-800'
        : 'anim-slide-right pointer-events-auto absolute bottom-0 right-0 top-[4.3125rem] z-[3000] flex w-[26.25rem] flex-col bg-white shadow-2xl dark:bg-neutral-800'
    }>

      {/* ── Header ── */}
      <div className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
        {/* lead photo — the additional/detail shot (photos[1]), else the main one */}
        {hydrant.photos.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxiedPhotoUrl(hydrant.photos[1] ?? hydrant.photos[0], 160)}
            alt={`${hydrant.name} field photo`}
            decoding="async"
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-400">
            <UploadIcon />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onFlyTo(hydrant.lat, hydrant.lng)}
              className="flex items-center gap-1 text-sm font-bold text-neutral-800 transition-all duration-150 ease-out hover:text-[#e0353b] hover:translate-x-0.5 active:scale-[0.97] active:duration-75 dark:text-neutral-100"
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
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-all duration-150 ease-out hover:bg-neutral-100 hover:text-neutral-700 hover:scale-110 active:scale-90 active:duration-75 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          aria-label="Close"
        >
          <FiX className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-neutral-200 text-[11px] font-bold uppercase tracking-wide dark:border-neutral-700">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 transition-colors ${
              tab === t
                ? 'border-b-2 border-[#FED42E] text-[#FED42E]'
                : 'text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300'
            }`}
          >
            {tabLabel[t]}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto">
        {tab === 'quick'   && <QuickTab   hydrant={hydrant} meta={meta} distanceM={distanceM} isOtw={isOtw} />}
        {tab === 'details' && <DetailsTab hydrant={hydrant} onViewUser={onViewUser} canAnnotate={canAnnotate} isHeadOrAdmin={isHeadOrAdmin} isGeneralView={isGeneralView} onPhotoContextMenu={handlePhotoContextMenu} onViewPhoto={setLightbox} />}
        {tab === 'log'     && <MaintenanceTab hydrant={hydrant} linkedReports={linkedReports} onViewUser={onViewUser} />}
        {tab === 'admin'   && <AdminTab   hydrant={hydrant} isHeadOrAdmin={isHeadOrAdmin} onClose={onClose} />}
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
                onClick={() => { setLightbox(photoMenu.url); setPhotoMenu(null); }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium text-neutral-700 transition-all duration-100 hover:bg-neutral-50 hover:pl-5 active:scale-[0.98] dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                View Full Image
              </button>
              <button
                onClick={handleMakeDisplay}
                disabled={menuBusy || hydrant.photos[0] === photoMenu.url}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium text-neutral-700 transition-all duration-100 hover:bg-neutral-50 hover:pl-5 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
                {hydrant.photos[0] === photoMenu.url ? 'Already Display Photo' : menuBusy ? 'Updating…' : 'Make Display Photo'}
              </button>
              <div className="mx-3 h-px bg-neutral-100 dark:bg-neutral-700" />
              <button
                onClick={() => setPhotoMenu({ ...photoMenu, confirming: true })}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs font-medium text-[#e0353b] transition-all duration-100 hover:bg-red-50 hover:pl-5 active:scale-[0.98] dark:text-[#e0353b] dark:hover:bg-red-950/40"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                Delete Image
              </button>
            </>
          ) : (
            <div className="px-4 py-3">
              <p className="mb-2.5 text-[11px] font-semibold text-neutral-700 dark:text-neutral-200">Delete this photo permanently?</p>
              <div className="flex gap-2">
                <button onClick={handleDelete} disabled={menuBusy} className="flex-1 rounded-lg bg-[#e0353b] py-1.5 text-[11px] font-bold text-white transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.03] hover:shadow-[0_4px_12px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75 disabled:opacity-60 disabled:pointer-events-none">
                  {menuBusy ? 'Deleting…' : 'Delete'}
                </button>
                <button onClick={() => setPhotoMenu(null)} className="flex-1 rounded-lg border border-neutral-200 py-1.5 text-[11px] font-semibold text-neutral-600 transition-all duration-150 ease-out hover:bg-neutral-50 hover:scale-[1.03] active:scale-[0.97] active:duration-75 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* In-app photo lightbox — keeps photos on the site instead of opening the
          raw Cloudinary URL in an external tab */}
      {lightbox && createPortal(
        <div
          className="anim-fade fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proxiedPhotoUrl(lightbox, 1600)}
            alt="Hydrant photo"
            decoding="async"
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            draggable={false}
          />
          <button
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/30"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
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
        <p className="rounded-lg bg-neutral-100 px-3 py-2.5 text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300">
          General users see station, distance, route, landmark and the lead photo — enough to act, without exposing unverified internal flags.
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────── DETAILS ──────────────────────── */
function DetailsTab({ hydrant, onViewUser, canAnnotate, isHeadOrAdmin, isGeneralView, onPhotoContextMenu, onViewPhoto }: {
  hydrant: Hydrant;
  onViewUser: (name: string, role: string) => void;
  canAnnotate: boolean;
  isHeadOrAdmin: boolean;
  isGeneralView: boolean;
  onPhotoContextMenu: (e: React.MouseEvent, url: string) => void;
  onViewPhoto: (url: string) => void;
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
                className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-neutral-200 transition-all duration-150 ease-out hover:scale-[1.04] hover:shadow-md hover:z-10 active:scale-[0.97] active:duration-75 dark:border-neutral-700"
                onClick={() => onViewPhoto(url)}
                onContextMenu={isHeadOrAdmin ? (e) => onPhotoContextMenu(e, url) : undefined}
                title={isHeadOrAdmin ? 'Click to view · Right-click for options' : 'Click to view'}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proxiedPhotoUrl(url, 320)} alt={`${hydrant.name} photo ${i + 1}`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
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
              {/* Author identity is anonymized (and non-clickable) for general users. */}
              {isGeneralView ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                  <AvatarPlaceholder />
                </span>
              ) : (
                <button
                  onClick={() => onViewUser(n.user, 'Authorized User')}
                  title={`View ${n.user}'s profile`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-600 hover:bg-[#FED42E] transition-colors dark:bg-neutral-700 dark:text-neutral-300"
                >
                  <AvatarPlaceholder />
                </button>
              )}
              <div className="flex-1 rounded-lg bg-neutral-100 px-2.5 py-2 dark:bg-neutral-700">
                {isGeneralView ? (
                  <span className="mb-0.5 block text-[10px] font-semibold tracking-widest text-neutral-500 dark:text-neutral-400">
                    ••••••••
                  </span>
                ) : (
                  <button
                    onClick={() => onViewUser(n.user, 'Authorized User')}
                    className="text-[10px] font-semibold text-[#e0353b] hover:underline mb-0.5 block dark:text-[#e0353b]"
                  >
                    {n.user}
                  </button>
                )}
                <p className="text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-200">{n.text}</p>
                <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">{n.date}</p>
              </div>
            </div>
          ))}
        </div>
        {canAnnotate && (
          <button className="mt-3 w-full text-right text-xs font-medium text-[#e0353b] hover:underline dark:text-[#e0353b]">
            Add notes
          </button>
        )}
      </div>

      {/* Status history — hidden completely for general users. */}
      {!isGeneralView && (
        <div className="mt-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            Status History — Chronological
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
                      className="font-semibold text-[#e0353b] hover:underline dark:text-[#e0353b]"
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
        </div>
      )}
    </div>
  );
}

/* ──────────────────────── LOG (Level 3 — Maintenance) ──────────────────────── */
function MaintenanceTab({ hydrant, linkedReports, onViewUser }: {
  hydrant: Hydrant;
  linkedReports: Report[];
  onViewUser: (name: string, role: string) => void;
}) {
  // Most recent register entry — treated as the latest sign-off.
  const latest = hydrant.register[hydrant.register.length - 1];
  const verifier = latest?.by || hydrant.inspector;
  const verifierRole = latest?.role || 'Authorized';

  const today = new Date().toISOString().slice(0, 10);
  const overdue = hydrant.nextMaintenance !== '' && hydrant.nextMaintenance < today;

  return (
    <div className="px-4 py-4">
      {/* Accountability summary */}
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Maintenance Summary</p>
      <InfoTable rows={[
        {
          label: 'Verifier',
          value: verifier ? (
            <button
              onClick={() => onViewUser(verifier, verifierRole)}
              className="font-semibold text-[#e0353b] hover:underline dark:text-[#e0353b]"
            >
              {verifier}
            </button>
          ) : '—',
        },
        { label: 'Inspector',        value: hydrant.inspector || '—' },
        { label: 'Inspection Date',  value: fmtDate(hydrant.inspectionDate) },
        { label: 'Last Maintained',  value: fmtDate(hydrant.lastMaintenance) },
        {
          label: 'Next Due',
          value: hydrant.nextMaintenance ? (
            <span className={overdue ? 'font-bold text-[#e0353b]' : 'font-medium text-neutral-700 dark:text-neutral-200'}>
              {fmtDate(hydrant.nextMaintenance)}{overdue && ' · Overdue'}
            </span>
          ) : 'Not scheduled',
        },
      ]} />

      {/* Status change history — what changed, when, and why */}
      <div className="mt-5">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          Status Change History
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
                  signed off by{' '}
                  <button
                    onClick={() => onViewUser(entry.by, entry.role)}
                    className="font-semibold text-[#e0353b] hover:underline dark:text-[#e0353b]"
                  >
                    {entry.by}
                  </button>
                  {' '}· {entry.role}
                </p>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{fmtDate(entry.date)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Linked damage reports */}
      <div className="mt-5">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          Linked Damage Reports{linkedReports.length > 0 && ` · ${linkedReports.length}`}
        </p>
        {linkedReports.length === 0 ? (
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">No damage reports filed for this hydrant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {linkedReports.map((r) => {
              const c = STATUS_COLORS[r.status];
              return (
                <div
                  key={r.firestoreId}
                  className="rounded-lg border-l-4 bg-neutral-50 px-3 py-2 dark:bg-neutral-700/60"
                  style={{ borderLeftColor: c.border }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-100">{r.title}</p>
                    <PillBadge dot={c.border} color={c.text} label={c.label} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {r.id} · filed by{' '}
                    <button
                      onClick={() => onViewUser(r.reporter, r.role)}
                      className="font-semibold text-[#e0353b] hover:underline dark:text-[#e0353b]"
                    >
                      {r.reporter}
                    </button>
                  </p>
                  <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{fmtDate(r.date)}{r.time && ` · ${r.time}`}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────── ADMIN ──────────────────────── */
function AdminTab({ hydrant, isHeadOrAdmin, onClose }: { hydrant: Hydrant; isHeadOrAdmin: boolean; onClose: () => void }) {
  const { user, role } = useAuth();
  const [validating,      setValidating]      = useState(false);
  const [validated,       setValidated]       = useState(false);
  const [flagging,        setFlagging]        = useState(false);
  const [flagged,         setFlagged]         = useState(false);
  const [decommConfirm,   setDecommConfirm]   = useState(false);
  const [decommissioning, setDecommissioning] = useState(false);
  const [actionError,     setActionError]     = useState<string | null>(null);

  const by       = user?.email?.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? 'Admin';
  const userRole = role ?? 'admin';

  async function handleValidate() {
    setValidating(true); setActionError(null);
    try { await validateHydrant(hydrant.id, by, userRole); setValidated(true); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Failed to validate.'); }
    finally { setValidating(false); }
  }

  async function handleFlag() {
    setFlagging(true); setActionError(null);
    try { await flagForReinspection(hydrant.id, by, userRole); setFlagged(true); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Failed to flag.'); }
    finally { setFlagging(false); }
  }

  async function handleDecommission() {
    setDecommissioning(true); setActionError(null);
    try { await deleteHydrant(hydrant.id); onClose(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Failed to delete hydrant.'); setDecommissioning(false); }
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {isHeadOrAdmin && (
        <>
          <table className="w-full text-xs">
            <tbody>
              {[
                { label: 'Internal ID',     value: hydrant.id },
                { label: 'Data Source',     value: 'Field survey' },
                { label: 'GPS Complete',    value: <><FiCheck className="inline h-3 w-3" strokeWidth={3} /> Yes</>,      green: true },
                { label: 'Required Fields', value: <><FiCheck className="inline h-3 w-3" strokeWidth={3} /> Complete</>, green: true },
                { label: 'Validation',      value: 'No follow-up needed' },
              ].map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-neutral-50 dark:bg-neutral-700/60' : ''}>
                  <td className="w-36 py-1.5 pl-2 font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{r.label}</td>
                  <td className={`py-1.5 pr-2 font-medium ${r.green ? 'text-[#2fbf4f]' : 'text-neutral-700 dark:text-neutral-200'}`}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-col gap-3 pt-2">
            <p className="text-xs font-bold text-[#e0353b]">Administrative Actions</p>

            {actionError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-[#e0353b] dark:bg-red-950/30">{actionError}</p>
            )}

            {/* Validate */}
            <button
              onClick={handleValidate}
              disabled={validating || validated}
              className="w-full rounded-lg border border-neutral-200 py-2.5 text-xs font-semibold transition-all duration-150 ease-out hover:scale-[1.01] hover:bg-neutral-50 active:scale-[0.98] active:duration-75 disabled:pointer-events-none disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              {validating ? 'Validating…' : validated ? <span className="inline-flex items-center gap-1"><FiCheck className="h-3.5 w-3.5" strokeWidth={3} /> Record Validated</span> : 'Validate Hydrant Record'}
            </button>

            {/* Flag for Re-inspection */}
            <button
              onClick={handleFlag}
              disabled={flagging || flagged}
              className="w-full rounded-lg border border-neutral-200 py-2.5 text-xs font-semibold transition-all duration-150 ease-out hover:scale-[1.01] hover:bg-neutral-50 active:scale-[0.98] active:duration-75 disabled:pointer-events-none disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              {flagging ? 'Flagging…' : flagged ? <span className="inline-flex items-center gap-1"><FiCheck className="h-3.5 w-3.5" strokeWidth={3} /> Flagged for Re-inspection</span> : 'Flag for Re-inspection'}
            </button>

            {/* Decommission — with inline confirmation */}
            {!decommConfirm ? (
              <button
                onClick={() => setDecommConfirm(true)}
                className="w-full rounded-lg border border-red-200 py-2.5 text-xs font-semibold text-[#e0353b] transition-all duration-150 ease-out hover:scale-[1.01] hover:bg-red-50 active:scale-[0.98] active:duration-75 dark:border-red-500/30 dark:hover:bg-red-950/40"
              >
                Decommission Hydrant
              </button>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-950/30">
                <p className="mb-2.5 text-[11px] font-semibold leading-relaxed text-[#e0353b]">
                  This will permanently delete this hydrant record from the database. This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDecommission}
                    disabled={decommissioning}
                    className="flex-1 rounded-lg bg-[#e0353b] py-2 text-xs font-bold text-white transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.02] hover:shadow-[0_4px_12px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75 disabled:pointer-events-none disabled:opacity-60"
                  >
                    {decommissioning ? 'Decommissioning…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setDecommConfirm(false)}
                    className="flex-1 rounded-lg border border-neutral-200 py-2 text-xs font-semibold text-neutral-600 transition-all duration-150 ease-out hover:bg-neutral-50 hover:scale-[1.02] active:scale-[0.97] active:duration-75 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
// "YYYY-MM-DD" → "Jun 29, 2026"; falls back gracefully for empty/odd values.
function fmtDate(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function InfoTable({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={i % 2 === 0 ? 'bg-neutral-50 dark:bg-neutral-700/60' : ''}>
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
