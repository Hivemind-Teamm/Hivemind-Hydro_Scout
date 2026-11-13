'use client';

// Map search bar: hydrant IDs and Quezon City barangays from local data, then
// places from Mapbox (typed-ahead, on the Mapbox map) or OpenStreetMap (on
// Enter, on the MapLibre map). See lib/place-search.ts for the provider rules.

import { useEffect, useMemo, useRef, useState } from 'react';
import { searchHydrantsById, type HydrantIdMatch } from '@/lib/hydrant-search';
import {
  barangayBounds,
  loadBarangayBoundaries,
  searchBarangays,
  type BarangayCollection,
  type BarangayFeature,
} from '@/lib/barangay-boundaries';
import {
  SearchSession,
  dedupePlaces,
  isAreaKind,
  retrieveMapboxPlace,
  searchOsmPlaces,
  suggestMapboxPlaces,
  type PlaceLocation,
  type PlaceResult,
} from '@/lib/place-search';
import { STATUS_META, type Hydrant } from '../data/hydrants';
import { HYDRANT_PIN_FILTER } from './hydrantIcon';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const MAX_PLACES = 5;

export interface SearchPlaceSelection {
  name: string;
  /** Mapbox feature_type, Nominatim addresstype, or "barangay". */
  kind: string;
  location: PlaceLocation;
}

interface MapSearchBarProps {
  mapProvider: 'mapbox' | 'maplibre';
  hydrants: Hydrant[];
  /** Flies to a hydrant and opens its details. */
  onSelectHydrant: (hydrant: Hydrant) => void;
  /** Center for ranking places nearest the current view. */
  getMapCenter: () => { lat: number; lng: number } | null;
  onSelectPlace: (place: SearchPlaceSelection) => void;
  /** The searched place is cleared or replaced by a hydrant. */
  onClearPlace: () => void;
  mobile?: boolean;
}

type PlaceSource = 'mapbox' | 'osm';

type Row =
  | { type: 'hydrant'; key: string; match: HydrantIdMatch<Hydrant> }
  | { type: 'barangay'; key: string; feature: BarangayFeature }
  | { type: 'place'; key: string; place: PlaceResult }
  | { type: 'osm-search'; key: string };

// Created on first use rather than on every render.
const sessionOf = (ref: { current: SearchSession | null }) => (ref.current ??= new SearchSession());

const SECTION_LABEL: Record<Row['type'], string> = {
  hydrant: 'Hydrants',
  barangay: 'Barangays',
  place: 'Places',
  'osm-search': 'Places',
};

