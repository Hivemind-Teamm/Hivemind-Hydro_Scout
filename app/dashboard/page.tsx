"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import HydroScoutDashboard from "../src/components/HydroScoutDashboard";

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-dvh w-screen flex-col items-center justify-center bg-neutral-700">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Hydro-Scout%20Logo.png"
          alt=""
          className="mb-2 h-20 w-20 object-contain opacity-90"
          style={{ animation: 'bounce-dot 1.8s ease-in-out infinite' }}
        />
        <span className="mb-5 text-4xl font-extrabold tracking-tight text-white">
          Hydro-<span className="text-[#e0353b]">Scout</span>
        </span>
        <div className="flex gap-2">
          <span className="bounce-dot-1 h-2.5 w-2.5 rounded-full bg-[#FED42E]" />
          <span className="bounce-dot-2 h-2.5 w-2.5 rounded-full bg-[#FED42E]" />
          <span className="bounce-dot-3 h-2.5 w-2.5 rounded-full bg-[#FED42E]" />
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-white/50">Signing you in…</p>
      </div>
    );
  }

  if (!user) return null;

  return <HydroScoutDashboard />;
}
