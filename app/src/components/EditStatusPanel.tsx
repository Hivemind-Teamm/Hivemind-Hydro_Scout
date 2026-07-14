'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-media-query';
import { type Hydrant, type HydrantStatus } from '../data/hydrants';
import { updateHydrantStatus } from '../data/store';
import { proxiedPhotoUrl } from '@/lib/photo-url';
import { useStorageConsent } from '@/lib/use-storage-consent';
import StorageConsentModal from './StorageConsentModal';
import { FiX, FiLock } from 'react-icons/fi';

const ROLE_LABELS: Record<string, string> = {
  general: 'General', authorized: 'Authorized', head: 'Head', admin: 'Admin',
};

interface EditStatusPanelProps {
  hydrant: Hydrant;
  onClose: () => void;
  onOpenAccount: () => void;
}

const STATUS_OPTIONS: { value: HydrantStatus; label: string; color: string; bg: string }[] = [
  { value: 'operational', label: 'Operational',      color: '#ffffff', bg: '#2fbf4f' },
  { value: 'reduced',     label: 'Reduced Pressure', color: '#ffffff', bg: '#f5a623' },
  { value: 'out',         label: 'Out of Service',   color: '#ffffff', bg: '#9aa0a6' },
];

export default function EditStatusPanel({ hydrant, onClose, onOpenAccount }: EditStatusPanelProps) {
  const { user, role } = useAuth();
  const isMobile = useIsMobile();
  const [selectedStatus, setSelectedStatus] = useState<HydrantStatus>(hydrant.status);
  const [cleanliness, setCleanliness] = useState('');
  const [hazard, setHazard] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { requestConsent, modalOpen: consentOpen, handleAllow, handleDecline } = useStorageConsent();

  const displayName = user?.email ? user.email.split('@')[0] : 'Unknown';
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : 'Authorized';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();

  // Upload each picked image to Cloudinary (under this hydrant's folder) and
  // keep the returned URLs in state; they're persisted to Firestore on Submit.
  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('hydrantId', hydrant.id);
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

  function handlePhotoRemove(index: number) {
    setPhotos((p) => p.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!user) { setError('You must be signed in to edit a hydrant.'); return; }
    setSaving(true);
    setError(null);
    try {
      await updateHydrantStatus(hydrant.id, {
        status: selectedStatus,
        waterCleanliness: cleanliness,
        hazard,
        note,
        by: displayName,
        role: roleLabel,
        photos,
      });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/permission/i.test(msg) ? 'You do not have permission to edit this hydrant.' : msg);
      setSaving(false);
    }
  }

  return (
    <>
    {consentOpen && <StorageConsentModal onAllow={handleAllow} onDecline={handleDecline} />}
    <div className={
      isMobile
        ? 'anim-slide-up pointer-events-auto absolute inset-x-0 bottom-0 z-[3000] flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-neutral-900'
        : 'anim-slide-right pointer-events-auto absolute bottom-0 right-0 top-[4.3125rem] z-[3000] flex w-[26.25rem] flex-col bg-white shadow-2xl dark:bg-neutral-900'
    }>

      {/* Header */}
      <div className="flex items-start justify-between bg-[#e0353b] px-5 py-3">
        <div>
          <p className="text-sm font-bold text-white">Edit Hydrant Status</p>
          <p className="text-[11px] text-red-200">
            {hydrant.name} · {hydrant.id} {hydrant.lat.toFixed(4)}, {hydrant.lng.toFixed(4)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="mt-0.5 flex items-center justify-center rounded-full p-1 text-red-200 transition-all duration-150 ease-out hover:bg-red-800 hover:text-white hover:scale-110 active:scale-90 active:duration-75"
          aria-label="Close"
        >
          <FiX className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Operational Status */}
        <section>
          <p className="mb-2 text-xs font-bold text-[#e0353b]">Operational Status</p>
          <div className="flex gap-2">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedStatus(opt.value)}
                className="flex-1 rounded-lg py-2 text-xs font-bold transition-opacity"
                style={{
                  background: opt.bg,
                  color: opt.color,
                  opacity: selectedStatus === opt.value ? 1 : 0.35,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Condition / Obstruction */}
        <section>
          <p className="mb-2 text-xs font-bold text-[#e0353b]">Condition / Obstruction</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Water Cleanliness</span>
              <input
                value={cleanliness}
                onChange={(e) => setCleanliness(e.target.value)}
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 px-3 py-2 text-xs focus:border-[#e0353b] focus:outline-none"
                placeholder="e.g. Clear"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Hazard Flags</span>
              <input
                value={hazard}
                onChange={(e) => setHazard(e.target.value)}
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 px-3 py-2 text-xs focus:border-[#e0353b] focus:outline-none"
                placeholder="e.g. Blocked"
              />
            </label>
          </div>
        </section>

        {/* Inspection Note */}
        <section>
          <p className="mb-2 text-xs font-bold text-[#e0353b]">Inspection Note</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 px-3 py-2 text-xs focus:border-[#e0353b] focus:outline-none resize-none"
            placeholder="Describe the current condition..."
          />
        </section>

        {/* Attach Photo */}
        <section>
          <p className="mb-2 text-xs font-bold text-[#e0353b]">Attach Photo</p>
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
                  onClick={() => handlePhotoRemove(i)}
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
              ) : (
                '+'
              )}
            </button>
          </div>
          {uploading && <p className="mt-1.5 text-[10px] text-neutral-400 dark:text-neutral-500">Uploading…</p>}
        </section>

        {/* Will be signed */}
        <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800 px-4 py-3 text-[11px] text-neutral-500 dark:text-neutral-400">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wide text-[10px]">Will be Signed</p>
              <button onClick={onOpenAccount} className="font-bold text-[#e0353b] dark:text-[#e0353b] hover:underline text-left">
                {displayName}
              </button>
              <p className="text-neutral-500 dark:text-neutral-400">(Authorized)</p>
            </div>
            <div>
              <p className="font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wide text-[10px]">&nbsp;</p>
              <p className="font-bold text-neutral-700 dark:text-neutral-200">{dateStr}</p>
              <p className="text-neutral-500 dark:text-neutral-400">{timeStr}</p>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-neutral-500">
              <FiLock className="h-2.5 w-2.5 shrink-0" />
              <span>Immutable once signed</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-200 dark:border-neutral-700 px-5 py-3">
        {error && <p className="mb-2 text-[11px] font-medium text-[#e0353b] dark:text-[#e0353b]">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-700 py-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300 transition-all duration-150 ease-out hover:bg-neutral-50 hover:scale-[1.02] active:scale-[0.97] active:duration-75 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:pointer-events-none"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || uploading}
            className="flex-1 rounded-lg bg-[#e0353b] py-2 text-sm font-bold text-white transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.02] hover:shadow-[0_4px_14px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75 disabled:opacity-60 disabled:pointer-events-none"
          >
            {saving ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
