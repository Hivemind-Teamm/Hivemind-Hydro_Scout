<<<<<<< HEAD
// components/LogoutButton.tsx

"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function LogoutButton() {
=======
'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function LogoutButton({ fullWidth = false }: { fullWidth?: boolean }) {
>>>>>>> origin/initial-landing-page-pr
  const { logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
<<<<<<< HEAD
    router.push("/login");
=======
    router.push('/login');
>>>>>>> origin/initial-landing-page-pr
  }

  return (
    <button
      onClick={handleLogout}
<<<<<<< HEAD
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        border: "1px solid #ccc",
        background: "white",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      Log out
    </button>
  );
}
=======
      className={`rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 ${fullWidth ? 'w-full' : 'px-3'}`}
    >
      Log Out
    </button>
  );
}
>>>>>>> origin/initial-landing-page-pr
