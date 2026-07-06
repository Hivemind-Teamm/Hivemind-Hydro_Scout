'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-media-query';
import { type HydrantStatus } from '../data/hydrants';
import { createHydrant } from '../data/store';
import { proxiedPhotoUrl } from '@/lib/photo-url';
import { useStorageConsent } from '@/lib/use-storage-consent';
import StorageConsentModal from './StorageConsentModal';
import { FiX, FiLock } from 'react-icons/fi';

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

const TYPE_OPTIONS          = ['Pillar', 'Wall-Mounted', 'Underground', 'Post', 'Other'];
const MOUNTING_OPTIONS      = ['Above Ground', 'Below Ground', 'Wall', 'Other'];
const CLEANLINESS_OPTIONS   = ['Clear', 'Murky', 'Rusty'];
const KEY_WRENCH_OPTIONS    = ['None', 'Hydrant Key', 'Spanner Wrench', 'Pentagonal Key', 'Other'];

interface PinHydrantModalProps {
  onClose: () => void;
  initialLat?: number;
  initialLng?: number;
  initialAddress?: string;
}

export default function PinHydrantModal({ onClose, initialLat, initialLng, initialAddress }: PinHydrantModalProps) {
  const { user, role } = useAuth();
  const isMobile = useIsMobile();

  const displayName = user?.email ? user.email.split('@')[0] : 'Unknown';
  const roleLabel   = role ? (ROLE_LABELS[role] ?? role) : 'Authorized User';

  // Location
  const [latStr, setLatStr] = useState(initialLat != null ? initialLat.toFixed(6) : '');
  const [lngStr, setLngStr] = useState(initialLng != null ? initialLng.toFixed(6) : '');

  // Identity
  const [address,      setAddress]      = useState(initialAddress ?? '');
  const [landmark,     setLandmark]     = useState('');
  const [concessionaire, setConcessionaire] = useState('MWSS');

  // Status
  const [status,           setStatus]           = useState<HydrantStatus>('operational');
  const [waterCleanliness, setWaterCleanliness] = useState(CLEANLINESS_OPTIONS[0]);
  const [hazard,           setHazard]           = useState('');

  // Physical
  const [type,     setType]     = useState(TYPE_OPTIONS[0]);
  const [mounting, setMounting] = useState(MOUNTING_OPTIONS[0]);
  const [keyWrench, setKeyWrench] = useState(KEY_WRENCH_OPTIONS[0]);
  const [outlets,  setOutlets]  = useState<number>(2);
  const [color,    setColor]    = useState('Red');

  // Note
  const [note, setNote] = useState('');

  // Photos
  const [photos,    setPhotos]    = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestConsent, modalOpen: consentOpen, handleAllow, handleDecline } = useStorageConsent();

  // Submit state
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // Preview the next available HYD-XXX ID on mount
  const [previewId, setPreviewId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 1; i <= 500; i++) {
        const id = `HYD-${String(i).padStart(3, '0')}`;
        const snap = await getDoc(doc(db, 'hydrants', id));
        if (!snap.exists()) { if (!cancelled) setPreviewId(id); return; }
      }
    })().catch(() => { /* preview is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  const hasValidCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        // Use previewId as the folder; falls back to 'pending' if still resolving
        fd.append('hydrantId', previewId ?? 'pending');
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Upload failed.');
        setPhotos((p) => [...p, data.url as string]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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
        note, photos,
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
    <>
    {consentOpen && <StorageConsentModal onAllow={handleAllow} onDecline={handleDecline} />}
    <div className="anim-fade pointer-events-auto absolute inset-0 z-[5000] flex items-center justify-center bg-black/50">
      <div className="anim-fade-scale relative flex h-[95vh] w-[95vw] max-w-[1100px] overflow-hidden rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">

        {/* ── Header ── */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-[#e0353b] px-6 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Hydrant%20Pin%20Red.png" alt="" className="h-8 w-8 object-contain brightness-0 invert" />
          <div className="flex-1">
            <p className="text-sm font-extrabold uppercase tracking-wide text-white">Pin New Hydrant</p>
            <p className="text-[11px] text-red-300">QC Central Fire District · {roleLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-full p-1.5 text-red-300 transition-all duration-150 ease-out hover:bg-red-800 hover:text-white hover:scale-110 active:scale-90 active:duration-75"
            aria-label="Close"
          >
            <FiX className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className={`mt-[54px] flex flex-1 ${isMobile ? 'flex-col overflow-y-auto' : 'overflow-hidden'}`}>

          {/* Left sidebar */}
          <div className={`flex shrink-0 flex-col gap-4 bg-neutral-50 p-5 dark:bg-neutral-800 ${isMobile ? 'w-full border-b border-neutral-200 dark:border-neutral-700' : 'w-[260px] overflow-y-auto border-r border-neutral-200 dark:border-neutral-700'}`}>

            {/* Hydrant pin icon */}
            <div className="flex flex-col items-center gap-2 pt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Hydrant%20Pin%20Red.png"
                alt="Hydrant pin"
                className="h-20 w-20 object-contain drop-shadow-md"
              />
              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">New Hydrant</p>
              {previewId ? (
                <span className="rounded-full bg-[#e0353b]/10 dark:bg-[#e0353b]/15 px-3 py-0.5 text-sm font-extrabold tracking-wide text-[#e0353b] dark:text-[#e0353b]">
                  {previewId}
                </span>
              ) : (
                <span className="text-[10px] text-neutral-300 dark:text-neutral-600">Resolving ID…</span>
              )}
            </div>

            {/* Mini map preview */}
            {hasValidCoords ? (
              <div className="h-[160px] overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-sm">
                <MiniMap lat={lat} lng={lng} />
              </div>
            ) : (
              <div className="flex h-[160px] items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800">
                <p className="text-center text-[11px] text-neutral-400 dark:text-neutral-500 px-3">
                  Enter coordinates below to preview location
                </p>
              </div>
            )}

            {/* Coordinate summary */}
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-[11px] dark:border-neutral-700 dark:bg-neutral-900">
              <p className="mb-2 font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Coordinates</p>
              <div className="flex flex-col gap-1 text-neutral-600 dark:text-neutral-300">
                <div className="flex justify-between">
                  <span>Latitude</span>
                  <span className="font-bold text-neutral-800 dark:text-neutral-100">{hasValidCoords ? lat.toFixed(6) : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Longitude</span>
                  <span className="font-bold text-neutral-800 dark:text-neutral-100">{hasValidCoords ? lng.toFixed(6) : '—'}</span>
                </div>
              </div>
            </div>

            {/* Guidelines */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-700 leading-relaxed dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              <p className="mb-1 font-bold">Pinning Guidelines</p>
              <p>Verify GPS coordinates on-site before submission. All pinned hydrants require Head or Admin validation before being used in routing.</p>
            </div>
          </div>

          {/* Right: scrollable form */}
          <div className={`flex flex-col ${isMobile ? '' : 'flex-1 overflow-hidden'}`}>
            <div className={`space-y-6 px-7 py-5 ${isMobile ? '' : 'scroll-fade min-h-0 flex-1 overflow-y-auto'}`}>

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
                      onChange={e => { if (!initialAddress) setAddress(e.target.value); }}
                      readOnly={!!initialAddress}
                      placeholder="e.g. Katipunan Ave, Loyola Heights"
                      className={`${inputCls} ${initialAddress ? 'cursor-not-allowed bg-neutral-100 text-neutral-400 select-none dark:bg-neutral-800 dark:text-neutral-500' : ''}`}
                      title={initialAddress ? 'Address is pre-filled from the selected location' : undefined}
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
                    <select value={waterCleanliness} onChange={e => setWaterCleanliness(e.target.value)} className={inputCls}>
                      {CLEANLINESS_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
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
                    <select value={keyWrench} onChange={e => setKeyWrench(e.target.value)} className={inputCls}>
                      {KEY_WRENCH_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
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

              {/* Photos */}
              <Section title="Photos">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  onChange={handleFilesSelected}
                  className="hidden"
                />
                <div className="flex flex-wrap gap-2">
                  {photos.map((url, i) => (
                    <div key={url} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={proxiedPhotoUrl(url, 160)} alt={`Photo ${i + 1}`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setPhotos(p => p.filter((_, idx) => idx !== i))}
                        title="Remove photo"
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <FiX className="h-2.5 w-2.5" strokeWidth={3} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={async () => { if (await requestConsent()) fileInputRef.current?.click(); }}
                    disabled={uploading}
                    className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 text-2xl text-neutral-400 hover:border-neutral-400 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-500 dark:hover:border-neutral-500 dark:hover:bg-neutral-700 disabled:opacity-50"
                  >
                    {uploading ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-[#e0353b]" />
                    ) : '+'}
                  </button>
                </div>
                {uploading && <p className="mt-1.5 text-[10px] text-neutral-400 dark:text-neutral-500">Uploading…</p>}
              </Section>

              {/* Will be signed */}
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-5 py-3 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-400">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Pinned By</p>
                    <p className="font-bold text-[#e0353b] dark:text-[#e0353b]">{displayName}</p>
                    <p>{roleLabel}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Date</p>
                    <p className="font-bold text-neutral-700 dark:text-neutral-200">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                    <FiLock className="h-2.5 w-2.5 shrink-0" />
                    <span>Entry is immutable once submitted</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-neutral-200 px-7 py-4 dark:border-neutral-700">
              {error && <p className="mb-2 text-[11px] font-medium text-[#e0353b] dark:text-[#e0353b]">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="flex-1 rounded-xl border border-neutral-200 py-3 text-sm font-semibold text-neutral-600 transition-all duration-150 ease-out hover:bg-neutral-50 hover:scale-[1.02] active:scale-[0.97] active:duration-75 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving || uploading}
                  className="flex-1 rounded-xl bg-[#e0353b] py-3 text-sm font-bold text-white transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.02] hover:shadow-[0_4px_14px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75 disabled:opacity-60 disabled:pointer-events-none"
                >
                  {saving ? 'Pinning…' : 'Pin Hydrant'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

/* ── Shared helpers ── */
const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 focus:border-[#e0353b] focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 text-xs font-bold text-[#e0353b] dark:text-[#e0353b]">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
