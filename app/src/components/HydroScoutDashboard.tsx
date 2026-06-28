'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import MapView, { type MapProvider, type MapController } from './MapView';
import DashboardOverlay from './DashboardOverlay';
import HydrantInfoPanel from './HydrantInfoPanel';
import FullDetailsPanel from './FullDetailsPanel';
import EditStatusPanel from './EditStatusPanel';
import DamageReportModal from './DamageReportModal';
import ReportsPanel from './ReportsPanel';
import AccountCenterModal from './AccountCenterModal';
import UserProfileModal, { type ViewingUser } from './UserProfileModal';
import OperationsDashboard from './OperationsDashboard';
import PinHydrantModal from './PinHydrantModal';
import LocationPreviewPanel from './LocationPreviewPanel';
import NearestHydrantPanel from './NearestHydrantPanel';
import {
  countByStatus,
  type Hydrant,
  type HydrantStatus,
} from '../data/hydrants';
import { useHydrants, useReports } from '../data/store';
import { useAuth } from '@/lib/auth-context';
import { haversineM, formatDistance, distToRouteM } from '@/lib/haversine';
import { type RankedHydrant } from '@/lib/nearest-hydrant';
import { playHazardChime } from '@/lib/chime';

const OTW_HYDRANT_KEY  = 'hydroscout_otw_hydrant_id';
const OTW_ROUTE_KEY    = 'hydroscout_otw_route';
const OTW_MIN_ZOOM     = 13;
const OTW_MAX_ZOOM     = 19;
const ROUTE_BUFFER_M   = 300;
const ROUTE_CORRIDOR_M = 300;

