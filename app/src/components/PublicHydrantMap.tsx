"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { collection, onSnapshot } from "firebase/firestore";

import { db } from "@/lib/firebase";

export interface PublicHydrant {
  id: string;
  lat: number;
  lng: number;
}

const PublicMapLibreMap = dynamic(
  () =>
    import("./PublicMapLibreMap").then(
      (module) => module.default
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#0b0f14] text-sm text-white/50">
        Loading public map...
      </div>
    ),
  }
);

function readLocation(
  value: unknown
): {
  lat: number;
  lng: number;
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const location = value as {
    latitude?: unknown;
    longitude?: unknown;
    lat?: unknown;
    lng?: unknown;
  };

  const lat =
    typeof location.latitude === "number"
      ? location.latitude
      : typeof location.lat === "number"
      ? location.lat
      : null;

  const lng =
    typeof location.longitude === "number"
      ? location.longitude
      : typeof location.lng === "number"
      ? location.lng
      : null;

  if (lat === null || lng === null) {
    return null;
  }

  return {
    lat,
    lng,
  };
}

export default function PublicHydrantMap() {
  const [hydrants, setHydrants] =
    useState<PublicHydrant[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "hydrants"),

      (snapshot) => {
        const publicHydrants: PublicHydrant[] = [];

        snapshot.docs.forEach((document) => {
          const data = document.data();

          const location = readLocation(
            data.location
          );

          if (!location) {
            return;
          }

          if (
            location.lat === 0 &&
            location.lng === 0
          ) {
            return;
          }

          publicHydrants.push({
            id: document.id,
            lat: location.lat,
            lng: location.lng,
          });
        });

        setHydrants(publicHydrants);
        setError(null);
        setLoading(false);
      },

      (snapshotError) => {
        console.error(
          "Failed to load public hydrants:",
          snapshotError
        );

        setError(
          "Unable to load hydrant locations."
        );

        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0b0f14] text-sm text-white/50">
        Loading hydrant locations...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0b0f14] px-6 text-center text-sm text-red-400">
        {error}
      </div>
    );
  }

  return (
    <PublicMapLibreMap
      hydrants={hydrants}
    />
  );
}