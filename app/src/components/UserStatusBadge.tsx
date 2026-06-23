// components/UserStatusBadge.tsx

"use client";

import { useAuth } from "@/lib/auth-context";
import LogoutButton from "./LogoutButton";

const ROLE_LABELS: Record<string, string> = {
  general: "General User",
  authorized: "Authorized",
  head: "Head",
  admin: "Admin",
};

export default function UserStatusBadge() {
  const { user, role, loading } = useAuth();

  if (loading || !user) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "white",
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontWeight: 600 }}>{user.email}</span>
        <span style={{ color: "#555" }}>
          Logged in as: {role ? ROLE_LABELS[role] ?? role : "Unknown role"}
        </span>
      </div>
      <LogoutButton />
    </div>
  );
}