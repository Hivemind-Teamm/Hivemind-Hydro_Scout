'use client';

import { useAuth } from '@/lib/auth-context';
import LogoutButton from './LogoutButton';

const ROLE_LABELS: Record<string, string> = {
  general:    'General User',
  authorized: 'Authorized User',
  head:       'Head',
  admin:      'Admin',
};

const ROLE_ACCESS: Record<string, {
  mapAccess: string; routing: string; editHydrant: string; fileReports: string;
}> = {
  general:    { mapAccess: 'View Only', routing: 'Disabled', editHydrant: 'Locked',   fileReports: 'Locked'   },
  authorized: { mapAccess: 'Full',      routing: 'Enabled',  editHydrant: 'Locked',   fileReports: 'Locked'   },
  head:       { mapAccess: 'Full',      routing: 'Enabled',  editHydrant: 'Enabled',  fileReports: 'Enabled'  },
  admin:      { mapAccess: 'Full',      routing: 'Enabled',  editHydrant: 'Enabled',  fileReports: 'Enabled'  },
};

interface AccountCenterModalProps {
  onClose: () => void;
}

export default function AccountCenterModal({ onClose }: AccountCenterModalProps) {
  const { user, role } = useAuth();

  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : 'General User';
  const access = ROLE_ACCESS[role ?? 'general'];
  const email = user?.email ?? '';
  const displayName = email ? email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'User';
  const initials = displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const isGeneral = !role || role === 'general';

  function green(val: string) {
    return val === 'Full' || val === 'Enabled';
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-[5000] flex items-center justify-center bg-black/40">
      <div className="relative flex h-[95vh] w-[95vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-red-200 hover:bg-red-900 hover:text-white"
        >
          ✕
        </button>

        {/* Profile banner */}
        <div className="flex items-center gap-5 bg-[#91191E] px-8 py-6">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white text-2xl font-extrabold text-[#91191E]">
            {initials}
          </div>
          <div className="flex-1">
            <p className="text-xl font-extrabold text-white">{displayName}</p>
            <p className="text-sm text-red-200">{email}</p>
          </div>
          <div className="text-right">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-red-300">Access Level</p>
            <span className="rounded-full bg-[#FED42E] px-4 py-1.5 text-sm font-bold text-neutral-800">
              {roleLabel}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-2 gap-8 overflow-y-auto px-8 py-6">

          {/* Left — Account info */}
          <div className="flex flex-col gap-4">
            <section>
              <p className="mb-4 text-sm font-bold text-[#91191E]">Account Information</p>
              <div className="grid grid-cols-2 gap-4">
                <ReadonlyField label="Your ID"       value={user?.uid?.slice(0, 10) ?? '—'} />
                <ReadonlyField label="Personal Name" value={displayName} />
                <ReadonlyField label="Email Address" value={email} />
                <ReadonlyField label="Password"      value="••••••••••" />
              </div>
            </section>

            <section>
              <p className="mb-4 text-sm font-bold text-[#91191E]">Account Details</p>
              <div className="grid grid-cols-2 gap-4">
                <ReadonlyField label="Member Since"    value={user?.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'} />
                <ReadonlyField label="Last Login"      value={user?.metadata?.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleDateString() : '—'} />
                <ReadonlyField label="Home Station Area" value="QC Diliman" />
                <ReadonlyField label="Account Status" value="Active" />
              </div>
            </section>

            {/* Upgrade banner — show for general users */}
            {isGeneral && (
              <div className="flex items-center gap-4 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#91191E] text-white">
                  <HydrantGlyph size={22} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-[#91191E]">Become an Authorized User</p>
                  <p className="text-xs leading-relaxed text-neutral-500">
                    Sign up to gain access to features such as hydrant status management, signed inspection notes, and damage reporting.
                  </p>
                </div>
                <button className="flex shrink-0 items-center gap-2 rounded-lg bg-[#91191E] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#7a1419]">
                  <HydrantGlyph size={14} /> Sign Up
                </button>
              </div>
            )}
          </div>

          {/* Right — Access & Security */}
          <div className="flex flex-col gap-4">
            <p className="text-sm font-bold text-[#91191E]">Access &amp; Security</p>

            <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 overflow-hidden">
              <AccessRow label="Current Role"      value={roleLabel}          highlight="badge" />
              <AccessRow label="Map Access"        value={access.mapAccess}   highlight={green(access.mapAccess) ? 'green' : 'gray'} />
              <AccessRow label="Routing &amp; OTW" value={access.routing}     highlight={green(access.routing) ? 'green' : 'gray'} />
              <AccessRow label="Edit Hydrant Data" value={access.editHydrant} highlight={green(access.editHydrant) ? 'green' : 'gray'} />
              <AccessRow label="File Reports"      value={access.fileReports} highlight={green(access.fileReports) ? 'green' : 'gray'} />
            </div>

            <div className="mt-auto flex flex-col gap-3 pt-2">
              <button className="w-full rounded-xl border border-neutral-200 py-3 text-base font-semibold text-neutral-700 hover:bg-neutral-50">
                Change Password
              </button>
              <div className="w-full">
                <LogoutButton fullWidth />
              </div>
              <button className="w-full rounded-xl bg-[#91191E] py-3 text-base font-bold text-white hover:bg-[#7a1419]">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-neutral-400">{label}</span>
      <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-500 truncate">
        {value}
      </div>
    </div>
  );
}

function AccessRow({ label, value, highlight }: { label: string; value: string; highlight: 'badge' | 'green' | 'gray' }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <span className="text-sm text-neutral-500" dangerouslySetInnerHTML={{ __html: label }} />
      {highlight === 'badge' ? (
        <span className="rounded-full bg-[#FED42E] px-3 py-1 text-xs font-bold text-neutral-800">{value}</span>
      ) : (
        <span className={`text-sm font-bold ${highlight === 'green' ? 'text-[#2fbf4f]' : 'text-neutral-400'}`}>{value}</span>
      )}
    </div>
  );
}

function HydrantGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <g fill="currentColor">
        <rect x="13" y="11" width="6" height="14" rx="2" />
        <rect x="9.6" y="14" width="3" height="4" rx="1" />
        <rect x="19.4" y="14" width="3" height="4" rx="1" />
        <rect x="14.2" y="6.5" width="3.6" height="4" rx="1.4" />
        <rect x="10" y="24.5" width="12" height="3" rx="1.2" />
      </g>
    </svg>
  );
}
