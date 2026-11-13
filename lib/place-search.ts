// Place search for the map search bar.
//
// On the Mapbox map, places come from the Mapbox Search Box API as you type:
// /suggest while typing, then /retrieve for the chosen row, all under one
// session token (Mapbox bills per session). Mapbox's Product Terms (§2.7) only
// allow POI results together with a Mapbox map and forbid caching results or
// showing their latitude/longitude, so nothing from Mapbox is stored and the
// MapLibre map never receives Mapbox results.
//
// The MapLibre map (or a missing token) uses OpenStreetMap's Nominatim instead.
// Its usage policy forbids search-as-you-type, so it only runs when the user
// asks for it, and repeat queries are answered from a small cache.

/** [west, south, east, north] in degrees. */
export type Bbox = [number, number, number, number];

/** Results stay within Metro Manila and its edges; they're ranked around the map center. */
export const SEARCH_BBOX: Bbox = [120.9, 14.35, 121.25, 14.85];

export interface PlaceLocation {
  lat: number;
  lng: number;
  /** Extent of an area or large site, when the provider gives one. */
  bbox: Bbox | null;
}

export interface PlaceResult {
  id: string;
  name: string;
  subtitle: string;
  /** Mapbox feature_type or Nominatim addresstype, e.g. "poi", "locality", "suburb". */
  kind: string;
  /** Nominatim rows come with a location; Mapbox rows need retrieveMapboxPlace. */
  location?: PlaceLocation;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

interface RequestOptions {
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}

const MAPBOX_SEARCH_URL = 'https://api.mapbox.com/search/searchbox/v1';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Brand and category rows ("Jollibee — Brand") have no single location.
const UNLOCATABLE_KINDS = new Set(['brand', 'category']);

// Kinds that name an area rather than a spot: framed on the map, never pinned.
const AREA_KINDS = new Set([
  'barangay', 'country', 'region', 'postcode', 'district', 'place', 'city', 'locality', 'neighborhood',
  // Nominatim addresstypes
  'state', 'province', 'county', 'municipality', 'town', 'village', 'city_district', 'suburb', 'quarter',
  'neighbourhood', 'borough', 'hamlet',
]);

const ZOOM_BY_KIND: Record<string, number> = {
  address: 18, poi: 17, street: 16, road: 16, block: 16, neighborhood: 15, locality: 15,
  barangay: 15, postcode: 14, place: 13, city: 13, district: 12, region: 10,
};

const fold = (text: string) => text.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
const withoutCountry = (text: string) => text.replace(/,?\s*Philippines$/i, '');

/**
 * Drops rows the user can't tell apart, and POIs that only repeat an area's
 * name (Mapbox lists "Quezon city" businesses beside Quezon City itself).
 * `skipNames` hides rows already shown from local data, such as barangays.
 */
export function dedupePlaces(rows: PlaceResult[], skipNames: readonly string[] = []): PlaceResult[] {
  const skip = new Set(skipNames.map(fold));
  const areaNames = new Set(rows.filter((row) => AREA_KINDS.has(row.kind)).map((row) => fold(row.name)));
  const seen = new Set<string>();
  return rows.filter((row) => {
    const name = fold(row.name);
    if (skip.has(name) || (row.kind === 'poi' && areaNames.has(name))) return false;
    const key = `${name}|${fold(row.subtitle)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface MapboxSuggestion {
  name: string;
  mapbox_id: string;
  feature_type: string;
  address?: string;
  place_formatted?: string;
}

export async function suggestMapboxPlaces(
  query: string,
  { token, sessionToken, near, signal, fetchImpl = fetch }: RequestOptions & {
    token: string;
    sessionToken: string;
    /** Usually the map center; results nearest it rank first. */
    near?: { lat: number; lng: number } | null;
  },
): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    q: query.trim().slice(0, 256),
    access_token: token,
    session_token: sessionToken,
    language: 'en',
    country: 'ph',
    bbox: SEARCH_BBOX.join(','),
    // Same price per session at any limit; extra rows survive the filtering below.
    limit: '10',
  });
  if (near) params.set('proximity', `${near.lng},${near.lat}`);
  const res = await fetchImpl(`${MAPBOX_SEARCH_URL}/suggest?${params}`, { signal });
  if (!res.ok) throw new Error(`Mapbox search failed (${res.status})`);
  const data = await res.json() as { suggestions?: MapboxSuggestion[] };
  return dedupePlaces((data.suggestions ?? [])
    .filter((s) => s.mapbox_id && !UNLOCATABLE_KINDS.has(s.feature_type))
    .map((s) => ({
      id: s.mapbox_id,
      name: s.name,
      kind: s.feature_type,
      subtitle: withoutCountry([s.address, s.place_formatted].filter(Boolean).join(', ')),
    })));
}

function toBbox(value: unknown): Bbox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const box = value.map(Number) as Bbox;
  return box.every(Number.isFinite) ? box : null;
}

export async function retrieveMapboxPlace(
  id: string,
  { token, sessionToken, signal, fetchImpl = fetch }: RequestOptions & { token: string; sessionToken: string },
): Promise<PlaceLocation | null> {
  const params = new URLSearchParams({ access_token: token, session_token: sessionToken });
  const res = await fetchImpl(`${MAPBOX_SEARCH_URL}/retrieve/${encodeURIComponent(id)}?${params}`, { signal });
  if (!res.ok) throw new Error(`Mapbox place lookup failed (${res.status})`);
  const data = await res.json() as {
    features?: { geometry?: { coordinates?: number[] }; properties?: { bbox?: unknown } }[];
  };
  const feature = data.features?.[0];
  const [lng, lat] = feature?.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, bbox: toBbox(feature?.properties?.bbox) };
}

interface NominatimResult {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  addresstype?: string;
  type?: string;
  /** [south, north, west, east] as strings. */
  boundingbox?: string[];
}

const OSM_CACHE_LIMIT = 50;
const osmCache = new Map<string, PlaceResult[]>();

export async function searchOsmPlaces(
  query: string,
  { signal, fetchImpl = fetch }: RequestOptions = {},
): Promise<PlaceResult[]> {
  const q = query.trim();
  const cacheKey = fold(q);
  const cached = osmCache.get(cacheKey);
  if (cached) return cached;

  const [west, south, east, north] = SEARCH_BBOX;
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'ph',
    viewbox: `${west},${north},${east},${south}`,
    bounded: '1',
  });
  const res = await fetchImpl(`${NOMINATIM_URL}?${params}`, { signal, headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`OpenStreetMap search failed (${res.status})`);
  const data = await res.json() as NominatimResult[];
  const rows = data.map((r): PlaceResult => {
    const parts = r.display_name.split(', ');
    const [s, n, w, e] = (r.boundingbox ?? []).map(Number);
    return {
      id: `osm:${r.osm_type}/${r.osm_id}`,
      name: r.name || parts[0],
      subtitle: withoutCountry(parts.slice(1, 4).join(', ')),
      kind: r.addresstype ?? r.type ?? 'place',
      location: { lat: Number(r.lat), lng: Number(r.lon), bbox: toBbox([w, s, e, n]) },
    };
  }).filter((row) => Number.isFinite(row.location!.lat) && Number.isFinite(row.location!.lng));

  if (osmCache.size >= OSM_CACHE_LIMIT) osmCache.delete(osmCache.keys().next().value!);
  osmCache.set(cacheKey, rows);
  return rows;
}

export function isAreaKind(kind: string) {
  return AREA_KINDS.has(kind);
}

// Roughly 300 m across; smaller boxes are just a building's footprint.
const MIN_FRAMED_SPAN_DEG = 0.003;

/**
 * How to show a chosen place: frame it when it has a sizeable extent, else
 * fly to a zoom that suits its kind. Spots get a pin; areas don't.
 */
export function placeView(kind: string, { bbox }: PlaceLocation): { fit: Bbox | null; zoom: number; pin: boolean } {
  const fit = bbox && Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) >= MIN_FRAMED_SPAN_DEG ? bbox : null;
  return { fit, zoom: ZOOM_BY_KIND[kind] ?? 17, pin: !isAreaKind(kind) };
}

/** UUIDv4. getRandomValues also works over plain-http LAN testing, where crypto.randomUUID is missing. */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Mapbox ends a session on /retrieve, after 50 /suggest calls, or when 180 s
// pass without a /retrieve. Rotating a little early keeps the suggestions and
// the final /retrieve of one search inside the same billed session.
const MAX_SUGGESTS_PER_SESSION = 45;
const MAX_IDLE_MS = 150_000;

export class SearchSession {
  private token: string | null = null;
  private suggests = 0;
  private lastCallAt = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  forSuggest(): string {
    const now = this.now();
    if (!this.token || this.suggests >= MAX_SUGGESTS_PER_SESSION || now - this.lastCallAt > MAX_IDLE_MS) {
      this.token = newSessionToken();
      this.suggests = 0;
    }
    this.suggests += 1;
    this.lastCallAt = now;
    return this.token;
  }

  /** The token for the final /retrieve; the next search starts a new session. */
  forRetrieve(): string {
    const token = this.token ?? newSessionToken();
    this.token = null;
    return token;
  }
}
