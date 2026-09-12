"use client";

import { useRouter } from "next/navigation";
import PublicHydrantMap from "./src/components/PublicHydrantMap";

export default function Home() {
  const router = useRouter();

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-[#0b0f14] text-white">
      <header className="relative z-20 flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0b0f14]/95 px-5 py-3 backdrop-blur-md sm:px-7">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/Hydro-Scout%20Logo.png"
            alt="Hydro-Scout"
            className="h-10 w-10 object-contain sm:h-11 sm:w-11"
          />

          <div>
            <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">
              Hydro-
              <span className="text-[#e0353b]">
                Scout
              </span>
            </h1>

            <p className="text-[10px] text-white/45 sm:text-xs">
              Public Hydrant Map
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.push("/login")}
          className="rounded-full bg-[#FED42E] px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-95 active:scale-[0.98]"
        >
          Log In
        </button>
      </header>

      <section className="relative min-h-0 flex-1">
        <PublicHydrantMap />

        <div className="pointer-events-none absolute left-4 top-4 z-[500] sm:left-6 sm:top-6">
          <div className="max-w-xs rounded-2xl border border-white/10 bg-[#0b0f14]/90 p-4 shadow-2xl backdrop-blur-xl sm:max-w-sm sm:p-5">
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-[#FED42E]">
              Hydro-Scout
            </p>

            <h2 className="text-xl font-extrabold leading-tight sm:text-2xl">
              Find hydrants when
              <span className="text-[#e0353b]">
                {" "}every second counts.
              </span>
            </h2>

            <p className="mt-2 text-xs leading-5 text-white/55 sm:text-sm">
              This public map displays hydrant locations only.
              Operational information is available to authorized
              Hydro-Scout users.
            </p>
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-5 left-1/2 z-[500] -translate-x-1/2">
          <div className="whitespace-nowrap rounded-full border border-white/10 bg-[#0b0f14]/85 px-4 py-2 text-[11px] font-medium text-white/55 shadow-xl backdrop-blur-md sm:text-xs">
            Hydrant locations are shown for public reference.
          </div>
        </div>
      </section>
    </main>
  );
}