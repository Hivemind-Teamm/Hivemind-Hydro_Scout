"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import HydroScoutDashboard from "./src/components/HydroScoutDashboard";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FED42E",
        }}
      >
        <span style={{ fontSize: 48, fontWeight: 700, color: "#000" }}>Loading…</span>
      </div>
    );
  }

  if (!user) return null;

  return <HydroScoutDashboard />;
}
