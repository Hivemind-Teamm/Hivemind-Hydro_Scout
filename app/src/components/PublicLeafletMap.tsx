"use client";

import { useEffect } from "react";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";

interface PublicHydrant {
  id: string;
  lat: number;
  lng: number;
}

interface PublicLeafletMapProps {
  hydrants: PublicHydrant[];
}

const DEFAULT_CENTER: [number, number] = [
  14.6549,
  121.0647,
];

const publicHydrantIcon = L.icon({
  iconUrl: "/Hydrant%20Pin%20Gren.png",

  iconSize: [34, 42],

  iconAnchor: [17, 42],
});

function FitHydrants({
  hydrants,
}: {
  hydrants: PublicHydrant[];
}) {
  const map = useMap();

  useEffect(() => {
    if (hydrants.length === 0) {
      return;
    }

    const bounds = L.latLngBounds(
      hydrants.map(
        (hydrant): [number, number] => [
          hydrant.lat,
          hydrant.lng,
        ]
      )
    );

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 16,
      });
    }
  }, [hydrants, map]);

  return null;
}

export default function PublicLeafletMap({
  hydrants,
}: PublicLeafletMapProps) {
  return (
    <div className="h-full w-full">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={14}
        scrollWheelZoom={true}
        zoomControl={true}
        className="h-full w-full"
        style={{
          height: "100%",
          width: "100%",
        }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors &copy; CARTO"
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {hydrants.map((hydrant) => (
          <Marker
            key={hydrant.id}
            position={[
              hydrant.lat,
              hydrant.lng,
            ]}
            icon={publicHydrantIcon}
            interactive={false}
          />
        ))}

        <FitHydrants hydrants={hydrants} />
      </MapContainer>
    </div>
  );
}