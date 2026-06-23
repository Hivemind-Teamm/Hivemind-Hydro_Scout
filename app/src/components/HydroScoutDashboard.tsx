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

  const controllerRef = useRef<MapController | null>(null);
  const otwFetchedForRef = useRef<string | null>(null);
  const otwRestoredRef  = useRef(false);
  const otwRouteRef     = useRef<[number, number][] | null>(null);

  const [lastSynced, setLastSynced] = useState<Date | null>(null);

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
    setProvider((prev) => {
      if (prev === 'mapbox') {
        setIs3D(false);
        controllerRef.current?.setPitch(0);
      }
      return prev === 'mapbox' ? 'leaflet' : 'mapbox';
    });
  }, []);

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
  // watchId ref lets us clean up on unmount.
  const watchIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => { /* denied or unavailable — orb simply won't appear */ },
      { enableHighAccuracy: true },
    );
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // GPS button now just flies the camera to the current known location.
  const handleLocate = useCallback(() => {
    if (userLocation) {
      controllerRef.current?.flyTo(userLocation.lat, userLocation.lng, 17);
    } else if (!('geolocation' in navigator)) {
      alert('Geolocation is not supported by this browser.');
    }
  }, [userLocation]);

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
  useEffect(() => {
    if (!selectedHydrant) return;
    const fresh = hydrants.find((h) => h.id === selectedHydrant.id);
    if (fresh && fresh !== selectedHydrant) setSelectedHydrant(fresh);
  }, [hydrants, selectedHydrant]);

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
    setSelectedHydrant(null);
    setShowFullDetails(false);
    setShowEdit(false);
    setShowReport(false);
  }, []);

  // Each panel closes only itself — mini panel and siblings stay visible.
  const handleCloseFullDetails = useCallback(() => setShowFullDetails(false), []);
  const handleCloseEdit        = useCallback(() => setShowEdit(false), []);
  const handleCloseReport      = useCallback(() => setShowReport(false), []);

  const handleViewUser = useCallback((name: string, role: string) => {
    setViewingUser({ name, role });
  }, []);

  const handleRoute = useCallback(() => {
    if (selectedHydrant) setOtwHydrant(selectedHydrant);
  }, [selectedHydrant]);

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

      {/* Live-data status pill */}
      {(loading || error) && (
        <div className="pointer-events-none absolute left-1/2 top-[84px] z-[1200] -translate-x-1/2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold shadow-md ${
              error ? 'bg-[#91191E] text-white' : 'bg-white/95 text-neutral-600'
            }`}
          >
            {error ? `Couldn’t load hydrants: ${error}` : 'Loading hydrants…'}
          </span>
        </div>
      )}

      {showReports && (
        <ReportsPanel reports={reports} loading={reportsLoading} onViewUser={handleViewUser} />
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
    </div>
  );
}