export default function HydroScoutDashboard() {
  const [provider, setProvider] = useState<MapProvider>('mapbox');
  const [autoFallback, setAutoFallback] = useState(false);
  const [userOverride, setUserOverride] = useState(false);
  const [mapViewport, setMapViewport] = useState<{ center: { lat: number; lng: number }; zoom: number } | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [activeStatus, setActiveStatus] = useState<HydrantStatus | null>(null);
  const [selectedHydrant, setSelectedHydrant] = useState<Hydrant | null>(null);
  const [showFullDetails, setShowFullDetails] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showOpsDashboard, setShowOpsDashboard] = useState(false);
  const [showPinHydrant,   setShowPinHydrant]   = useState(false);
  const [addHydrantMode,   setAddHydrantMode]   = useState(false);
  const [pendingLocation,  setPendingLocation]  = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [userLocation,     setUserLocation]     = useState<{ lat: number; lng: number } | null>(null);
  const [otwHydrant,       setOtwHydrant]       = useState<Hydrant | null>(null);
  const [otwRoute,         setOtwRoute]         = useState<[number, number][] | null>(null);
  const [viewingUser, setViewingUser] = useState<ViewingUser | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Nearest hydrant state
  const [nearestHydrant, setNearestHydrant] = useState<RankedHydrant | null>(null);
  const [nearestPanelOpen, setNearestPanelOpen] = useState(false);
  const [otwMeta, setOtwMeta] = useState<{ distanceM: number; durationS: number } | null>(null);

  const geoErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<MapController | null>(null);
  const otwFetchedForRef = useRef<string | null>(null);
  const otwRestoredRef  = useRef(false);
  const otwRouteRef     = useRef<[number, number][] | null>(null);
  const lastRouteFetchRef = useRef<number>(0);
  const ROUTE_FETCH_INTERVAL_MS = 10_000;

  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [deletedHydrant, setDeletedHydrant] = useState<{ id: string; name: string } | null>(null);
  const deletedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Splash screen — shown until BOTH the map is ready AND hydrant data has loaded
  const [splashDone, setSplashDone] = useState(false);
  const [splashFading, setSplashFading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const splashStartedRef = useRef(false);

  const { role } = useAuth();
  const { hydrants, loading, error } = useHydrants();
  const { reports, loading: reportsLoading } = useReports();
  const hasPendingReports = reports.some((r) => r.status === 'pending');

  useEffect(() => {
    if (!loading && mapReady && !splashStartedRef.current) {
      splashStartedRef.current = true;
      setSplashFading(true);
      const t = setTimeout(() => setSplashDone(true), 500);
      return () => clearTimeout(t);
    }
  }, [loading, mapReady]);

  useEffect(() => {
    if (!loading) setLastSynced(new Date());
  }, [loading, hydrants]);

  useEffect(() => {
    if (otwHydrant) {
      localStorage.setItem(OTW_HYDRANT_KEY, otwHydrant.id);
    } else {
      localStorage.removeItem(OTW_HYDRANT_KEY);
      localStorage.removeItem(OTW_ROUTE_KEY);
    }
  }, [otwHydrant]);

  useEffect(() => {
    if (otwRoute) localStorage.setItem(OTW_ROUTE_KEY, JSON.stringify(otwRoute));
  }, [otwRoute]);

  useEffect(() => {
    if (loading || !hydrants.length || otwRestoredRef.current) return;
    otwRestoredRef.current = true;
    const savedId = localStorage.getItem(OTW_HYDRANT_KEY);
    if (!savedId) return;
    const hydrant = hydrants.find((h) => h.id === savedId);
    if (!hydrant) {
      localStorage.removeItem(OTW_HYDRANT_KEY);
      localStorage.removeItem(OTW_ROUTE_KEY);
      return;
    }
    setOtwHydrant(hydrant);
    const savedRoute = localStorage.getItem(OTW_ROUTE_KEY);
    if (savedRoute) {
      try {
        setOtwRoute(JSON.parse(savedRoute) as [number, number][]);
        otwFetchedForRef.current = savedId;
      } catch { /* corrupt data */ }
    }
  }, [hydrants, loading]);

  useEffect(() => {
    if (!otwHydrant || !userLocation) {
      setOtwRoute(null);
      setOtwMeta(null);
      otwFetchedForRef.current = null;
      return;
    }

    // Rate limit: only re-fetch if hydrant changed OR enough time has passed
    const now = Date.now();
    const hydrantChanged = otwFetchedForRef.current !== otwHydrant.id;
    const rateLimitOk = now - lastRouteFetchRef.current >= ROUTE_FETCH_INTERVAL_MS;
    if (!hydrantChanged && !rateLimitOk) return;

    otwFetchedForRef.current = otwHydrant.id;
    lastRouteFetchRef.current = now;

    let cancelled = false;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const coords = `${userLocation.lng},${userLocation.lat};${otwHydrant.lng},${otwHydrant.lat}`;

    // Mapbox Directions: request duration + distance in addition to geometry
    const url = token
      ? `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&annotations=duration,distance&access_token=${token}`
      : `https://router.project-osrm.org/route/v1/foot/${coords}?geometries=geojson&overview=full`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Directions API ${r.status}`);
        return r.json();
      })
      .then((data: { routes?: Array<{ geometry: { coordinates: [number, number][] }; distance: number; duration: number }> }) => {
        if (cancelled) return;
        const route = data.routes?.[0];
        if (!route) return;
        if (route.geometry?.coordinates?.length) setOtwRoute(route.geometry.coordinates);
        // Extract ETA and road distance from API response
        if (typeof route.distance === 'number' && typeof route.duration === 'number') {
          setOtwMeta({ distanceM: Math.round(route.distance), durationS: Math.round(route.duration) });
        }
      })
      .catch((err) => {
        console.warn('[Directions API] fetch failed, keeping last route:', err);
        // Don't clear existing route on error — graceful degradation
      });

    return () => { cancelled = true; };
  }, [otwHydrant, userLocation, ROUTE_FETCH_INTERVAL_MS]);

  useEffect(() => {
    otwRouteRef.current = otwRoute;
    if (!otwRoute) {
      controllerRef.current?.setZoomLimits(null, null);
      return;
    }
    controllerRef.current?.setZoomLimits(OTW_MIN_ZOOM, OTW_MAX_ZOOM);
    controllerRef.current?.fitRoute(otwRoute);
  }, [otwRoute]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
      setAutoFallback(true);
      setProvider('leaflet');
    }
  }, []);

  const handleMapboxError = useCallback(
    (error: unknown) => {
      console.warn('Mapbox failed to load, falling back to Leaflet/OSM:', error);
      setAutoFallback(true);
      if (!userOverride) setProvider('leaflet');
    },
    [userOverride],
  );

  const handleToggleProvider = useCallback(() => {
    setUserOverride(true);
    const ctrl = controllerRef.current;
    if (ctrl) {
      const rawZoom = ctrl.getZoom();
      const correctedZoom = provider === 'mapbox' ? rawZoom + 1 : rawZoom - 1;
      setMapViewport({ center: ctrl.getCenter(), zoom: correctedZoom });
    }
    if (provider === 'mapbox') {
      setIs3D(false);
      controllerRef.current?.setPitch(0);
    } else {
      // User is manually switching back to Mapbox — clear the auto-fallback warning.
      setAutoFallback(false);
    }
    setProvider(provider === 'mapbox' ? 'leaflet' : 'mapbox');
  }, [provider]);

  const handleMapReady = useCallback((controller: MapController) => {
    controllerRef.current = controller;
    setMapReady(true);
    if (otwRouteRef.current) {
      requestAnimationFrame(() => {
        controller.setZoomLimits(OTW_MIN_ZOOM, OTW_MAX_ZOOM);
        controller.fitRoute(otwRouteRef.current!);
      });
    }
  }, []);

  const handleToggle3D = useCallback(() => {
    setIs3D((prev) => {
      const next = !prev;
      controllerRef.current?.setPitch(next ? 60 : 0);
      return next;
    });
  }, []);

  const watchIdRef = useRef<number | null>(null);
  const geoErrorRef = useRef<GeolocationPositionError | null>(null);
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        geoErrorRef.current = null;
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        geoErrorRef.current = err;
        console.warn('[geolocation] watchPosition error', err.code, err.message);
      },
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 30000 },
    );
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const showGeoError = useCallback((msg: string) => {
    setGeoError(msg);
    if (geoErrorTimerRef.current) clearTimeout(geoErrorTimerRef.current);
    geoErrorTimerRef.current = setTimeout(() => setGeoError(null), 8000);
  }, []);

  const handleLocate = useCallback(() => {
    if (userLocation) {
      controllerRef.current?.flyTo(userLocation.lat, userLocation.lng, 17);
      return;
    }
    if (!('geolocation' in navigator)) {
      showGeoError('Geolocation is not supported by this browser.');
      return;
    }
    if (!window.isSecureContext) {
      showGeoError('Location needs a secure connection. Open the app over HTTPS or http://localhost.');
      return;
    }
    const onSuccess = (pos: GeolocationPosition) => {
      geoErrorRef.current = null;
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUserLocation(loc);
      controllerRef.current?.flyTo(loc.lat, loc.lng, 17);
    };
    const onFinalError = (err: GeolocationPositionError) => {
      geoErrorRef.current = err;
      showGeoError(
        err.code === err.PERMISSION_DENIED
          ? 'Location permission is blocked. Enable it in your browser settings.'
          : err.code === err.POSITION_UNAVAILABLE
          ? 'Could not get a location fix. Try a normal Chrome/Edge window or a device with GPS.'
          : err.code === err.TIMEOUT
          ? 'Timed out getting your location. Try again in a moment.'
          : 'Could not determine your location. Please try again.',
      );
    };
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        if (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE) {
          navigator.geolocation.getCurrentPosition(onSuccess, onFinalError, {
            enableHighAccuracy: false,
            timeout: 15000,
            maximumAge: 60000,
          });
          return;
        }
        onFinalError(err);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }, [userLocation, showGeoError]);

  const counts = useMemo(() => countByStatus(hydrants), [hydrants]);
  const visibleHydrants = useMemo(() => {
    let result = activeStatus ? hydrants.filter((h) => h.status === activeStatus) : hydrants;
    if (otwRoute && otwRoute.length >= 2) {
      result = result.filter(
        (h) => (otwHydrant && h.id === otwHydrant.id) || distToRouteM(h.lat, h.lng, otwRoute) <= ROUTE_BUFFER_M,
      );
    }
    return result;
  }, [activeStatus, hydrants, otwRoute, otwHydrant]);

  // Compute which hydrant IDs are within the route corridor — used by DilimanMap
  // to visually distinguish route hydrants from off-route ones.
  // Also derive hazard list: non-operational hydrants along the route.
  const { nearRouteIds, routeHazards } = useMemo(() => {
    if (!otwRoute || otwRoute.length < 2) {
      return { nearRouteIds: null, routeHazards: [] };
    }
    const ids = new Set<string>();
    const hazards: typeof hydrants = [];
    for (const h of hydrants) {
      if (distToRouteM(h.lat, h.lng, otwRoute) <= ROUTE_CORRIDOR_M) {
        ids.add(h.id);
        if (h.status === 'out' || h.status === 'reduced') {
          hazards.push(h);
        }
      }
    }
    return { nearRouteIds: ids, routeHazards: hazards };
  }, [hydrants, otwRoute]);

  // Chime once when hazards first appear during OTW mode
  const prevHazardCountRef = useRef(0);
  useEffect(() => {
    if (!otwHydrant) { prevHazardCountRef.current = 0; return; }
    if (routeHazards.length > 0 && prevHazardCountRef.current === 0) playHazardChime();
    prevHazardCountRef.current = routeHazards.length;
  }, [routeHazards.length, otwHydrant]);

  useEffect(() => {
    if (!selectedHydrant || loading) return;
    const fresh = hydrants.find((h) => h.id === selectedHydrant.id);
    if (!fresh) {
      const removed = { id: selectedHydrant.id, name: selectedHydrant.name };
      setSelectedHydrant(null);
      setShowFullDetails(false);
      setShowEdit(false);
      setShowReport(false);
      setDeletedHydrant(removed);
      if (deletedTimerRef.current) clearTimeout(deletedTimerRef.current);
      deletedTimerRef.current = setTimeout(() => setDeletedHydrant(null), 6000);
    } else if (fresh !== selectedHydrant) {
      setSelectedHydrant(fresh);
    }
  }, [hydrants, selectedHydrant, loading]);

  const handleSelectStatus = useCallback((status: HydrantStatus) => {
    setActiveStatus((prev) => (prev === status ? null : status));
  }, []);

  const handleSelectHydrant = useCallback((hydrant: Hydrant) => {
    setSelectedHydrant(hydrant);
    setShowFullDetails(false);
    setShowEdit(false);
    setShowReport(false);
    controllerRef.current?.flyTo(hydrant.lat, hydrant.lng, 16);
  }, []);

  const handleCloseAll = useCallback(() => {
    if (selectedHydrant || nearestHydrant) controllerRef.current?.zoomOut();
    setSelectedHydrant(null);
    setShowFullDetails(false);
    setShowEdit(false);
    setShowReport(false);
    setNearestPanelOpen(false);
    setNearestHydrant(null);
  }, [selectedHydrant, nearestHydrant]);

  const handleCloseFullDetails = useCallback(() => setShowFullDetails(false), []);
  const handleCloseEdit        = useCallback(() => setShowEdit(false), []);
  const handleCloseReport      = useCallback(() => setShowReport(false), []);

  const handleViewUser = useCallback((name: string, role: string) => {
    setViewingUser({ name, role });
  }, []);

  const handleRoute = useCallback(() => {
    if (!selectedHydrant) return;

    // Already have a fix — enter route mode immediately.
    if (userLocation) {
      setOtwHydrant(selectedHydrant);
      return;
    }

    // We already know location is blocked — don't enter route mode at all.
    const prevErr = geoErrorRef.current;
    if (prevErr && prevErr.code === prevErr.PERMISSION_DENIED) {
      showGeoError('Location permission is blocked — enable it to route.');
      return;
    }
    if (!('geolocation' in navigator)) {
      showGeoError('Location isn’t available on this device — routing needs your position.');
      return;
    }

    const onSuccess = (pos: GeolocationPosition) => {
      geoErrorRef.current = null;
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      // Only enter route mode once we actually have a position.
      setOtwHydrant(selectedHydrant);
    };
    const onFinalError = (err: GeolocationPositionError) => {
      geoErrorRef.current = err;
      // Location blocked/unavailable → do NOT enter route mode (no En Route banner).
      showGeoError(
        err.code === err.PERMISSION_DENIED
          ? 'Location permission is blocked — enable it to route.'
          : 'Could not get your location — routing unavailable.',
      );
    };
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        if (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE) {
          navigator.geolocation.getCurrentPosition(onSuccess, onFinalError, {
            enableHighAccuracy: false,
            timeout: 15000,
            maximumAge: 60000,
          });
          return;
        }
        onFinalError(err);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }, [selectedHydrant, userLocation, showGeoError]);

  const handleCancelOtw = useCallback(() => {
    const ctrl = controllerRef.current;
    if (ctrl) {
      ctrl.setZoomLimits(null, null);
      const center = ctrl.getCenter();
      ctrl.flyTo(center.lat, center.lng, Math.max(ctrl.getZoom() - 3, 12));
    }
    setOtwHydrant(null);
    setOtwRoute(null);
    setOtwMeta(null);
    otwFetchedForRef.current = null;
    lastRouteFetchRef.current = 0;
  }, []);

  const handleRouteDismiss = useCallback(() => {
    setSelectedHydrant(null);
    setShowFullDetails(false);
    setShowEdit(false);
    setShowReport(false);
  }, []);

  const handleOpenAccount = useCallback(() => {
    setShowAccount(true);
  }, []);

  const handleToggleAddHydrant = useCallback(() => {
    setAddHydrantMode((prev) => {
      if (!prev) {
        setSelectedHydrant(null);
        setShowFullDetails(false);
        setShowEdit(false);
        setShowReport(false);
      } else {
        setPendingLocation(null);
      }
      return !prev;
    });
  }, []);

  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    controllerRef.current?.flyTo(lat, lng, 17);
    setPendingLocation({ lat, lng, address: 'Loading…' });
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json() as { display_name?: string };
      setPendingLocation({ lat, lng, address: data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    } catch {
      setPendingLocation({ lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    }
  }, []);

  // Handle nearest hydrant selection — fly map to it
  const handleNearestHydrantSelect = useCallback((hydrant: RankedHydrant | null) => {
    setNearestHydrant(hydrant);
    if (hydrant) {
      controllerRef.current?.flyTo(hydrant.lat, hydrant.lng, 17);
    }
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden">

      {/* ── Initial loading splash ── */}
      {!splashDone && (
        <div
          className={`pointer-events-none absolute inset-0 z-[9999] flex flex-col items-center justify-center bg-neutral-700 backdrop-blur-sm transition-opacity duration-500 ${splashFading ? 'opacity-0' : 'opacity-100'}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Hydro-Scout%20Logo.png" alt="" className="mb-2 h-20 w-20 object-contain opacity-90" style={{ animation: 'bounce-dot 1.8s ease-in-out infinite' }} />
          <span className="mb-5 text-4xl font-extrabold tracking-tight text-white">
            Hydro-<span className="text-[#e0353b]">Scout</span>
          </span>
          <div className="flex gap-2">
            <span className="bounce-dot-1 h-2.5 w-2.5 rounded-full bg-[#FED42E]" />
            <span className="bounce-dot-2 h-2.5 w-2.5 rounded-full bg-[#FED42E]" />
            <span className="bounce-dot-3 h-2.5 w-2.5 rounded-full bg-[#FED42E]" />
          </div>
          <p className="mt-4 text-xs font-semibold tracking-widest text-white/50 uppercase">Loading map…</p>
        </div>
      )}

      <MapView
        provider={provider}
        hydrants={visibleHydrants}
        selectedHydrantId={selectedHydrant?.id ?? null}
        onMapboxError={handleMapboxError}
        onMapReady={handleMapReady}
        onSelectHydrant={handleSelectHydrant}
        addHydrantMode={addHydrantMode}
        onMapClick={handleMapClick}
        onMapBackgroundClick={handleCloseAll}
        pendingPin={pendingLocation}
        is3D={is3D}
        userLocation={userLocation}
        otwHydrant={otwHydrant}
        otwRoute={otwRoute}
        nearRouteIds={nearRouteIds}
        initialCenter={mapViewport?.center}
        initialZoom={mapViewport?.zoom}
      />
      <DashboardOverlay
        activeStatus={activeStatus}
        onSelectStatus={handleSelectStatus}
        counts={counts}
        provider={provider}
        autoFallback={autoFallback}
        onToggleProvider={handleToggleProvider}
        onZoomIn={() => controllerRef.current?.zoomIn()}
        onZoomOut={() => controllerRef.current?.zoomOut()}
        onLocate={handleLocate}
        onFlyTo={(lat, lng, zoom) => controllerRef.current?.flyTo(lat, lng, zoom)}
        onToggle3D={handleToggle3D}
        is3D={is3D}
        showReports={showReports}
        onToggleReports={() => setShowReports((v) => !v)}
        onOpenAccount={handleOpenAccount}
        onOpenDashboard={() => setShowOpsDashboard(true)}
        addHydrantMode={addHydrantMode}
        onToggleAddHydrant={handleToggleAddHydrant}
        hasPendingReports={hasPendingReports}
        loading={loading}
        lastSynced={lastSynced}
        isOtw={!!otwHydrant}
        routeHazards={routeHazards}
        onSelectHazardHydrant={handleSelectHydrant}
      />

      {/* ── Nearest Hydrant Panel — bottom-left, above map, below modals ── */}
      <div style={{ position: "absolute", bottom: 32, left: 16, zIndex: 1100, pointerEvents: "none" }}>
        <NearestHydrantPanel
          userPosition={userLocation}
          onHydrantSelect={handleNearestHydrantSelect}
          selectedHydrantId={nearestHydrant?.id ?? null}
          isOpen={nearestPanelOpen}
          onOpen={() => setNearestPanelOpen(true)}
          onClose={() => { controllerRef.current?.zoomOut(); setNearestPanelOpen(false); setNearestHydrant(null); }}
        />
      </div>


      {/* OTW banner */}
      {otwHydrant && (
        <div className="pointer-events-auto absolute left-1/2 top-[6.5rem] sm:top-[4.75rem] z-[2000] -translate-x-1/2 w-[calc(100vw-1.5rem)] sm:w-auto anim-fade-scale">

          {/* Mobile (< sm): 2-row compact card */}
          <div className="flex flex-col sm:hidden rounded-2xl bg-red-900/90 px-3 py-2 shadow-xl backdrop-blur-sm gap-1.5">
            {/* Row 1: pulse · En Route · ID · name */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-400" />
              <span className="shrink-0 text-xs font-bold text-white">En Route</span>
              <span className="shrink-0 text-red-400 text-xs">·</span>
              <span className="shrink-0 text-xs font-mono text-red-200">{otwHydrant.id}</span>
              <span className="min-w-0 truncate text-xs text-red-300">{otwHydrant.name}</span>
            </div>
            {/* Row 2: distance / duration + action buttons */}
            <div className="flex items-center gap-2">
              {otwMeta ? (
                <>
                  <span className="text-xs font-bold text-white">{formatDistance(otwMeta.distanceM)}</span>
                  <span className="text-red-400 text-xs">·</span>
                  <span className="text-xs font-bold text-emerald-300">
                    {otwMeta.durationS < 60
                      ? `${otwMeta.durationS}s`
                      : `${Math.round(otwMeta.durationS / 60)} min`}
                  </span>
                </>
              ) : userLocation ? (
                <span className="text-xs font-bold text-white">
                  {formatDistance(haversineM(userLocation.lat, userLocation.lng, otwHydrant.lat, otwHydrant.lng))}
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1.5">
                <span className="h-3 w-px bg-white/20" />
                <button
                  title="Recenter to my location"
                  onClick={() => userLocation && controllerRef.current?.flyTo(userLocation.lat, userLocation.lng, 16)}
                  className="rounded-full bg-white/15 p-1.5 hover:bg-white/30"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                    <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                  </svg>
                </button>
                <button
                  title="Show full route"
                  onClick={() => otwRoute && controllerRef.current?.fitRoute(otwRoute)}
                  className="rounded-full bg-white/15 p-1.5 hover:bg-white/30"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="5 9 2 12 5 15"/><polyline points="19 9 22 12 19 15"/>
                    <line x1="2" y1="12" x2="22" y2="12"/>
                  </svg>
                </button>
                <button
                  onClick={handleCancelOtw}
                  className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-white/30"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>

          {/* Tablet / Desktop (≥ sm): original single-row pill */}
          <div className="hidden sm:flex items-center gap-2.5 rounded-full bg-red-900/90 px-4 py-2 shadow-xl backdrop-blur-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
            <span className="text-xs font-bold text-white">En Route</span>
            <span className="text-red-400 text-xs">·</span>
            <span className="text-xs font-mono text-red-200">{otwHydrant.id}</span>
            <span className="max-w-[120px] truncate text-xs text-red-300">{otwHydrant.name}</span>
            {otwMeta ? (
              <>
                <span className="text-red-400 text-xs">·</span>
                <span className="text-xs font-bold text-white">{formatDistance(otwMeta.distanceM)}</span>
                <span className="text-red-400 text-xs">·</span>
                <span className="text-xs font-bold text-emerald-300">
                  {otwMeta.durationS < 60
                    ? `${otwMeta.durationS}s`
                    : `${Math.round(otwMeta.durationS / 60)} min`}
                </span>
              </>
            ) : userLocation ? (
              <>
                <span className="text-red-400 text-xs">·</span>
                <span className="text-xs font-bold text-white">
                  {formatDistance(haversineM(userLocation.lat, userLocation.lng, otwHydrant.lat, otwHydrant.lng))}
                </span>
              </>
            ) : null}
            <span className="mx-1 h-3 w-px bg-white/20" />
            <button
              title="Recenter to my location"
              onClick={() => userLocation && controllerRef.current?.flyTo(userLocation.lat, userLocation.lng, 16)}
              className="rounded-full bg-white/15 p-1.5 hover:bg-white/30"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
              </svg>
            </button>
            <button
              title="Show full route"
              onClick={() => otwRoute && controllerRef.current?.fitRoute(otwRoute)}
              className="rounded-full bg-white/15 p-1.5 hover:bg-white/30"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="5 9 2 12 5 15"/><polyline points="19 9 22 12 19 15"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
              </svg>
            </button>
            <button
              onClick={handleCancelOtw}
              className="ml-0.5 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold text-white hover:bg-white/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Geo-error toast */}
      {geoError && (
        <div className="pointer-events-auto absolute left-1/2 top-[4.25rem] z-[2100] flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-neutral-900/90 px-4 py-2 shadow-xl backdrop-blur-sm anim-fade-scale max-w-[min(420px,90vw)]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span className="text-xs text-neutral-200 leading-snug">{geoError}</span>
          <button
            onClick={() => { setGeoError(null); if (geoErrorTimerRef.current) clearTimeout(geoErrorTimerRef.current); }}
            className="ml-1 shrink-0 rounded-full p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
            aria-label="Dismiss"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {/* Live-data status pill */}
      {(loading || error) && (
        <div className="pointer-events-none absolute left-1/2 top-[5.25rem] z-[1200] -translate-x-1/2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold shadow-md ${
            error ? 'bg-[#e0353b] text-white' : 'bg-white/95 text-neutral-600 dark:bg-neutral-800/95 dark:text-neutral-300'
          }`}>
            {error ? `Couldn't load hydrants: ${error}` : 'Loading hydrants…'}
          </span>
        </div>
      )}

      {showReports && (
        <>
          <div className="pointer-events-auto absolute inset-0 z-[1400]" onClick={() => setShowReports(false)} />
          <ReportsPanel reports={reports} loading={reportsLoading} onViewUser={handleViewUser} />
        </>
      )}

      {selectedHydrant && (
        <HydrantInfoPanel
          hydrant={selectedHydrant}
          onClose={handleCloseAll}
          onOpenFullDetails={() => { setShowFullDetails(true); setShowEdit(false); setShowReport(false); }}
          onEdit={() => setShowEdit(true)}
          onReport={() => setShowReport(true)}
          onFlyTo={(lat, lng) => controllerRef.current?.flyTo(lat, lng, 17)}
          onRoute={handleRoute}
          onRouteDismiss={handleRouteDismiss}
          isOtw={otwHydrant?.id === selectedHydrant?.id}
        />
      )}

      {selectedHydrant && showFullDetails && (
        <FullDetailsPanel
          hydrant={selectedHydrant}
          onClose={handleCloseFullDetails}
          onViewUser={handleViewUser}
          onFlyTo={(lat, lng) => controllerRef.current?.flyTo(lat, lng, 17)}
          distanceM={userLocation ? haversineM(userLocation.lat, userLocation.lng, selectedHydrant.lat, selectedHydrant.lng) : null}
          isOtw={otwHydrant?.id === selectedHydrant?.id}
        />
      )}
      {selectedHydrant && showEdit && (
        <EditStatusPanel
          hydrant={selectedHydrant}
          onClose={handleCloseEdit}
          onOpenAccount={handleOpenAccount}
        />
      )}
      {selectedHydrant && showReport && (
        <DamageReportModal
          hydrant={selectedHydrant}
          onClose={handleCloseReport}
          onOpenAccount={handleOpenAccount}
        />
      )}

      {showAccount && (
        <AccountCenterModal onClose={() => setShowAccount(false)} />
      )}

      {addHydrantMode && pendingLocation && (
        <LocationPreviewPanel
          lat={pendingLocation.lat}
          lng={pendingLocation.lng}
          address={pendingLocation.address}
          onPinHydrant={() => setShowPinHydrant(true)}
          onDismiss={() => setPendingLocation(null)}
        />
      )}

      {showPinHydrant && (
        <PinHydrantModal
          onClose={() => { setShowPinHydrant(false); setPendingLocation(null); setAddHydrantMode(false); }}
          initialLat={pendingLocation?.lat}
          initialLng={pendingLocation?.lng}
          initialAddress={pendingLocation?.address}
        />
      )}

      {showOpsDashboard && (
        <OperationsDashboard
          hydrants={hydrants}
          reports={reports}
          role={role}
          onClose={() => setShowOpsDashboard(false)}
        />
      )}

      {viewingUser && (
        <UserProfileModal
          user={viewingUser}
          onClose={() => setViewingUser(null)}
        />
      )}

      {deletedHydrant && (
        <>
          <div className="pointer-events-auto absolute inset-0 z-[5000] bg-black/35" onClick={() => setDeletedHydrant(null)} />
          <div className="pointer-events-none absolute inset-0 z-[5001] flex items-center justify-center">
            <div className="pointer-events-auto anim-fade-scale flex w-[320px] flex-col items-center gap-4 rounded-2xl bg-white px-8 py-8 shadow-2xl text-center dark:bg-neutral-900">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e0353b]/10 dark:bg-[#e0353b]/15">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-[#e0353b] dark:text-[#e0353b]">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-neutral-800 dark:text-neutral-100">Hydrant No Longer Exists</p>
                <p className="mt-1 text-[11px] text-neutral-500 leading-relaxed dark:text-neutral-400">
                  <span className="font-semibold text-neutral-700 dark:text-neutral-200">{deletedHydrant.id}</span> — {deletedHydrant.name}<br />
                  has been removed by an administrator.
                </p>
              </div>
              <button
                onClick={() => { setDeletedHydrant(null); if (deletedTimerRef.current) clearTimeout(deletedTimerRef.current); }}
                className="w-full rounded-lg bg-[#e0353b] py-2 text-xs font-bold text-white hover:bg-[#c42d32] active:bg-[#9e2428]"
              >
                Dismiss
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
