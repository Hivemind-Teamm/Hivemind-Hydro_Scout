'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { type Hydrant, STATUS_META } from '../data/hydrants';
import { createReport } from '../data/store';

const ROLE_LABELS: Record<string, string> = {
  general: 'General User', authorized: 'Authorized User', head: 'Head', admin: 'Admin',
};

const MiniMap = dynamic(() => import('./MiniMap'), { ssr: false });

const DAMAGE_TYPES = [
  'Leaking Valve',
  'Damaged Cap',
  'Low / No Pressure',
  'Road Obstruction',
  'Vandalism',
  'Corroded Body',
  'Missing Parts',
  'Other',
];

const PRESSURE_COLOR: Record<string, string> = {
  Strong: '#2fbf4f', Moderate: '#f5a623', Low: '#e05c2a', None: '#9aa0a6',
};

interface DamageReportModalProps {
  hydrant: Hydrant;
  onClose: () => void;
  onOpenAccount: () => void;
}

export default function DamageReportModal({ hydrant, onClose, onOpenAccount }: DamageReportModalProps) {
  const { user, role } = useAuth();
  const [damageType, setDamageType] = useState(DAMAGE_TYPES[0]);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = STATUS_META[hydrant.status];
  const displayName = user?.email ? user.email.replace('@', ' ').split(' ')[0] : 'Unknown';
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : 'Authorized User';
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).replace(/\//g, '/');
  const lastInspection = hydrant.register[0]?.date.split(' ')[0] ?? '—';

  async function handleSubmit() {
    if (!user) { setError('You must be signed in to file a report.'); return; }
    setSaving(true);
    setError(null);
    try {
      await createReport(hydrant.id, {
        title: damageType,
        description,
        location: hydrant.name,
        reporter: displayName,
        role: roleLabel,
      });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/permission/i.test(msg) ? 'You do not have permission to file a report.' : msg);
      setSaving(false);
    }
  }

  return (
    // Backdrop
    <div className="anim-fade pointer-events-auto absolute inset-0 z-[4000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="anim-fade-scale relative flex h-[90vh] max-h-[600px] w-[90vw] max-w-[720px] overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-[#91191E] px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white">Hydrant Damage Report</span>
            <span className="rounded-full bg-[#FED42E] px-2.5 py-0.5 text-[10px] font-bold text-neutral-800">
              Authorized User
            </span>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-red-200 hover:bg-red-800 hover:text-white">
            ✕
          </button>
        </div>

        {/* ── Body (below header) ── */}
        <div className="mt-[46px] flex flex-1 overflow-hidden">

          {/* Left panel */}
          <div className="flex w-[220px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-4">
            {/* Mini map */}
            <div className="h-[140px] overflow-hidden rounded-lg border border-neutral-200">
              <MiniMap lat={hydrant.lat} lng={hydrant.lng} />
            </div>

            {/* Hydrant summary */}
            <div>
              <p className="text-sm font-bold text-neutral-800">{hydrant.name}</p>
              <p className="text-[11px] text-neutral-400">{hydrant.id} · {hydrant.id}</p>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                <div>
                  <p className="font-semibold uppercase tracking-wide text-neutral-400">Status</p>
                  <p className="font-bold" style={{ color: meta.color }}>{meta.legendLabel}</p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wide text-neutral-400">Pressure</p>
                  <p className="font-bold" style={{ color: PRESSURE_COLOR[hydrant.pressure] }}>{hydrant.pressure}</p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wide text-neutral-400">Last Insp.</p>
                  <p className="font-bold text-neutral-700">{lastInspection}</p>
                </div>
              </div>
            </div>

            {/* Guidelines */}
            <div className="rounded-lg border border-neutral-200 bg-white p-3">
              <p className="mb-1 text-[10px] font-bold text-[#91191E]">Reporting Guidelines</p>
              <p className="text-[11px] leading-relaxed text-neutral-500">
                Submit a damage report only after on-site verification. Include clear photos of the affected hydrant component. Reports are routed to the Station Head for review and may be forwarded to the concessionaire for resolution.
              </p>
            </div>
          </div>

          {/* Right panel */}
          <div className="flex flex-1 flex-col overflow-y-auto px-5 py-4">

            {/* Hydrant Information */}
            <p className="mb-2 text-xs font-bold text-[#91191E]">Hydrant Information</p>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <ReadonlyField label="Hydrant ID" value={hydrant.id} />
              <ReadonlyField label="Location" value={hydrant.name} />
            </div>

            {/* Report Details */}
            <p className="mb-2 text-xs font-bold text-[#91191E]">Report Details</p>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Date Reported</span>
                <div className="flex items-center rounded-lg border border-neutral-200 px-3 py-2">
                  <span className="flex-1 text-xs text-neutral-700">{today}</span>
                  <CalendarIcon />
                </div>
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Reported By</span>
                <button
                  onClick={onOpenAccount}
                  className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-left font-semibold text-[#91191E] hover:underline"
                >
                  {displayName}
                </button>
              </div>
            </div>

            <label className="mb-3 flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Damage Type</span>
              <select
                value={damageType}
                onChange={(e) => setDamageType(e.target.value)}
                className="rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-700 focus:border-[#91191E] focus:outline-none"
              >
                {DAMAGE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>

            <label className="mb-4 flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="resize-none rounded-lg border border-neutral-200 px-3 py-2 text-xs focus:border-[#91191E] focus:outline-none"
                placeholder="Describe the damage observed..."
              />
            </label>

            {/* Photo Evidence */}
            <p className="mb-2 text-xs font-bold text-[#91191E]">Photo Evidence</p>
            <button
              onClick={() => setPhotos((p) => [...p, ''])}
              className="mb-3 flex h-20 w-full items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 text-2xl text-neutral-400 hover:border-neutral-400 hover:bg-neutral-100"
            >
              +
            </button>
            {photos.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {photos.map((_, i) => (
                  <div key={i} className="relative flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50">
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#91191E]" />
                    <span className="text-[10px] text-neutral-400">Photo</span>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="mt-auto border-t border-neutral-200 pt-3">
              {error && <p className="mb-2 text-right text-[11px] font-medium text-[#91191E]">{error}</p>}
              <div className="flex justify-end gap-3">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-lg border border-neutral-200 px-6 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="rounded-lg bg-[#91191E] px-6 py-2 text-sm font-bold text-white hover:bg-[#7a1419] disabled:opacity-60"
                >
                  {saving ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
        {value}
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
