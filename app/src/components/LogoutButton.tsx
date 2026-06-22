'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function LogoutButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const { logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <button
      onClick={handleLogout}
      className={`rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 ${fullWidth ? 'w-full' : 'px-3'}`}
    >
      Log Out
    </button>
  );
}
