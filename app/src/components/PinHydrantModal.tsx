'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { type HydrantStatus } from '../data/hydrants';
import { createHydrant } from '../data/store';

const MiniMap = dynamic(() => import('./MiniMap'), { ssr: false });

const ROLE_LABELS: Record<string, string> = {
  authorized: 'Authorized User',
  head: 'Head',
  admin: 'Admin',
};

const STATUS_OPTIONS: { value: HydrantStatus; label: string; bg: string }[] = [
  { value: 'operational', label: 'Operational',      bg: '#2fbf4f' },
  { value: 'reduced',     label: 'Reduced Pressure', bg: '#f5a623' },
  { value: 'out',         label: 'Out of Service',   bg: '#9aa0a6' },
];

const TYPE_OPTIONS    = ['Pillar', 'Wall-Mounted', 'Underground', 'Post', 'Other'];
const MOUNTING_OPTIONS = ['Above Ground', 'Below Ground', 'Wall', 'Other'];

interface PinHydrantModalProps {
  onClose: () => void;
  initialLat?: number;
  initialLng?: number;
}

export default function PinHydrantModal({ onClose, initialLat, initialLng }: PinHydrantModalProps) {
  const { user, role } = useAuth();

  const displayName = user?.email ? user.email.split('@')[0] : 'Unknown';
  const roleLabel   = role ? (ROLE_LABELS[role] ?? role) : 'Authorized User';

  // Location
  const [latStr, setLatStr] = useState(initialLat != null ? initialLat.toFixed(6) : '');
  const [lngStr, setLngStr] = useState(initialLng != null ? initialLng.toFixed(6) : '');

  // Identity
  const [address,      setAddress]      = useState('');
  const [landmark,     setLandmark]     = useState('');
  const [concessionaire, setConcessionaire] = useState('MWSS');

  // Status
  const [status,           setStatus]           = useState<HydrantStatus>('operational');
  const [waterCleanliness, setWaterCleanliness] = useState('');
  const [hazard,           setHazard]           = useState('');

  // Physical
  const [type,     setType]     = useState(TYPE_OPTIONS[0]);
  const [mounting, setMounting] = useState(MOUNTING_OPTIONS[0]);
  const [keyWrench, setKeyWrench] = useState('');
  const [outlets,  setOutlets]  = useState<number>(2);
  const [color,    setColor]    = useState('Red');

  // Note
  const [note, setNote] = useState('');

  // Submit state
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  const hasValidCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

  async function handleSubmit() {
    if (!user) { setError('You must be signed in to pin a hydrant.'); return; }
    if (!hasValidCoords) { setError('Please enter valid latitude and longitude.'); return; }
    if (!address.trim()) { setError('Address / Location name is required.'); return; }

    setSaving(true);
    setError(null);
    try {
      await createHydrant({
        lat, lng, address, landmark, concessionaire,
        status, waterCleanliness, hazard,
        type, mounting, keyWrench, outlets, color,
        note,
        by: displayName,
        role: roleLabel,
      });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/permission/i.test(msg) ? 'You do not have permission to pin a hydrant.' : msg);
      setSaving(false);
    }
  }

  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-[5000] flex items-center justify-center bg-black/50">
      <div className="anim-fade-scale relative flex h-[95vh] w-[95vw] max-w-[1100px] overflow-hidden rounded-xl bg-white shadow-2xl">

        {/* ── Header ── */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-[#91191E] px-6 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Hydrant%20Pin%20Red.png" alt="" className="h-8 w-8 object-contain brightness-0 invert" />
          <div className="flex-1">
            <p className="text-sm font-extrabold uppercase tracking-wide text-white">Pin New Hydrant</p>
            <p className="text-[11px] text-red-300">QC Central Fire District · {roleLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-red-300 hover:bg-red-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div className="mt-[54px] flex flex-1 overflow-hidden">

          {/* Left sidebar */}
          <div className="flex w-[260px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-5">

            {/* Hydrant pin icon */}
            <div className="flex flex-col items-center gap-2 pt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Hydrant%20Pin%20Red.png"
                alt="Hydrant pin"
                className="h-20 w-20 object-contain drop-shadow-md"
              />
              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">New Hydrant</p>
            </div>

            {/* Mini map preview */}
            {hasValidCoords ? (
              <div className="h-[160px] overflow-hidden rounded-xl border border-neutral-200 shadow-sm">
                <MiniMap lat={lat} lng={lng} />
              </div>
            ) : (
              <div className="flex h-[160px] items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-100">
                <p className="text-center text-[11px] text-neutral-400 px-3">
                  Enter coordinates below to preview location
                </p>
              </div>
            )}

            {/* Coordinate summary */}
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-[11px]">
              <p className="mb-2 font-bold uppercase tracking-wide text-neutral-400">Coordinates</p>
              <div className="flex flex-col gap-1 text-neutral-600">
                <div className="flex justify-between">
                  <span>Latitude</span>
                  <span className="font-bold text-neutral-800">{hasValidCoords ? lat.toFixed(6) : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Longitude</span>
                  <span className="font-bold text-neutral-800">{hasValidCoords ? lng.toFixed(6) : '—'}</span>
                </div>
              </div>
            </div>

            {/* Guidelines */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-700 leading-relaxed">
              <p className="mb-1 font-bold">Pinning Guidelines</p>
              <p>Verify GPS coordinates on-site before submission. All pinned hydrants require Head or Admin validation before being used in routing.</p>
            </div>
          </div>

          {/* Right: scrollable form */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-7 py-5 space-y-6">

              {/* Location */}
              <Section title="Location">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Latitude">
                    <input
                      type="number"
                      value={latStr}
                      onChange={e => setLatStr(e.target.value)}
                      placeholder="e.g. 14.648800"
                      step="0.000001"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Longitude">
                    <input
                      type="number"
                      value={lngStr}
                      onChange={e => setLngStr(e.target.value)}
                      placeholder="e.g. 121.068000"
                      step="0.000001"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </Section>

              {/* Identity */}
              <Section title="Hydrant Identity">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Address / Location Name *">
                    <input
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      placeholder="e.g. Katipunan Ave, Loyola Heights"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Landmark">
                    <input
                      value={landmark}
                      onChange={e => setLandmark(e.target.value)}
                      placeholder="e.g. Near ADMU Gate 3"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Concessionaire">
                    <input
                      value={concessionaire}
                      onChange={e => setConcessionaire(e.target.value)}
                      placeholder="e.g. MWSS"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </Section>

              {/* Operational Status */}
              <Section title="Operational Status">
                <div className="flex gap-3 mb-4">
                  {STATUS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(opt.value)}
                      className="flex-1 rounded-lg py-2.5 text-xs font-bold text-white transition-opacity"
                      style={{ background: opt.bg, opacity: status === opt.value ? 1 : 0.3 }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Water Cleanliness">
                    <input
                      value={waterCleanliness}
                      onChange={e => setWaterCleanliness(e.target.value)}
                      placeholder="e.g. Clear"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Hazard Flags">
                    <input
                      value={hazard}
                      onChange={e => setHazard(e.target.value)}
                      placeholder="e.g. Blocked, Low Pressure"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </Section>

              {/* Physical Specifications */}
              <Section title="Physical Specifications">
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Type">
                    <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
                      {TYPE_OPTIONS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Mounting">
                    <select value={mounting} onChange={e => setMounting(e.target.value)} className={inputCls}>
                      {MOUNTING_OPTIONS.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </Field>
                  <Field label="Key / Wrench">
                    <input
                      value={keyWrench}
                      onChange={e => setKeyWrench(e.target.value)}
                      placeholder="e.g. Hydrant key"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Outlets">
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={outlets}
                      onChange={e => setOutlets(Number(e.target.value))}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Color">
                    <input
                      value={color}
                      onChange={e => setColor(e.target.value)}
                      placeholder="e.g. Red"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </Section>

              {/* Initial Note */}
              <Section title="Initial Inspection Note">
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  placeholder="Describe the hydrant condition, access, or any relevant observations..."
                  className={`${inputCls} resize-none`}
                />
              </Section>

              {/* Will be signed */}
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-5 py-3 text-[11px] text-neutral-500">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Pinned By</p>
                    <p className="font-bold text-[#91191E]">{displayName}</p>
                    <p>{roleLabel}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Date</p>
                    <p className="font-bold text-neutral-700">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
                    <span>🔒</span>
                    <span>Entry is immutable once submitted</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-neutral-200 px-7 py-4">
              {error && <p className="mb-2 text-[11px] font-medium text-[#91191E]">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="flex-1 rounded-xl border border-neutral-200 py-3 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-[#91191E] py-3 text-sm font-bold text-white hover:bg-[#7a1419] disabled:opacity-60"
                >
                  {saving ? 'Pinning…' : 'Pin Hydrant'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Shared helpers ── */
const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 focus:border-[#91191E] focus:outline-none';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 text-xs font-bold text-[#91191E]">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
