"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";

import "maplibre-gl/dist/maplibre-gl.css";

interface PublicHydrant {
  id: string;
  lat: number;
  lng: number;
}

interface PublicMapLibreMapProps {
  hydrants?: PublicHydrant[];
}

const DEFAULT_CENTER: [number, number] = [
  121.0647,
  14.6549,
];

export default function PublicMapLibreMap({
  hydrants = [],
}: PublicMapLibreMapProps) {
  const mapContainerRef =
    useRef<HTMLDivElement | null>(null);

  const mapRef =
    useRef<maplibregl.Map | null>(null);

  const markersRef =
    useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (
      !mapContainerRef.current ||
      mapRef.current
    ) {
      return;
    }

    maplibregl.setWorkerUrl(
      "/maplibre/maplibre-gl-worker.mjs"
    );

    const map = new maplibregl.Map({
      container: mapContainerRef.current,

      style:
        "https://tiles.openfreemap.org/styles/liberty",

      center: DEFAULT_CENTER,
      zoom: 12,

      attributionControl: {},
    });

    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: false,
        showZoom: true,
      }),
      "bottom-right"
    );

    map.on("error", (event) => {
      console.error(
        "MapLibre error:",
        event.error
      );
    });

    mapRef.current = map;

    return () => {
      markersRef.current.forEach(
        (marker) => {
          marker.remove();
        }
      );

      markersRef.current = [];

      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    markersRef.current.forEach(
      (marker) => {
        marker.remove();
      }
    );

    markersRef.current = [];

    if (hydrants.length === 0) {
      return;
    }

    const bounds =
      new maplibregl.LngLatBounds();

    hydrants.forEach((hydrant) => {
      const markerElement =
        document.createElement("div");

      markerElement.style.width = "34px";
      markerElement.style.height = "42px";

      markerElement.style.backgroundImage =
        "url('/Hydrant%20Pin%20Gren.png')";

      markerElement.style.backgroundSize =
        "contain";

      markerElement.style.backgroundRepeat =
        "no-repeat";

      markerElement.style.backgroundPosition =
        "center";

      markerElement.style.pointerEvents =
        "none";

      const marker =
        new maplibregl.Marker({
          element: markerElement,
          anchor: "bottom",
        })
          .setLngLat([
            hydrant.lng,
            hydrant.lat,
          ])
          .addTo(map);

      markersRef.current.push(marker);

      bounds.extend([
        hydrant.lng,
        hydrant.lat,
      ]);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: 70,
        maxZoom: 16,
        duration: 800,
      });
    }
  }, [hydrants]);

  return (
    <div
      ref={mapContainerRef}
      className="h-full w-full"
      style={{
        height: "100%",
        width: "100%",
      }}
    />
  );
}