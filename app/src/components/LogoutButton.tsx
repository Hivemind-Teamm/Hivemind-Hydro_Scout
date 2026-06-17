// components/LogoutButton.tsx

"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function LogoutButton() {
  const { logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <button
      onClick={handleLogout}
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