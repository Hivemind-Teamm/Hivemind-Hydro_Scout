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
import {
  countByStatus,
  type Hydrant,
  type HydrantStatus,
} from '../data/hydrants';
import { useHydrants, useReports } from '../data/store';
import { useAuth } from '@/lib/auth-context';
import { haversineM, formatDistance, distToRouteM } from '@/lib/haversine';

const OTW_HYDRANT_KEY  = 'hydroscout_otw_hydrant_id';
const OTW_ROUTE_KEY    = 'hydroscout_otw_route';
const OTW_MIN_ZOOM     = 13;
const OTW_MAX_ZOOM     = 19;
const ROUTE_BUFFER_M   = 300; // hydrants within 300m of route are shown in OTW mode

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
  const geoErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const controllerRef = useRef<MapController | null>(null);
  const otwFetchedForRef = useRef<string | null>(null);
  const otwRestoredRef  = useRef(false);
  const otwRouteRef     = useRef<[number, number][] | null>(null);

  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [deletedHydrant, setDeletedHydrant] = useState<{ id: string; name: string } | null>(null);
  const deletedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { role } = useAuth();
  const { hydrants, loading, error } = useHydrants();
  const { reports, loading: reportsLoading } = useReports();
  const hasPendingReports = reports.some((r) => r.status === 'pending');

  useEffect(() => {
    if (!loading) setLastSynced(new Date());
  }, [loading, hydrants]);

  // Persist OTW hydrant ID to localStorage
  useEffect(() => {
    if (otwHydrant) {
      localStorage.setItem(OTW_HYDRANT_KEY, otwHydrant.id);
    } else {
      localStorage.removeItem(OTW_HYDRANT_KEY);
      localStorage.removeItem(OTW_ROUTE_KEY);
    }
  }, [otwHydrant]);

  // Persist route geometry to localStorage
  useEffect(() => {
    if (otwRoute) localStorage.setItem(OTW_ROUTE_KEY, JSON.stringify(otwRoute));
  }, [otwRoute]);

  // Restore OTW state once hydrants are loaded after a refresh
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
        otwFetchedForRef.current = savedId; // skip re-fetch; we already have the route
      } catch { /* corrupt data — will re-fetch naturally */ }
    }
  }, [hydrants, loading]);

  // Fetch real road route whenever OTW target changes (re-fetches once GPS becomes available too)
  useEffect(() => {
    if (!otwHydrant || !userLocation) {
      setOtwRoute(null);
      otwFetchedForRef.current = null;
      return;
    }
    // Guard: don't re-fetch on every GPS tick — only when the target hydrant changes
    if (otwFetchedForRef.current === otwHydrant.id) return;
    otwFetchedForRef.current = otwHydrant.id;

    let cancelled = false;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const coords = `${userLocation.lng},${userLocation.lat};${otwHydrant.lng},${otwHydrant.lat}`;
    const url = token
      ? `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${token}`
      : `https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`;

    fetch(url)
      .then((r) => r.json())
      .then((data: { routes?: Array<{ geometry: { coordinates: [number, number][] } }> }) => {
        if (!cancelled) {
          const routeCoords = data.routes?.[0]?.geometry?.coordinates;
          if (routeCoords?.length) setOtwRoute(routeCoords);
        }
      })
      .catch(() => { /* falls back to straight line */ });

    return () => { cancelled = true; };
  }, [otwHydrant, userLocation]);

  // Keep ref in sync, apply zoom limits and auto-fit whenever route changes
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
      // Mapbox uses 512px tiles; Leaflet uses 256px — offset by 1 zoom level to match visual scale
      const correctedZoom = provider === 'mapbox' ? rawZoom + 1 : rawZoom - 1;
      setMapViewport({ center: ctrl.getCenter(), zoom: correctedZoom });
    }
    if (provider === 'mapbox') {
      setIs3D(false);
      controllerRef.current?.setPitch(0);
    }
    setProvider(provider === 'mapbox' ? 'leaflet' : 'mapbox');
  }, [provider]);

  const handleMapReady = useCallback((controller: MapController) => {
    controllerRef.current = controller;
    // If OTW was restored from localStorage before the map initialised, apply limits + fit now
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

  // Auto-start watching position on mount. The orb updates as the user moves.
  // watchId ref lets us clean up on unmount; geoErrorRef remembers the last
  // failure so the GPS button can explain why there's no fix.
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
        // Keep the last error so handleLocate can surface it; without this the
        // orb just silently never appears (denied / timeout / insecure origin).
        geoErrorRef.current = err;
        console.warn('[geolocation] watchPosition error', err.code, err.message);
      },
      // Passive tracking uses network-level accuracy: it resolves on laptops /
      // desktops that have no GPS (where a high-accuracy request just comes back
      // as POSITION_UNAVAILABLE / TIMEOUT), is low-power, and is plenty for "where
      // am I on the map". The GPS button below asks for a precise fix on demand.
      // Bounded timeout + maximumAge let a recent cached fix show the orb promptly.
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

  // GPS button: fly to a known fix, or actively request one (and report why it
  // failed) when we don't have a location yet.
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
    // High-accuracy GPS often can't get a fix on a desktop / indoors / weak signal
    // and comes back as TIMEOUT or POSITION_UNAVAILABLE. In both cases retry once
    // with low accuracy, which uses fast network/Wi-Fi positioning, before giving
    // up. A generous maximumAge also lets a recent cached fix return immediately
    // instead of waiting on the GPS.
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

  // Keep the selected hydrant in sync with live updates (e.g. after an edit).
  // When it's gone from Firestore entirely (deleted by admin), close all panels
  // and flash the "removed" notice.
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
    if (selectedHydrant) controllerRef.current?.zoomOut();
    setSelectedHydrant(null);
    setShowFullDetails(false);
    setShowEdit(false);
    setShowReport(false);
  }, [selectedHydrant]);

  // Each panel closes only itself — mini panel and siblings stay visible.
  const handleCloseFullDetails = useCallback(() => setShowFullDetails(false), []);
  const handleCloseEdit        = useCallback(() => setShowEdit(false), []);
  const handleCloseReport      = useCallback(() => setShowReport(false), []);

  const handleViewUser = useCallback((name: string, role: string) => {
    setViewingUser({ name, role });
  }, []);

  const handleRoute = useCallback(() => {
    if (!selectedHydrant) return;
    // Start OTW mode immediately so the banner appears right away.
    setOtwHydrant(selectedHydrant);
    // If we already have a location the route fetch effect will run on its own.
    if (userLocation) return;
    // No location yet — request a one-shot fix so the route can be drawn.
    if (!('geolocation' in navigator)) return;
    const onSuccess = (pos: GeolocationPosition) => {
      geoErrorRef.current = null;
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    };
    const onFinalError = (err: GeolocationPositionError) => {
      geoErrorRef.current = err;
      // OTW banner is already visible; just note that the route line needs GPS.
      if (err.code === err.PERMISSION_DENIED) {
        showGeoError('Location permission is blocked — route line unavailable.');
      }
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

  const handleCancelOtw = useCallback(() => { setOtwHydrant(null); setOtwRoute(null); otwFetchedForRef.current = null; }, []);

  const handleOpenAccount = useCallback(() => {
    setShowAccount(true);
  }, []);

  const handleToggleAddHydrant = useCallback(() => {
    setAddHydrantMode((prev) => {
      if (!prev) {
        // entering mode — clear any selected hydrant
        setSelectedHydrant(null);
        setShowFullDetails(false);
        setShowEdit(false);
        setShowReport(false);
      } else {
        // exiting mode — clear pending pin
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

  return (
    <div className="relative h-screen w-screen overflow-hidden">
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
      />

      {/* OTW banner */}
      {otwHydrant && (
        <div className="pointer-events-auto absolute left-1/2 top-[68px] z-[2000] flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-red-900/90 px-4 py-2 shadow-xl backdrop-blur-sm anim-fade-scale">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
          <span className="text-xs font-bold text-white">En Route</span>
          <span className="text-red-400 text-xs">·</span>
          <span className="text-xs font-mono text-red-200">{otwHydrant.id}</span>
          <span className="max-w-[120px] truncate text-xs text-red-300">{otwHydrant.name}</span>
          {userLocation && (
            <>
              <span className="text-red-400 text-xs">·</span>
              <span className="text-xs font-bold text-white">
                {formatDistance(haversineM(userLocation.lat, userLocation.lng, otwHydrant.lat, otwHydrant.lng))}
              </span>
            </>
          )}
          <span className="mx-1 h-3 w-px bg-white/20" />
          {/* Recenter: fly to current GPS position */}
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
          {/* Show Full Route: fit the map to the entire route polyline */}
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
      )}

      {/* Geo-error toast */}
      {geoError && (
        <div className="pointer-events-auto absolute left-1/2 top-[68px] z-[2100] flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-neutral-900/90 px-4 py-2 shadow-xl backdrop-blur-sm anim-fade-scale max-w-[min(420px,90vw)]">
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
        <div className="pointer-events-none absolute left-1/2 top-[84px] z-[1200] -translate-x-1/2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold shadow-md ${
              error ? 'bg-[#91191E] text-white' : 'bg-white/95 text-neutral-600'
            }`}
          >
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

{/* Mini info panel — always visible when a hydrant is selected */}
       {selectedHydrant && (
         <HydrantInfoPanel
           hydrant={selectedHydrant}
           onClose={handleCloseAll}
           onOpenFullDetails={() => { setShowFullDetails(true); setShowEdit(false); setShowReport(false); }}
           onEdit={() => setShowEdit(true)}
           onReport={() => setShowReport(true)}
           onFlyTo={(lat, lng) => controllerRef.current?.flyTo(lat, lng, 17)}
           onRoute={handleRoute}
           isOtw={otwHydrant?.id === selectedHydrant?.id}
         />
       )}

{/* Sub-panels: each closes only itself, mini panel and siblings stay */}
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

      {/* Account Center */}
      {showAccount && (
        <AccountCenterModal onClose={() => setShowAccount(false)} />
      )}

      {/* Location preview panel — shown after clicking map in add hydrant mode */}
      {addHydrantMode && pendingLocation && (
        <LocationPreviewPanel
          lat={pendingLocation.lat}
          lng={pendingLocation.lng}
          address={pendingLocation.address}
          onPinHydrant={() => {
            setShowPinHydrant(true);
          }}
          onDismiss={() => setPendingLocation(null)}
        />
      )}

      {/* Pin Hydrant modal (authorized / head / admin) */}
      {showPinHydrant && (
        <PinHydrantModal
          onClose={() => { setShowPinHydrant(false); setPendingLocation(null); setAddHydrantMode(false); }}
          initialLat={pendingLocation?.lat}
          initialLng={pendingLocation?.lng}
          initialAddress={pendingLocation?.address}
        />
      )}

      {/* Operations Dashboard (head / admin only) */}
      {showOpsDashboard && (
        <OperationsDashboard
          hydrants={hydrants}
          reports={reports}
          role={role}
          onClose={() => setShowOpsDashboard(false)}
        />
      )}

      {/* User profile viewer */}
      {viewingUser && (
        <UserProfileModal
          user={viewingUser}
          onClose={() => setViewingUser(null)}
        />
      )}

      {/* Hydrant deleted notice */}
      {deletedHydrant && (
        <>
          <div className="pointer-events-auto absolute inset-0 z-[5000] bg-black/35" onClick={() => setDeletedHydrant(null)} />
          <div className="pointer-events-none absolute inset-0 z-[5001] flex items-center justify-center">
            <div className="pointer-events-auto anim-fade-scale flex w-[320px] flex-col items-center gap-4 rounded-2xl bg-white px-8 py-8 shadow-2xl text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#91191E]/10">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#91191E" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-neutral-800">Hydrant No Longer Exists</p>
                <p className="mt-1 text-[11px] text-neutral-500 leading-relaxed">
                  <span className="font-semibold text-neutral-700">{deletedHydrant.id}</span> — {deletedHydrant.name}<br />
                  has been removed by an administrator.
                </p>
              </div>
              <button
                onClick={() => { setDeletedHydrant(null); if (deletedTimerRef.current) clearTimeout(deletedTimerRef.current); }}
                className="w-full rounded-lg bg-[#91191E] py-2 text-xs font-bold text-white hover:bg-[#7a1419] active:bg-[#611014]"
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
