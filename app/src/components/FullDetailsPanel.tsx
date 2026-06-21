'use client';

import { useState } from 'react';
import { type Hydrant, STATUS_META } from '../data/hydrants';

type Tab = 'quick' | 'details' | 'register' | 'admin';

const PRESSURE_COLOR: Record<string, string> = {
  Strong: '#2fbf4f', Moderate: '#f5a623', Low: '#e05c2a', None: '#9aa0a6',
};

interface FullDetailsPanelProps {
  hydrant: Hydrant;
  onClose: () => void;
  onViewUser: (name: string, role: string) => void;
}

export default function FullDetailsPanel({ hydrant, onClose, onViewUser }: FullDetailsPanelProps) {
  const [tab, setTab] = useState<Tab>('quick');
  const meta = STATUS_META[hydrant.status];

  return (
    <div className="pointer-events-auto absolute bottom-0 right-0 top-[69px] z-[3000] flex w-[420px] flex-col bg-white shadow-2xl">

      {/* ── Header ── */}
      <div className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3">
        {/* lead photo placeholder */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 text-neutral-400">
          <UploadIcon />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-bold text-neutral-800">{hydrant.name}</p>
            <span className="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-neutral-600">
              {hydrant.type}
            </span>
          </div>
          <p className="text-[11px] text-neutral-400">{hydrant.id} · {hydrant.area}</p>
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
          className="mt-0.5 shrink-0 rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ✕
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-neutral-200 text-[11px] font-bold uppercase tracking-wide">
        {(['quick', 'details', 'register', 'admin'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 transition-colors ${
              tab === t
                ? 'border-b-2 border-[#FED42E] text-[#FED42E]'
                : 'text-neutral-400 hover:text-neutral-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'quick'    && <QuickTab    hydrant={hydrant} meta={meta} />}
        {tab === 'details'  && <DetailsTab  hydrant={hydrant} onViewUser={onViewUser} />}
        {tab === 'register' && <RegisterTab hydrant={hydrant} onViewUser={onViewUser} />}
        {tab === 'admin'    && <AdminTab />}
      </div>
    </div>
  );
}

/* ──────────────────────── QUICK ──────────────────────── */
function QuickTab({ hydrant, meta }: { hydrant: Hydrant; meta: { color: string; legendLabel: string } }) {
  return (
    <div className="px-4 py-4">
      <InfoTable rows={[
        { label: 'Status',   value: <span className="font-bold" style={{ color: meta.color }}>• {meta.legendLabel}</span> },
        { label: 'Pressure', value: <span className="font-bold" style={{ color: PRESSURE_COLOR[hydrant.pressure] }}>{hydrant.pressure}</span> },
        { label: 'Distance', value: `${hydrant.distanceM} m · ${hydrant.distanceMin} min` },
        { label: 'Hazard',   value: hydrant.hazard },
        { label: 'Landmark', value: hydrant.landmark },
      ]} />

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Visible to all roles</span>
          <div className="h-px flex-1 bg-neutral-200" />
        </div>
        <p className="rounded-lg bg-neutral-100 px-3 py-2.5 text-[11px] leading-relaxed text-neutral-500">
          General users see station, distance, route, landmark and the lead photo — enough to act, without exposing unverified internal flags.
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────── DETAILS ──────────────────────── */
function DetailsTab({ hydrant, onViewUser }: { hydrant: Hydrant; onViewUser: (name: string, role: string) => void }) {
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
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Photo Plate</p>
        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <button
              key={i}
              className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 hover:border-neutral-400 hover:bg-neutral-100"
            >
              <UploadIcon size={14} />
            </button>
          ))}
        </div>
      </div>

      {/* Field notes */}
      <div className="mt-5">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Field Notes</p>
        {hydrant.notes.length === 0 && (
          <p className="text-[11px] text-neutral-400">No notes yet.</p>
        )}
        <div className="flex flex-col gap-3">
          {hydrant.notes.map((n, i) => (
            <div key={i} className="flex gap-2">
              <button
                onClick={() => onViewUser(n.user, 'Authorized User')}
                title={`View ${n.user}'s profile`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-bold text-neutral-600 hover:bg-[#FED42E] transition-colors"
              >
                {n.initials}
              </button>
              <div className="flex-1 rounded-lg bg-neutral-100 px-2.5 py-2">
                <button
                  onClick={() => onViewUser(n.user, 'Authorized User')}
                  className="text-[10px] font-semibold text-[#91191E] hover:underline mb-0.5 block"
                >
                  {n.user}
                </button>
                <p className="text-[11px] leading-relaxed text-neutral-700">{n.text}</p>
                <p className="mt-1 text-[10px] text-neutral-400">{n.date}</p>
              </div>
            </div>
          ))}
        </div>
        <button className="mt-3 w-full text-right text-xs font-medium text-[#91191E] hover:underline">
          Add notes
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────── REGISTER ──────────────────────── */
function RegisterTab({ hydrant, onViewUser }: { hydrant: Hydrant; onViewUser: (name: string, role: string) => void }) {
  return (
    <div className="px-4 py-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-wide text-neutral-400">
        Status Register — Chronological
      </p>

      <div className="flex flex-col gap-3">
        {hydrant.register.map((entry, i) => (
          <div key={i} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.statusColor }} />
              {i < hydrant.register.length - 1 && <div className="mt-1 w-px flex-1 bg-neutral-200" />}
            </div>
            <div className="pb-3">
              <p className="text-xs font-semibold text-neutral-800">{entry.action}</p>
              <p className="text-[11px] text-neutral-500">
                by{' '}
                <button
                  onClick={() => onViewUser(entry.by, entry.role)}
                  className="font-semibold text-[#91191E] hover:underline"
                >
                  {entry.by}
                </button>
                {' '}· {entry.role}
              </p>
              <p className="text-[11px] text-neutral-400">{entry.date}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
        <span className="mt-0.5 shrink-0">ⓘ</span>
        <p>Inspector names stay visible to logged-in users (lawful under RA 10173) so inspectors can confirm their own work. Entries are immutable once signed.</p>
      </div>
    </div>
  );
}

/* ──────────────────────── ADMIN ──────────────────────── */
function AdminTab() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center text-neutral-400">
      <p className="text-sm font-semibold">Admin tools</p>
      <p className="text-xs">Coming soon.</p>
    </div>
  );
}

/* ──────────────────────── shared ──────────────────────── */
function InfoTable({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={i % 2 === 0 ? 'bg-neutral-50' : ''}>
            <td className="w-32 py-1.5 pl-2 font-semibold uppercase tracking-wide text-neutral-400">{r.label}</td>
            <td className="py-1.5 pr-2 text-neutral-700">{r.value}</td>
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
