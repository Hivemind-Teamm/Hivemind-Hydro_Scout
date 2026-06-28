"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AdminDashboard from "../src/components/AdminDashboard";

// /admin — System Administration panel.
//
// proxy.ts already gates this path to the `admin` role server-side; this
// client guard is the second line of defense and handles the brief window
// before auth resolves (and direct client-side navigations).
export default function AdminPage() {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login?next=/admin");
    } else if (role !== "admin") {
      router.replace("/");
    }
  }, [user, role, loading, router]);

  if (loading || !user || role !== "admin") {
    return (
      <div
        style={{
          height: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FED42E",
        }}
      >
        <span style={{ fontSize: 40, fontWeight: 700, color: "#000" }}>
          {loading ? "Loading…" : "Redirecting…"}
        </span>
      </div>
    );
  }

  return <AdminDashboard onBack={() => router.push("/")} />;
}
