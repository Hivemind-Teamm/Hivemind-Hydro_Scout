'use client';

import { useState } from 'react';
import { FiX } from 'react-icons/fi';
import { useRouter } from 'next/navigation';
import { updatePassword } from 'firebase/auth';
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
  const router = useRouter();

  const [changingPassword, setChangingPassword]         = useState(false);
  const [newPassword, setNewPassword]                   = useState('');
  const [retypePassword, setRetypePassword]             = useState('');
  const [saving, setSaving]                             = useState(false);
  const [saveError, setSaveError]                       = useState('');
  const [showNoChangesConfirm, setShowNoChangesConfirm] = useState(false);

  const isSignedIn  = !!user;
  const roleLabel   = role ? (ROLE_LABELS[role] ?? role) : 'General User';
  const access      = ROLE_ACCESS[role ?? 'general'];
  const email       = user?.email ?? '';
  const displayName = user?.displayName
    || (email ? email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Guest');
  const initials    = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  function handleSignIn() { onClose(); router.push('/login');  }
  function handleSignUp() { onClose(); router.push('/signup'); }
  function green(val: string) { return val === 'Full' || val === 'Enabled'; }

  function enterChangePassword() {
    setNewPassword('');
    setRetypePassword('');
    setSaveError('');
    setChangingPassword(true);
  }

  async function handleSavePassword() {
    if (!user) return;
    if (!newPassword && !retypePassword) {
      setShowNoChangesConfirm(true);
      return;
    }
    if (newPassword.length < 6) {
      setSaveError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== retypePassword) {
      setSaveError('Passwords do not match.');
      return;
    }
    setSaveError('');
    setSaving(true);
    try {
      await updatePassword(user, newPassword);
      setChangingPassword(false);
      setNewPassword('');
      setRetypePassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update password.';
      setSaveError(msg.replace('Firebase: ', '').replace(/ \(auth\/.*\)\.?$/, ''));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="anim-fade pointer-events-auto absolute inset-0 z-[5000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="anim-fade-scale relative flex w-full max-w-[700px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900" style={{ maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>

        {/* Panel loading overlay */}
        {saving && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-2xl bg-black/20 [backdrop-filter:blur(2px)]">
            <img
              src="/Hydro-Scout%20Logo.png"
              alt=""
              className="mb-5 h-14 w-14 object-contain opacity-90"
              style={{ animation: 'bounce-dot 1.8s ease-in-out infinite' }}
            />
            <div className="flex gap-2">
              <span className="bounce-dot-1 h-2.5 w-2.5 rounded-full bg-[#FED42E]" />
              <span className="bounce-dot-2 h-2.5 w-2.5 rounded-full bg-[#FED42E]" />
              <span className="bounce-dot-3 h-2.5 w-2.5 rounded-full bg-[#FED42E]" />
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-white/70">Saving…</p>
          </div>
        )}

        {/* No-changes confirmation popup */}
        {showNoChangesConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl bg-black/30 [backdrop-filter:blur(3px)]">
            <div className="anim-fade-scale mx-6 w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900">
              <p className="mb-1 text-sm font-extrabold text-neutral-800 dark:text-neutral-100">No changes made</p>
              <p className="mb-5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                You haven&apos;t entered a new password. Do you want to exit without saving?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNoChangesConfirm(false)}
                  className="flex-1 rounded-xl border border-neutral-200 py-2 text-xs font-semibold text-neutral-600 transition-all duration-150 ease-out hover:scale-[1.02] hover:bg-neutral-50 active:scale-[0.97] active:duration-75 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Go Back
                </button>
                <button
                  onClick={() => {
                    setShowNoChangesConfirm(false);
                    setChangingPassword(false);
                    setNewPassword('');
                    setRetypePassword('');
                    setSaveError('');
                  }}
                  className="flex-1 rounded-xl bg-[#e0353b] py-2 text-xs font-bold text-white transition-all duration-150 ease-out hover:scale-[1.02] hover:bg-[#c42d32] hover:shadow-[0_4px_12px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75"
                >
                  Exit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full text-red-200 transition-all duration-150 ease-out hover:scale-110 hover:bg-red-900 hover:text-white active:scale-90 active:duration-75"
          aria-label="Close"
        >
          <FiX className="h-4 w-4" strokeWidth={2.5} />
        </button>

        {/* Profile banner */}
        <div className="flex items-center gap-4 bg-[#e0353b] py-4 pl-6 pr-12">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-lg font-extrabold text-[#e0353b]">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold text-white">{displayName}</p>
            <p className="truncate text-xs text-red-200">{isSignedIn ? email : 'Not signed in'}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-red-300">Access Level</p>
            <span className="rounded-full bg-[#FED42E] px-3 py-1 text-xs font-bold text-neutral-800">
              {roleLabel}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="scroll-fade grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto px-6 py-5 md:grid-cols-2">

          {/* Left — Account info */}
          <div className="flex flex-col gap-4">
            <section>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#e0353b]">Account Information</p>
              <div className="grid grid-cols-2 gap-3">
                <ReadonlyField label="Your ID"       value={user?.uid?.slice(0, 10) ?? '—'} />
                <ReadonlyField label="Personal Name" value={displayName} />
                <ReadonlyField label="Email Address" value={email} />

                {changingPassword ? (
                  <EditableField
                    label="New Password"
                    value={newPassword}
                    onChange={setNewPassword}
                    type="password"
                    placeholder="Enter new password"
                  />
                ) : (
                  <ReadonlyField label="Password" value="••••••••••" />
                )}

                {changingPassword && (
                  <div className="col-span-2 flex flex-col gap-1">
                    <EditableField
                      label="Retype Password"
                      value={retypePassword}
                      onChange={setRetypePassword}
                      type="password"
                      placeholder="Confirm new password"
                    />
                    {saveError && (
                      <p className="mt-1 text-[11px] font-semibold text-[#e0353b]">{saveError}</p>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#e0353b]">Account Details</p>
              <div className="grid grid-cols-2 gap-3">
                <ReadonlyField label="Member Since"      value={user?.metadata?.creationTime  ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'} />
                <ReadonlyField label="Last Login"        value={user?.metadata?.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleDateString() : '—'} />
                <ReadonlyField label="Home Station Area" value="QC Diliman" />
                <ReadonlyField label="Account Status"   value="Active" />
              </div>
            </section>

          </div>

          {/* Right — Access & Security */}
          <div className="flex flex-col gap-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[#e0353b]">Access &amp; Security</p>

            <div className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
              <AccessRow label="Current Role"      value={roleLabel}          highlight="badge" />
              <AccessRow label="Map Access"        value={access.mapAccess}   highlight={green(access.mapAccess)   ? 'green' : 'gray'} />
              <AccessRow label="Routing &amp; OTW" value={access.routing}     highlight={green(access.routing)     ? 'green' : 'gray'} />
              <AccessRow label="Edit Hydrant Data" value={access.editHydrant} highlight={green(access.editHydrant) ? 'green' : 'gray'} />
              <AccessRow label="File Reports"      value={access.fileReports} highlight={green(access.fileReports) ? 'green' : 'gray'} />
            </div>

            <div className="mt-auto flex flex-col gap-2 pt-1">
              {isSignedIn ? (
                <>
                  {changingPassword ? (
                    <button
                      onClick={handleSavePassword}
                      className="w-full rounded-xl bg-[#e0353b] py-2.5 text-sm font-bold text-white transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.02] hover:shadow-[0_4px_14px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75"
                    >
                      Save Changes
                    </button>
                  ) : (
                    <button
                      onClick={enterChangePassword}
                      className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 transition-all duration-150 ease-out hover:scale-[1.01] hover:bg-neutral-50 hover:shadow-sm active:scale-[0.98] active:duration-75 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      Change Password
                    </button>
                  )}
                  <div className="w-full">
                    <LogoutButton fullWidth />
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={handleSignIn}
                    className="w-full rounded-xl bg-[#e0353b] py-2.5 text-sm font-bold text-white transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.02] hover:shadow-[0_4px_14px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={handleSignUp}
                    className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 transition-all duration-150 ease-out hover:scale-[1.01] hover:bg-neutral-50 hover:shadow-sm active:scale-[0.98] active:duration-75 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    Create Account
                  </button>
                </>
              )}
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
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</span>
      <div className="truncate rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
        {value}
      </div>
    </div>
  );
}

function EditableField({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-[#e0353b]/40 bg-neutral-50 px-3 py-2 text-xs text-neutral-700 outline-none transition-all focus:border-[#e0353b] focus:ring-1 focus:ring-[#e0353b]/25 dark:border-[#e0353b]/30 dark:bg-neutral-800 dark:text-neutral-200 dark:placeholder-neutral-600 dark:focus:border-[#e0353b]"
      />
    </div>
  );
}

function AccessRow({ label, value, highlight }: { label: string; value: string; highlight: 'badge' | 'green' | 'gray' }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-neutral-500 dark:text-neutral-400" dangerouslySetInnerHTML={{ __html: label }} />
      {highlight === 'badge' ? (
        <span className="rounded-full bg-[#FED42E] px-2.5 py-0.5 text-[10px] font-bold text-neutral-800">{value}</span>
      ) : (
        <span className={`text-xs font-bold ${highlight === 'green' ? 'text-[#2fbf4f]' : 'text-neutral-400 dark:text-neutral-500'}`}>{value}</span>
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
