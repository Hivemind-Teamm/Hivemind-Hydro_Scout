'use client';

import { FiX } from 'react-icons/fi';

const ROLE_COLORS: Record<string, string> = {
  Admin:             '#e0353b',
  Head:              '#7c3aed',
  'Authorized User': '#d97706',
  'General User':    '#6b7280',
};

export interface ViewingUser {
  name: string;
  role: string;
}

interface UserProfileModalProps {
  user: ViewingUser;
  onClose: () => void;
}

export default function UserProfileModal({ user, onClose }: UserProfileModalProps) {
  const initials = user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const badgeColor = ROLE_COLORS[user.role] ?? '#6b7280';

  return (
    <div className="pointer-events-auto absolute inset-0 z-[5100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="relative w-[90vw] max-w-[340px] overflow-hidden rounded-xl bg-white dark:bg-neutral-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex flex-col items-center gap-2 bg-[#e0353b] px-6 py-6">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex items-center justify-center rounded-full p-1.5 text-red-200 hover:bg-red-900 hover:text-white"
            aria-label="Close"
          >
            <FiX className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-xl font-extrabold text-[#e0353b]">
            {initials}
          </div>
          <p className="text-base font-extrabold text-white">{user.name}</p>
          <span
            className="rounded-full px-3 py-0.5 text-[11px] font-bold text-white"
            style={{ background: badgeColor }}
          >
            {user.role}
          </span>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <div className="mb-3 flex flex-col gap-2.5">
            <InfoRow label="Area"          value="QC Diliman Station" />
            <InfoRow label="Account Status" value="Active" />
          </div>

          <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2.5 text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-400">
            Full contact information is visible to Station Heads and Administrators only.
          </div>

          <button
            onClick={onClose}
            className="mt-4 w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">{label}</span>
      <span className="text-[11px] font-bold text-neutral-700 dark:text-neutral-200">{value}</span>
    </div>
  );
}
