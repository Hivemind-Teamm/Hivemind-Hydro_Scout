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

const PublicLeafletMap = dynamic(
  () =>
    import("./PublicLeafletMap").then(
      (module) => module.default
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#151a20]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#FED42E]" />

          <p className="text-sm font-semibold text-white/50">
            Loading hydrant map…
          </p>
        </div>
      </div>
    ),
  }
);

function readLocation(
  value: unknown
): { lat: number; lng: number } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const location = value as {
    latitude?: number;
    longitude?: number;
    _latitude?: number;
    _longitude?: number;
    lat?: number;
    lng?: number;
  };

  const lat =
    location.latitude ??
    location._latitude ??
    location.lat;

  const lng =
    location.longitude ??
    location._longitude ??
    location.lng;

  if (
    typeof lat !== "number" ||
    typeof lng !== "number"
  ) {
    return null;
  }

  return { lat, lng };
}

export default function PublicHydrantMap() {
  const [hydrants, setHydrants] = useState<
    PublicHydrant[]
  >([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<
    string | null
  >(null);

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
          "Unable to load public hydrant locations:",
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
      <div className="flex h-full w-full items-center justify-center bg-[#151a20]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#FED42E]" />

          <p className="text-sm font-semibold text-white/50">
            Loading hydrant locations…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#151a20]">
        <div className="max-w-sm px-6 text-center">
          <p className="font-semibold text-[#e0353b]">
            Map unavailable
          </p>

          <p className="mt-2 text-sm text-white/50">
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <PublicLeafletMap hydrants={hydrants} />
  );
}