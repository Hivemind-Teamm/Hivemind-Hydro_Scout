/**
 * nearest-hydrant.ts
 * Finds the nearest operational hydrant from a user's GPS position.
 * Uses your project's existing Hydrant type from app/src/data/hydrants.
 */

import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { hydrantFromDoc, type Hydrant } from '../app/src/data/hydrants';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RankedHydrant extends Hydrant {
  /** Straight-line distance in metres (Haversine) */
  straightLineMetres: number;
  /** Estimated travel distance in metres (from Mapbox Isochrone, or null if API unavailable) */
  travelMetres: number | null;
  /** Primary sort key: travelMetres if available, else straightLineMetres */
  sortDistance: number;
  /** Whether this hydrant falls inside the 2 km isochrone */
  withinRadius: boolean;
}

export interface NearestHydrantResult {
  ranked: RankedHydrant[];
  userPosition: { lat: number; lng: number };
  withinRadius: RankedHydrant[];
  noHydrantsFound: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RADIUS_METRES = 2000;
const HAVERSINE_PREFILTER_METRES = 4000;
const ISOCHRONE_PROFILE = 'mapbox/walking';
const ISOCHRONE_MINUTES = 24;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

// ─── Haversine ────────────────────────────────────────────────────────────────

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Mapbox Isochrone ─────────────────────────────────────────────────────────

interface IsochroneFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

async function fetchIsochrone(lng: number, lat: number): Promise<IsochroneFeature | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const url =
      `https://api.mapbox.com/isochrone/v1/${ISOCHRONE_PROFILE}` +
      `/${lng},${lat}` +
      `?contours_minutes=${ISOCHRONE_MINUTES}` +
      `&polygons=true` +
      `&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.features?.[0] as IsochroneFeature) ?? null;
  } catch {
    return null;
  }
}

function pointInPolygon(point: [number, number], ring: number[][]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInIsochrone(point: [number, number], feature: IsochroneFeature): boolean {
  const { type, coordinates } = feature.geometry;
  if (type === 'Polygon') {
    return pointInPolygon(point, (coordinates as number[][][])[0]);
  }
  if (type === 'MultiPolygon') {
    return (coordinates as number[][][][]).some((poly) => pointInPolygon(point, poly[0]));
  }
  return false;
}

// ─── Firestore Query ──────────────────────────────────────────────────────────

async function fetchOperationalHydrants(): Promise<Hydrant[]> {
  const snap = await getDocs(collection(db, 'hydrants'));
  return snap.docs
    .map((doc) => hydrantFromDoc(doc.id, doc.data()))
    .filter((h) => h.status === 'operational');
}

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * Find the nearest operational hydrant(s) from the user's GPS position.
 */
export async function findNearestHydrants(
  userLat: number,
  userLng: number,
): Promise<NearestHydrantResult> {
  const userPosition = { lat: userLat, lng: userLng };

  // 1. Fetch operational hydrants (filtered client-side via hydrantFromDoc)
  const operational = await fetchOperationalHydrants();

  if (operational.length === 0) {
    return { ranked: [], userPosition, withinRadius: [], noHydrantsFound: true };
  }

  // 2. Haversine pre-filter — keep only candidates within 2 km
  const candidates = operational
    .map((h) => ({
      hydrant: h,
      straightLineMetres: haversineMetres(userLat, userLng, h.lat, h.lng),
    }))
    .filter((c) => c.straightLineMetres <= HAVERSINE_PREFILTER_METRES)
    .sort((a, b) => a.straightLineMetres - b.straightLineMetres);

  if (candidates.length === 0) {
    return { ranked: [], userPosition, withinRadius: [], noHydrantsFound: true };
  }

  // 3. Fetch Mapbox Isochrone polygon once (centred on user)
  const isochrone = await fetchIsochrone(userLng, userLat);

  // 4. Rank candidates
  const ranked: RankedHydrant[] = candidates.map(({ hydrant, straightLineMetres }) => {
    const hPoint: [number, number] = [hydrant.lng, hydrant.lat];

    let withinRadius: boolean;
    let travelMetres: number | null = null;

    if (isochrone) {
      withinRadius = isPointInIsochrone(hPoint, isochrone);
      // Approximate travel: straight-line * 1.3 detour factor
      travelMetres = Math.round(straightLineMetres * 1.3);
    } else {
      // Fallback: straight-line 500 m cutoff
      withinRadius = straightLineMetres <= RADIUS_METRES;
    }

    return {
      ...hydrant,
      straightLineMetres: Math.round(straightLineMetres),
      travelMetres,
      sortDistance: travelMetres ?? Math.round(straightLineMetres),
      withinRadius,
    };
  });

  ranked.sort((a, b) => a.sortDistance - b.sortDistance);

  const withinRadius = ranked.filter((h) => h.withinRadius);

  return {
    ranked,
    userPosition,
    withinRadius,
    noHydrantsFound: withinRadius.length === 0,
  };
}

/**
 * Convenience: get the single closest operational hydrant within 500 m.
 * Returns null if none found.
 */
export async function findClosestHydrant(
  userLat: number,
  userLng: number,
): Promise<RankedHydrant | null> {
  const result = await findNearestHydrants(userLat, userLng);
  return result.withinRadius[0] ?? null;
}