'use client';

// System Administration panel — admin-only.
//
// Replicates the Admin Dashboard design: a live user directory with
// create / promote / demote / remove, and a bulk hydrant CSV importer that
// parses + validates client-side before committing valid rows to Firestore.
//
// Opened as an overlay from the map dashboard. The button that opens it is
// only rendered for admins; Firestore security rules are the real enforcement.

import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  useUsers,
  updateUserRole,
  deleteUserAccount,
  createUserAccount,
  ROLE_META,
  ROLE_ORDER,
  type AppUser,
  type UserRole,
} from '../data/users';
import { useHydrants, createHydrant } from '../data/store';
import { type HydrantStatus } from '../data/hydrants';

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? Root �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

export default function AdminDashboard({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { users, loading, error } = useUsers();
  const { hydrants } = useHydrants();

  const adminName = user?.displayName
    || (user?.email ? user.email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Admin');

  const stationCount = useMemo(() => {
    const set = new Set(users.map((u) => u.station).filter((s) => s && s !== 'Unassigned'));
    return Math.max(set.size, 1);
  }, [users]);

  return (
    <div className="min-h-screen w-screen bg-neutral-100 dark:bg-neutral-950">
      {/* ── Sticky top bar (header + brand line + sub-header) ── */}
      <div className="sticky top-0 z-10 flex flex-col shadow-sm">
        <header className="flex items-center justify-between gap-2 bg-white px-4 py-2.5 dark:bg-neutral-900 md:px-6 md:py-3">
          <Logo />
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <span className="truncate text-sm font-extrabold text-neutral-800 dark:text-neutral-100 md:text-base">Welcome, {adminName}</span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e0353b] text-white ring-2 ring-[#FED42E] md:h-9 md:w-9">
              <UserGlyph />
            </span>
          </div>
        </header>

        {/* brand accent line */}
        <div
          className="h-1 w-full"
          style={{ background: 'repeating-linear-gradient(to right, #FED42E 0px, #FED42E 70px, #e0353b 70px, #e0353b 140px)' }}
        />

        {/* Sub-header */}
        <div className="flex flex-col gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-900 md:flex-row md:items-center md:justify-between md:px-6 md:py-3">
          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={onBack}
              title="Back to map"
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-neutral-400 transition-all duration-150 ease-out hover:bg-neutral-100 hover:text-[#e0353b] hover:scale-[1.04] active:scale-[0.96] active:duration-75 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-[#e0353b]"
            >
              <BackGlyph /> Map
            </button>
            <span className="hidden h-5 w-px bg-neutral-200 dark:bg-neutral-700 md:block" />
            <h1 className="min-w-0 flex-1 truncate text-base font-extrabold tracking-tight text-neutral-800 dark:text-neutral-100 md:flex-none md:text-lg">System Administration</h1>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#e0353b] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white md:px-3">
              <LockGlyph /> Admin Only
            </span>
          </div>
          <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 md:text-xs">
            <span className="font-bold text-neutral-600 dark:text-neutral-300">{stationCount}</span> Stations
            <span className="mx-1.5">·</span>
            <span className="font-bold text-neutral-600 dark:text-neutral-300">{hydrants.length}</span> Hydrants
            <span className="mx-1.5">·</span>
            <span className="font-bold text-neutral-600 dark:text-neutral-300">{users.length}</span> Accounts
          </p>
        </div>
      </div>

      {/* ── Body — grows naturally, window scrolls ── */}
      <div className="flex flex-col gap-4 p-3 md:gap-5 md:p-6">
        <ManageUsersCard
          users={users}
          loading={loading}
          error={error}
          currentUid={user?.uid ?? null}
        />
        <BulkImportCard adminName={adminName} />
      </div>
    </div>
  );
}

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? Manage Users card �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

function ManageUsersCard({
  users, loading, error, currentUid,
}: {
  users: AppUser[];
  loading: boolean;
  error: string | null;
  currentUid: string | null;
}) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [removing, setRemoving] = useState<AppUser | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    });
  }, [users, search, roleFilter]);

  const FILTERS: { key: 'all' | UserRole; label: string }[] = [
    { key: 'all', label: 'All' },
    ...ROLE_ORDER.map((r) => ({ key: r, label: ROLE_META[r].label })),
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 md:gap-4 md:px-6 md:pt-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="truncate text-base font-extrabold text-neutral-800 dark:text-neutral-100">Manage Users &amp; Roles</h2>
          <p className="hidden text-xs text-neutral-400 sm:block dark:text-neutral-500">Create, promote, demote, or remove accounts</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#e0353b] px-3 py-2 text-xs font-bold text-white shadow-sm transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.04] hover:shadow-[0_4px_12px_rgba(224,53,59,0.4)] active:scale-[0.96] active:duration-75 md:px-4"
        >
          <PlusGlyph /> <span className="hidden sm:inline">Create Account</span><span className="sm:hidden">Create</span>
        </button>
      </div>

      {/* Toolbar: search + role filter pills */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-4">
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 focus-within:border-[#e0353b] focus-within:bg-white dark:border-neutral-700 dark:bg-neutral-800 dark:focus-within:bg-neutral-800 md:min-w-[240px]">
          <SearchGlyph />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Name"
            className="w-full bg-transparent text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => {
            const active = roleFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setRoleFilter(f.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-[#e0353b] text-white shadow-sm'
                    : 'border border-neutral-200 text-neutral-400 hover:border-neutral-300 hover:text-neutral-600 dark:border-neutral-700 dark:text-neutral-500 dark:hover:border-neutral-600 dark:hover:text-neutral-300'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-y border-neutral-100 bg-neutral-50/60 text-left text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-500">
              <th className="px-6 py-2.5 font-bold">User</th>
              <th className="px-3 py-2.5 font-bold">Role</th>
              <th className="px-3 py-2.5 font-bold">Station</th>
              <th className="px-3 py-2.5 font-bold">Status</th>
              <th className="px-6 py-2.5 text-right font-bold">Account Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : error ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm text-[#e0353b] dark:text-[#e0353b]">
                  Couldn’t load accounts: {error}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
                  No accounts match your filters.
                </td>
              </tr>
            ) : (
              visible.map((u) => (
                <UserRow
                  key={u.uid}
                  user={u}
                  isSelf={u.uid === currentUid}
                  onEdit={() => setEditing(u)}
                  onRemove={() => setRemoving(u)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-100 px-4 py-3 text-[11px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500 md:px-6">
        Showing <span className="font-bold text-neutral-600 dark:text-neutral-300">{visible.length}</span> of{' '}
        <span className="font-bold text-neutral-600 dark:text-neutral-300">{users.length}</span> Accounts
      </div>

      {showCreate && <CreateAccountModal onClose={() => setShowCreate(false)} />}
      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} />}
      {removing && <RemoveUserModal user={removing} onClose={() => setRemoving(null)} />}
    </section>
  );
}

function UserRow({
  user, isSelf, onEdit, onRemove,
}: {
  user: AppUser;
  isSelf: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const meta = ROLE_META[user.role];
  return (
    <tr className="border-b border-neutral-100 last:border-0 transition-colors hover:bg-neutral-50/60 dark:border-neutral-800 dark:hover:bg-neutral-800/40">
      {/* User */}
      <td className="px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e0353b] text-xs font-extrabold text-white">
            {user.initials}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-bold text-neutral-800 dark:text-neutral-100">
              <span className="truncate">{user.displayName}</span>
              {isSelf && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">You</span>}
            </p>
            <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{user.email}</p>
          </div>
        </div>
      </td>
      {/* Role */}
      <td className="px-3 py-3">
        <span
          className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold"
          style={{ background: meta.badgeBg, color: meta.badgeText }}
        >
          {meta.label}
        </span>
      </td>
      {/* Station */}
      <td className="px-3 py-3 text-sm text-neutral-600 dark:text-neutral-300">{user.station}</td>
      {/* Status */}
      <td className="px-3 py-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: user.active ? '#2fbf4f' : '#cbd5e1' }}
          />
          {user.active ? user.lastLoginLabel : 'Invited'}
        </span>
      </td>
      {/* Actions */}
      <td className="px-6 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onEdit}
            className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-bold text-neutral-600 transition-all duration-150 ease-out hover:border-neutral-300 hover:bg-neutral-50 hover:scale-[1.04] active:scale-[0.96] active:duration-75 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
          >
            Edit
          </button>
          <button
            onClick={onRemove}
            disabled={isSelf}
            title={isSelf ? "You can't remove your own account" : 'Remove account'}
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-bold text-[#e0353b] transition-all duration-150 ease-out hover:bg-red-50 hover:scale-[1.04] hover:shadow-sm active:scale-[0.96] active:duration-75 disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none dark:border-red-500/30 dark:text-[#e0353b] dark:hover:bg-red-950/40"
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
          <td className="px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700" />
              <div className="flex flex-col gap-1.5">
                <span className="h-3 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                <span className="h-2.5 w-44 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              </div>
            </div>
          </td>
          <td className="px-3 py-3"><span className="block h-5 w-16 animate-pulse rounded-full bg-neutral-100 dark:bg-neutral-800" /></td>
          <td className="px-3 py-3"><span className="block h-3 w-28 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" /></td>
          <td className="px-3 py-3"><span className="block h-3 w-20 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" /></td>
          <td className="px-6 py-3"><span className="ml-auto block h-7 w-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" /></td>
        </tr>
      ))}
    </>
  );
}

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? Create account modal �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

function CreateAccountModal({ onClose }: { onClose: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [station, setStation] = useState('');
  const [role, setRole] = useState<UserRole>('general');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!email.trim() || !password) { setError('Email and a temporary password are required.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setSubmitting(true);
    try {
      await createUserAccount({ displayName, email, password, role, station });
      onClose();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      setError(
        code === 'auth/email-already-in-use' ? 'That email already has an account.' :
        code === 'auth/invalid-email'        ? 'That email address is invalid.' :
        code === 'auth/weak-password'        ? 'Password is too weak (min 6 characters).' :
        (e as Error)?.message ?? 'Could not create the account.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Create Account" subtitle="Provision a new Hydro-Scout login" onClose={onClose}>
      <div className="flex flex-col gap-4 px-6 py-5">
        <Field label="Full Name">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Juan Dela Cruz"
            className="admin-input"
          />
        </Field>
        <Field label="Email Address">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@ciit.edu.ph"
            className="admin-input"
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Temporary Password">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min. 6 characters"
              className="admin-input"
            />
          </Field>
          <Field label="Station (optional)">
            <input
              value={station}
              onChange={(e) => setStation(e.target.value)}
              placeholder="Laging Handa Sub-Station"
              className="admin-input"
            />
          </Field>
        </div>
        <Field label="Role">
          <div className="flex gap-1.5">
            {ROLE_ORDER.map((r) => {
              const active = role === r;
              const meta = ROLE_META[r];
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs font-bold transition-all ${
                    active ? 'text-white' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600'
                  }`}
                  style={active ? { background: meta.badgeText, borderColor: meta.badgeText } : undefined}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        </Field>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-[#e0353b] dark:bg-red-950/40 dark:text-[#e0353b]">{error}</p>}
      </div>

      <ModalFooter>
        <button onClick={onClose} className="admin-btn-ghost">Cancel</button>
        <button onClick={handleSubmit} disabled={submitting} className="admin-btn-primary">
          {submitting ? 'Creating…' : 'Create Account'}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? Edit user modal �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

function EditUserModal({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = role !== user.role;

  async function handleSave() {
    if (!dirty) { onClose(); return; }
    setSubmitting(true);
    setError(null);
    try {
      await updateUserRole(user.uid, role);
      onClose();
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not update the role.');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Edit Account" subtitle={user.email} onClose={onClose}>
      <div className="flex flex-col gap-4 px-6 py-5">
        <div className="flex items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-800/50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e0353b] text-sm font-extrabold text-white">
            {user.initials}
          </span>
          <div>
            <p className="text-sm font-bold text-neutral-800 dark:text-neutral-100">{user.displayName}</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">{user.station}</p>
          </div>
        </div>

        <Field label="Role">
          <div className="grid grid-cols-2 gap-2">
            {ROLE_ORDER.map((r) => {
              const active = role === r;
              const meta = ROLE_META[r];
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-xs font-bold transition-all ${
                    active ? 'border-transparent ring-2' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600'
                  }`}
                  style={active ? { background: meta.badgeBg, color: meta.badgeText, boxShadow: `inset 0 0 0 2px ${meta.badgeText}` } : undefined}
                >
                  {meta.label}
                  {active && <CheckGlyph />}
                </button>
              );
            })}
          </div>
        </Field>

        {role !== user.role && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            Role will change from <b>{ROLE_META[user.role].label}</b> to <b>{ROLE_META[role].label}</b>.
          </p>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-[#e0353b] dark:bg-red-950/40 dark:text-[#e0353b]">{error}</p>}
      </div>

      <ModalFooter>
        <button onClick={onClose} className="admin-btn-ghost">Cancel</button>
        <button onClick={handleSave} disabled={submitting} className="admin-btn-primary">
          {submitting ? 'Saving…' : 'Save Changes'}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? Remove user modal �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

function RemoveUserModal({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setSubmitting(true);
    setError(null);
    try {
      await deleteUserAccount(user.uid);
      onClose();
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not remove the account.');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Remove Account" subtitle="This action cannot be undone" onClose={onClose} tone="danger">
      <div className="flex flex-col gap-4 px-6 py-5">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Remove <b className="text-neutral-800 dark:text-neutral-100">{user.displayName}</b> ({user.email}) from the directory?
          They will immediately lose their role and access.
        </p>
        <p className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
          Note: this deletes the user’s directory record. Fully revoking the sign-in credential requires the Firebase Admin SDK on a server.
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-[#e0353b] dark:bg-red-950/40 dark:text-[#e0353b]">{error}</p>}
      </div>

      <ModalFooter>
        <button onClick={onClose} className="admin-btn-ghost">Cancel</button>
        <button
          onClick={handleRemove}
          disabled={submitting}
          className="rounded-lg bg-[#e0353b] px-5 py-2.5 text-sm font-bold text-white transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.03] hover:shadow-[0_4px_14px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75 disabled:opacity-60 disabled:pointer-events-none"
        >
          {submitting ? 'Removing…' : 'Remove Account'}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? Bulk import card �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

interface ParsedRow {
  line: number;
  input: import('../data/store').CreateHydrantInput;
}
interface RowError { line: number; reason: string }
interface ParseResult { fileName: string; rows: ParsedRow[]; errors: RowError[] }

interface LastImport { file: string; valid: number; errors: number; by: string; date: string }

const TEMPLATE_COLUMNS = [
  'address', 'lat', 'lng', 'status', 'landmark', 'concessionaire',
  'type', 'mounting', 'outlets', 'color', 'waterCleanliness', 'hazard', 'note',
] as const;

function BulkImportCard({ adminName }: { adminName: string }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<LastImport>({
    file: 'hydrant_survey_june2026.csv',
    valid: 48,
    errors: 6,
    by: 'Karl A. Manangan',
    date: 'June 21, 2026',
  });

  async function ingest(file: File) {
    setCommitMsg(null);
    if (/\.csv$/i.test(file.name)) {
      const text = await file.text();
      setResult(parseHydrantCsv(file.name, text, adminName));
      return;
    }
    if (/\.xlsx?$/i.test(file.name)) {
      try {
        // Dynamic import keeps the ~1MB SheetJS lib out of the main bundle —
        // it's only fetched when an admin actually drops a spreadsheet.
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) {
          setResult({ fileName: file.name, rows: [], errors: [{ line: 0, reason: 'The workbook has no sheets.' }] });
          return;
        }
        // header:1 → array-of-arrays; blank cells become '' so column indices stay aligned.
        const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
        const matrix = grid.map((row) => row.map((cell) => String(cell ?? '').trim()));
        setResult(parseHydrantMatrix(file.name, matrix, adminName));
      } catch {
        setResult({ fileName: file.name, rows: [], errors: [{ line: 0, reason: 'Could not read the spreadsheet. Make sure it is a valid .xlsx file.' }] });
      }
      return;
    }
    setResult({ fileName: file.name, rows: [], errors: [{ line: 0, reason: 'Unsupported file type. Upload a .csv or .xlsx file.' }] });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void ingest(file);
  }

  async function commit() {
    if (!result || result.rows.length === 0) return;
    setCommitting(true);
    setCommitMsg(null);
    let ok = 0;
    let failed = 0;
    for (const row of result.rows) {
      try { await createHydrant(row.input); ok++; }
      catch { failed++; }
    }
    setCommitting(false);
    setLastImport({
      file: result.fileName,
      valid: ok,
      errors: result.errors.length + failed,
      by: adminName,
      date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    });
    setCommitMsg(
      failed > 0
        ? `Committed ${ok} hydrant${ok === 1 ? '' : 's'}; ${failed} failed to write.`
        : `Committed ${ok} hydrant${ok === 1 ? '' : 's'} to the live map.`,
    );
    setResult(null);
  }

  function downloadTemplate() {
    const sample = [
      '"123 Kalayaan Ave, Diliman, Quezon City"', '14.6539', '121.0685', 'operational',
      'Near Barangay Hall', 'MWSS', 'Pillar', 'Above Ground', '2', 'Red', 'Clear', 'None', 'Sample row — delete before import',
    ].join(',');
    const csv = `${TEMPLATE_COLUMNS.join(',')}\n${sample}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hydro-scout-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="px-4 pt-4 md:px-6 md:pt-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="truncate text-base font-extrabold text-neutral-800 dark:text-neutral-100">Bulk Hydrant Data Import</h2>
          <p className="hidden text-xs text-neutral-400 sm:block dark:text-neutral-500">Update hydrant records from a spreadsheet</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-3 md:gap-5 md:p-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Drop zone */}
        <div>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragOver ? 'border-[#e0353b] bg-red-50 dark:bg-red-950/30' : 'border-neutral-300 bg-neutral-50/60 hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/40 dark:hover:border-neutral-600 dark:hover:bg-neutral-800'
            }`}
          >
            <span className="text-[#e0353b] dark:text-[#e0353b]"><ImportGlyph /></span>
            <p className="text-sm font-bold text-neutral-700 dark:text-neutral-200">Drop Spreadsheet Here</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              or <span className="font-bold text-[#e0353b] underline dark:text-[#e0353b]">browse files</span> to upload
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void ingest(f); e.target.value = ''; }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {['CSV or XLSX', '5MB max size', 'Max 2,000 rows', 'Validated before commit'].map((t) => (
              <span key={t} className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[10px] font-semibold text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500">
                {t}
              </span>
            ))}
          </div>

          {/* Parse result */}
          {result && (
            <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-700 dark:bg-neutral-800/40">
              <div className="flex items-center justify-between">
                <p className="truncate text-xs font-bold text-neutral-700 dark:text-neutral-200">{result.fileName}</p>
                <button onClick={() => setResult(null)} className="text-xs text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">Clear</button>
              </div>
              <div className="mt-2 flex items-center gap-4 text-sm font-bold">
                <span className="text-[#2fbf4f]">{result.rows.length} valid</span>
                <span className={result.errors.length ? 'text-[#e0353b] dark:text-[#e0353b]' : 'text-neutral-300 dark:text-neutral-600'}>
                  {result.errors.length} error{result.errors.length === 1 ? '' : 's'}
                </span>
              </div>
              {result.errors.length > 0 && (
                <ul className="mt-2 max-h-28 overflow-y-auto text-[11px] text-neutral-500 dark:text-neutral-400">
                  {result.errors.slice(0, 8).map((er, i) => (
                    <li key={i} className="py-0.5">
                      {er.line > 0 ? <span className="font-bold text-neutral-400 dark:text-neutral-500">Row {er.line}: </span> : null}{er.reason}
                    </li>
                  ))}
                  {result.errors.length > 8 && <li className="py-0.5 text-neutral-400 dark:text-neutral-500">…and {result.errors.length - 8} more.</li>}
                </ul>
              )}
              {result.rows.length > 0 && (
                <button
                  onClick={commit}
                  disabled={committing}
                  className="mt-3 w-full rounded-lg bg-[#e0353b] py-2.5 text-xs font-bold text-white transition-all duration-150 ease-out hover:bg-[#c42d32] hover:scale-[1.02] hover:shadow-[0_4px_14px_rgba(224,53,59,0.4)] active:scale-[0.97] active:duration-75 disabled:opacity-60 disabled:pointer-events-none"
                >
                  {committing ? 'Committing…' : `Commit ${result.rows.length} valid hydrant${result.rows.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          )}
          {commitMsg && (
            <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-[#1e8a39] dark:bg-green-950/30 dark:text-[#4ade80]">{commitMsg}</p>
          )}
        </div>

        {/* Last import + template */}
        <div className="flex flex-col">
          <div className="flex-1 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Last Import</p>
            <dl className="flex flex-col gap-2.5">
              <ImportStat label="File" value={lastImport.file} mono />
              <ImportStat label="Records Parsed" value={`${lastImport.valid} valid · ${lastImport.errors} errors`} valueClass="text-[#2fbf4f]" />
              <ImportStat label="Imported By" value={lastImport.by} />
              <ImportStat label="Date" value={lastImport.date} />
            </dl>
          </div>
          <button
            onClick={downloadTemplate}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[#e0353b] py-2.5 text-xs font-bold text-[#e0353b] transition-all duration-150 ease-out hover:bg-red-50 hover:scale-[1.02] hover:shadow-sm active:scale-[0.97] active:duration-75 dark:border-[#e0353b] dark:text-[#e0353b] dark:hover:bg-red-950/40"
          >
            <DownloadGlyph /> Download Import Template
          </button>
        </div>
      </div>
    </section>
  );
}

function ImportStat({ label, value, valueClass, mono }: { label: string; value: string; valueClass?: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2 last:border-0 last:pb-0 dark:border-neutral-800">
      <dt className="shrink-0 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">{label}</dt>
      <dd className={`truncate text-right text-xs font-bold text-neutral-700 dark:text-neutral-200 ${mono ? 'font-mono' : ''} ${valueClass ?? ''}`}>{value}</dd>
    </div>
  );
}

/* ───────────────────────── CSV parsing / validation ───────────────────────── */

// Minimal RFC-4180-ish line parser (handles quoted fields with commas/quotes).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normStatus(v: string): HydrantStatus | null {
  const s = v.toLowerCase().trim();
  if (['operational', 'op', 'active', 'working', 'in service'].includes(s)) return 'operational';
  if (['reduced', 'reduced pressure', 'low', 'low pressure', 'weak'].includes(s)) return 'reduced';
  if (['out', 'out of service', 'offline', 'broken', 'none'].includes(s)) return 'out';
  return null;
}

// CSV entry point: split into a string matrix, then share the validation core
// with the XLSX path so both formats behave identically.
function parseHydrantCsv(fileName: string, text: string, adminName: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const matrix = lines.map((l) => splitCsvLine(l));
  return parseHydrantMatrix(fileName, matrix, adminName);
}

// Shared validation core: row 0 is the header, remaining rows are records.
// Used by both the CSV and XLSX importers.
function parseHydrantMatrix(fileName: string, matrix: string[][], adminName: string): ParseResult {
  const nonEmpty = matrix.filter((cells) => cells.some((c) => (c ?? '').trim().length > 0));
  if (nonEmpty.length === 0) return { fileName, rows: [], errors: [{ line: 0, reason: 'The file is empty.' }] };

  const header = (nonEmpty[0] ?? []).map((h) => (h ?? '').toLowerCase().trim());
  const idx = (name: string) => header.indexOf(name);
  const col = { address: idx('address'), lat: idx('lat'), lng: idx('lng'), status: idx('status') };

  if (col.address < 0 || col.lat < 0 || col.lng < 0 || col.status < 0) {
    return { fileName, rows: [], errors: [{ line: 0, reason: 'Header must include address, lat, lng and status columns.' }] };
  }

  const get = (cells: string[], name: string) => { const i = idx(name); return i >= 0 ? (cells[i] ?? '') : ''; };
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const cells = nonEmpty[i];
    const lineNo = i + 1;
    const address = cells[col.address] ?? '';
    const lat = Number(cells[col.lat]);
    const lng = Number(cells[col.lng]);
    const status = normStatus(cells[col.status] ?? '');

    if (!address.trim()) { errors.push({ line: lineNo, reason: 'Missing address.' }); continue; }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { errors.push({ line: lineNo, reason: 'Invalid latitude.' }); continue; }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) { errors.push({ line: lineNo, reason: 'Invalid longitude.' }); continue; }
    if (!status) { errors.push({ line: lineNo, reason: `Unrecognized status "${cells[col.status] ?? ''}".` }); continue; }

    rows.push({
      line: lineNo,
      input: {
        lat, lng,
        address: address.trim(),
        landmark: get(cells, 'landmark'),
        concessionaire: get(cells, 'concessionaire'),
        status,
        waterCleanliness: get(cells, 'watercleanliness'),
        hazard: get(cells, 'hazard'),
        type: get(cells, 'type'),
        mounting: get(cells, 'mounting'),
        keyWrench: get(cells, 'keywrench'),
        outlets: Number(get(cells, 'outlets')) || 2,
        color: get(cells, 'color'),
        note: get(cells, 'note'),
        by: adminName,
        role: 'admin',
      },
    });
  }

  return { fileName, rows, errors };
}

/* �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? Shared modal pieces �?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�? */

function ModalShell({
  title, subtitle, onClose, tone = 'brand', children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  tone?: 'brand' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <div className="anim-fade fixed inset-0 z-[6000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="anim-fade-scale w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-6 py-4 ${tone === 'danger' ? 'bg-[#e0353b]' : 'bg-[#e0353b]'}`}>
          <div>
            <h3 className="text-base font-extrabold text-white">{title}</h3>
            {subtitle && <p className="text-xs text-red-200">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-red-200 transition-all duration-150 ease-out hover:bg-red-900 hover:text-white hover:scale-110 active:scale-90 active:duration-75">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-800/40">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-neutral-500 dark:text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

/* ──────────────────────────── icons / logo ──────────────────────────── */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Logo() {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/Hydro-Scout%20Logo.png" alt="Hydro-Scout" width={44} height={44} className="h-9 w-9 object-contain md:h-11 md:w-11" />
      <span className="text-lg font-extrabold tracking-tight text-neutral-800 dark:text-neutral-100 md:text-xl">
        Hydro-<span className="text-[#e0353b]">Scout</span>
      </span>
    </div>
  );
}

function UserGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" className="text-neutral-400" {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function BackGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ImportGlyph() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" {...stroke} strokeWidth={1.6}>
      <path d="M2 6.5A2.5 2.5 0 0 1 4.5 4H10l2 2h7.5A2.5 2.5 0 0 1 22 8.5" />
      <path d="M12 19v-7" />
      <polyline points="9 15 12 12 15 15" />
      <path d="M2.5 9h19l-1.4 9.2A2 2 0 0 1 18.1 20H5.9a2 2 0 0 1-2-1.8L2.5 9Z" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
