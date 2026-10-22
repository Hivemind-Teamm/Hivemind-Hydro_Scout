'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function LogoutButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const { logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await logout();
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
      setError(
        'Unable to finish signing out safely. ' +
        'Please check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      <button
        type="button"
        onClick={handleLogout}
        disabled={busy}
        aria-busy={busy}
        className={`rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-wait disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800 ${fullWidth ? 'w-full' : 'px-3'}`}
      >
        {busy ? 'Signing Out...' : 'Log Out'}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-2 max-w-xs text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}
