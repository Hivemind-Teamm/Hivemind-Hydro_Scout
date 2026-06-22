'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { type Hydrant, type HydrantStatus } from '../data/hydrants';
import { updateHydrantStatus } from '../data/store';

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
  const [selectedStatus, setSelectedStatus] = useState<HydrantStatus>(hydrant.status);
  const [cleanliness, setCleanliness] = useState('');
  const [hazard, setHazard] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = user?.email ? user.email.split('@')[0] : 'Unknown';
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : 'Authorized';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();

  function handlePhotoAdd() {
    setPhotos((p) => [...p, '']);
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
      });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/permission/i.test(msg) ? 'You do not have permission to edit this hydrant.' : msg);
      setSaving(false);
    }
  }

  return (
    <div className="anim-slide-right pointer-events-auto absolute bottom-0 right-0 top-[69px] z-[3000] flex w-[420px] flex-col bg-white shadow-2xl">

      {/* Header */}
      <div className="flex items-start justify-between bg-[#91191E] px-5 py-3">
        <div>
          <p className="text-sm font-bold text-white">Edit Hydrant Status</p>
          <p className="text-[11px] text-red-200">
            {hydrant.name} · {hydrant.id} {hydrant.lat.toFixed(4)}, {hydrant.lng.toFixed(4)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="mt-0.5 rounded-full p-1 text-red-200 hover:bg-red-800 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Operational Status */}
        <section>
          <p className="mb-2 text-xs font-bold text-[#91191E]">Operational Status</p>
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
          <p className="mb-2 text-xs font-bold text-[#91191E]">Condition / Obstruction</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Water Cleanliness</span>
              <input
                value={cleanliness}
                onChange={(e) => setCleanliness(e.target.value)}
                className="rounded-lg border border-neutral-200 px-3 py-2 text-xs focus:border-[#91191E] focus:outline-none"
                placeholder="e.g. Clear"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Hazard Flags</span>
              <input
                value={hazard}
                onChange={(e) => setHazard(e.target.value)}
                className="rounded-lg border border-neutral-200 px-3 py-2 text-xs focus:border-[#91191E] focus:outline-none"
                placeholder="e.g. Blocked"
              />
            </label>
          </div>
        </section>

        {/* Inspection Note */}
        <section>
          <p className="mb-2 text-xs font-bold text-[#91191E]">Inspection Note</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs focus:border-[#91191E] focus:outline-none resize-none"
            placeholder="Describe the current condition..."
          />
        </section>

        {/* Attach Photo */}
        <section>
          <p className="mb-2 text-xs font-bold text-[#91191E]">Attach Photo</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((_, i) => (
              <div
                key={i}
                className="relative flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50"
              >
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#91191E]" />
                <span className="text-[10px] text-neutral-400">Photo</span>
              </div>
            ))}
            <button
              onClick={handlePhotoAdd}
              className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 text-2xl text-neutral-400 hover:border-neutral-400 hover:bg-neutral-100"
            >
              +
            </button>
          </div>
        </section>

        {/* Will be signed */}
        <div className="rounded-lg bg-neutral-50 px-4 py-3 text-[11px] text-neutral-500">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="font-semibold text-neutral-400 uppercase tracking-wide text-[10px]">Will be Signed</p>
              <button onClick={onOpenAccount} className="font-bold text-[#91191E] hover:underline text-left">
                {displayName}
              </button>
              <p className="text-neutral-500">(Authorized)</p>
            </div>
            <div>
              <p className="font-semibold text-neutral-400 uppercase tracking-wide text-[10px]">&nbsp;</p>
              <p className="font-bold text-neutral-700">{dateStr}</p>
              <p className="text-neutral-500">{timeStr}</p>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-neutral-400">
              <span>🔒</span>
              <span>Immutable once signed</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-200 px-5 py-3">
        {error && <p className="mb-2 text-[11px] font-medium text-[#91191E]">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#91191E] py-2 text-sm font-bold text-white hover:bg-[#7a1419] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