export default function MapSearchBar({
  mapProvider,
  hydrants,
  onSelectHydrant,
  getMapCenter,
  onSelectPlace,
  onClearPlace,
  mobile = false,
}: MapSearchBarProps) {
  // Mapbox results may only be shown on the Mapbox map (Product Terms §2.7.5).
  const placeSource: PlaceSource = mapProvider === 'mapbox' && MAPBOX_TOKEN ? 'mapbox' : 'osm';

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // Keyboard highlight across every row of the dropdown.
  const [active, setActive] = useState(0);
  const [places, setPlaces] = useState<{ source: PlaceSource; query: string; rows: PlaceResult[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Name of the place shown in the box after choosing it; not searched again.
  const [committed, setCommitted] = useState<string | null>(null);
  const [boundaries, setBoundaries] = useState<BarangayCollection | null>(null);
  const boundariesRequested = useRef(false);
  const sessionRef = useRef<SearchSession | null>(null);
  // Stops a debounced or in-flight suggest, so choosing a row can't open a new billed session.
  const cancelSuggestRef = useRef<(() => void) | null>(null);
  const retrievingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const q = query.trim();

  // Local matches show instantly, before any place results arrive.
  const hydrantMatches = useMemo(() => searchHydrantsById(hydrants, query), [hydrants, query]);
  const barangayMatches = useMemo(
    () => (boundaries && q !== committed ? searchBarangays(boundaries, query) : []),
    [boundaries, query, q, committed],
  );

  const placeRows = useMemo(() => {
    if (!places || places.source !== placeSource || q.length < 2 || q === committed) return [];
    // Mapbox rows may lag a keystroke behind while typing; OSM rows are only for the query searched.
    if (placeSource === 'osm' && places.query !== q) return [];
    return dedupePlaces(places.rows, barangayMatches.map((b) => b.properties.name)).slice(0, MAX_PLACES);
  }, [places, placeSource, q, committed, barangayMatches]);

  const osmSearched = placeSource === 'osm' && places?.source === 'osm' && places.query === q;

  const rows: Row[] = [
    ...hydrantMatches.map((match): Row => ({ type: 'hydrant', key: `h:${match.hydrant.id}`, match })),
    ...barangayMatches.map((feature): Row => ({ type: 'barangay', key: `b:${feature.properties.name}`, feature })),
    ...placeRows.map((place): Row => ({ type: 'place', key: `p:${place.id}`, place })),
    ...(placeSource === 'osm' && q.length >= 2 && q !== committed && !osmSearched
      ? [{ type: 'osm-search', key: 'osm-search' } as Row]
      : []),
  ];
  const highlighted = Math.min(active, rows.length - 1);
  const noPlacesFound = !loading && rows.length === 0 && q.length >= 2 && q !== committed
    && places?.source === placeSource && places.query === q;

  // Mapbox type-ahead. Each search is one billed session however many keystrokes it takes.
  useEffect(() => {
    if (placeSource !== 'mapbox' || q.length < 2 || q === committed) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await suggestMapboxPlaces(q, {
          token: MAPBOX_TOKEN,
          sessionToken: sessionOf(sessionRef).forSuggest(),
          near: getMapCenter(),
          signal: controller.signal,
        });
        setPlaces({ source: 'mapbox', query: q, rows });
        setError(null);
      } catch {
        if (controller.signal.aborted) return;
        setPlaces({ source: 'mapbox', query: q, rows: [] });
        setError('Place search is unavailable right now.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    const cancel = () => {
      clearTimeout(timer);
      controller.abort();
    };
    cancelSuggestRef.current = cancel;
    return () => {
      cancel();
      setLoading(false);
    };
  }, [placeSource, q, committed, getMapCenter]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keep the keyboard highlight visible in the scrolling list.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const loadBoundaries = () => {
    if (boundariesRequested.current) return;
    boundariesRequested.current = true;
    loadBarangayBoundaries().then(setBoundaries, () => { boundariesRequested.current = false; });
  };

  const clear = () => {
    setQuery('');
    setPlaces(null);
    setError(null);
    setCommitted(null);
    setOpen(false);
    setActive(0);
    onClearPlace();
  };

  // Leaves the chosen name in the box (like a map app); the clear button removes it and the pin.
  const commit = (name: string, place: SearchPlaceSelection) => {
    onSelectPlace(place);
    setQuery(name);
    setCommitted(name);
    setOpen(false);
    setActive(0);
    setError(null);
    // Drops the phone keyboard so the map is visible.
    inputRef.current?.blur();
  };

  const selectHydrant = (hydrant: Hydrant) => {
    onSelectHydrant(hydrant);
    clear();
    inputRef.current?.blur();
  };

  const selectBarangay = (feature: BarangayFeature) => {
    const [west, south, east, north] = barangayBounds(feature);
    commit(feature.properties.name, {
      name: feature.properties.name,
      kind: 'barangay',
      location: { lat: (south + north) / 2, lng: (west + east) / 2, bbox: [west, south, east, north] },
    });
  };

  const selectPlace = async (place: PlaceResult) => {
    if (place.location) {
      commit(place.name, { name: place.name, kind: place.kind, location: place.location });
      return;
    }
    // A second click or Enter would be billed as a session of its own.
    if (retrievingRef.current) return;
    retrievingRef.current = true;
    cancelSuggestRef.current?.();
    setLoading(true);
    try {
      const location = await retrieveMapboxPlace(place.id, { token: MAPBOX_TOKEN, sessionToken: sessionOf(sessionRef).forRetrieve() });
      if (location) commit(place.name, { name: place.name, kind: place.kind, location });
      else setError('That place has no map location.');
    } catch {
      setError('Place search is unavailable right now.');
    } finally {
      retrievingRef.current = false;
      setLoading(false);
    }
  };

  // OpenStreetMap's policy allows no search-as-you-type: only on request.
  const searchOsm = async () => {
    if (loading || q.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      setPlaces({ source: 'osm', query: q, rows: await searchOsmPlaces(q) });
      setActive(hydrantMatches.length + barangayMatches.length);
    } catch {
      setError('Place search is unavailable right now.');
    } finally {
      setLoading(false);
    }
  };

  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (row.type === 'hydrant') selectHydrant(row.match.hydrant);
    else if (row.type === 'barangay') selectBarangay(row.feature);
    else if (row.type === 'place') void selectPlace(row.place);
    else void searchOsm();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open && rows.length > 0) setOpen(false);
      else clear();
      return;
    }
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive(e.key === 'ArrowDown' ? Math.min(highlighted + 1, rows.length - 1) : Math.max(highlighted - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[highlighted]);
    }
  };

  const rowClass = (index: number) =>
    `flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
      index === highlighted ? 'bg-neutral-50 dark:bg-neutral-700' : 'hover:bg-neutral-50 dark:hover:bg-neutral-700'
    }`;
  const sectionLabel = 'px-4 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500';
  const showList = open && (rows.length > 0 || !!error || noPlacesFound);

  return (
    <div ref={containerRef} className={mobile ? 'relative flex-1 min-w-0' : 'relative'}>
      <div className={`flex items-center gap-1.5 rounded-full bg-white dark:bg-neutral-700 shadow-[0_4px_16px_rgba(0,0,0,0.35)] ${mobile ? 'px-2.5 py-1.5' : 'px-4 py-2'}`}>
        {loading ? <SpinnerGlyph mobile={mobile} /> : <SearchGlyph mobile={mobile} />}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCommitted(null);
            setError(null);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => { loadBoundaries(); setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={mobile ? 'Search place or hydrant ID' : 'Search place, barangay or hydrant ID'}
          aria-label="Search for a place, barangay or hydrant ID"
          className={`${mobile ? 'w-full flex-1 min-w-0 text-xs' : 'w-64 text-sm'} bg-transparent text-neutral-700 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none`}
        />
        {query && (
          <button onClick={clear} aria-label="Clear search" className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>

      {showList && (
        <ul
          ref={listRef}
          className={`absolute left-0 top-[calc(100%+6px)] z-[2000] ${mobile ? 'w-[calc(100vw-1rem)]' : 'w-96'} max-h-[min(65dvh,34rem)] overflow-y-auto overscroll-contain rounded-xl bg-white dark:bg-neutral-800 shadow-[0_8px_32px_rgba(0,0,0,0.22)]`}
        >
          {rows.map((row, i) => {
            const startsSection = i === 0 || SECTION_LABEL[rows[i - 1].type] !== SECTION_LABEL[row.type];
            return (
              <li key={row.key} data-active={i === highlighted}>
                {startsSection && (
                  <p className={`${sectionLabel} ${i > 0 ? 'border-t border-neutral-100 dark:border-neutral-700' : ''}`}>{SECTION_LABEL[row.type]}</p>
                )}
                <button onClick={() => choose(row)} onMouseEnter={() => setActive(i)} className={rowClass(i)}>
                  <RowContent row={row} query={q} />
                </button>
              </li>
            );
          })}
          {noPlacesFound && (
            <li className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">No matches for “{q}”.</li>
          )}
          {error && (
            <li className="px-4 py-3 text-xs font-semibold text-[#e0353b]">{error}</li>
          )}
          {placeSource === 'osm' && placeRows.length > 0 && (
            <li className="px-4 pb-2 pt-1 text-[10px] text-neutral-400 dark:text-neutral-500">Places © OpenStreetMap contributors</li>
          )}
        </ul>
      )}
    </div>
  );
}

function RowContent({ row, query }: { row: Row; query: string }) {
  if (row.type === 'hydrant') {
    const { hydrant: h, exact } = row.match;
    const meta = STATUS_META[h.status];
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={meta.iconUrl} alt="" width={14} height={18} className="mt-0.5 shrink-0" style={{ filter: `${HYDRANT_PIN_FILTER} ${meta.iconFilter ?? ''}`, objectFit: 'contain' }} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <span className="truncate">{h.id}</span>
            {exact && <span className="shrink-0 rounded-full bg-[#e0353b]/10 px-1.5 py-px text-[10px] font-bold text-[#e0353b]">Exact match</span>}
          </p>
          <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">
            {h.name !== h.id ? `${h.name} · ` : ''}<span style={{ color: meta.color }}>{meta.legendLabel}</span>
          </p>
        </div>
      </>
    );
  }
  if (row.type === 'osm-search') {
    return (
      <>
        <SearchGlyph />
        <p className="min-w-0 truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          Search places for “{query}”
        </p>
      </>
    );
  }
  const area = row.type === 'barangay' || isAreaKind(row.place.kind);
  const title = row.type === 'barangay' ? row.feature.properties.name : row.place.name;
  const subtitle = row.type === 'barangay' ? 'Barangay · Quezon City' : row.place.subtitle;
  return (
    <>
      {area ? <AreaGlyph /> : <PlaceGlyph />}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">{title}</p>
        {subtitle && <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{subtitle}</p>}
      </div>
    </>
  );
}

function PlaceGlyph() {
  return (
    <svg className="mt-0.5 shrink-0 text-neutral-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function AreaGlyph() {
  return (
    <svg className="mt-0.5 shrink-0 text-neutral-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2.5">
      <path d="M4 7 10 3l10 4v10l-7 4-9-4z"/>
    </svg>
  );
}

function SearchGlyph({ mobile = false }: { mobile?: boolean }) {
  const s = mobile ? 13 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" className="shrink-0 text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function SpinnerGlyph({ mobile = false }: { mobile?: boolean }) {
  const s = mobile ? 13 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" className="shrink-0 animate-spin text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}
