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
import AdminDashboard from './AdminDashboard';
import PinHydrantModal from './PinHydrantModal';
import LocationPreviewPanel from './LocationPreviewPanel';
import NearestHydrantPanel from './NearestHydrantPanel';
import {
  countByStatus,
  STATUS_META,
  type Hydrant,
  type HydrantStatus,
} from '../data/hydrants';
import { useHydrants, useReports } from '../data/store';
import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-media-query';
import { useOnlineStatus } from '@/lib/use-online-status';
import { haversineM, formatDistance, formatDuration, distToRouteM } from '@/lib/haversine';
import { type RankedHydrant } from '@/lib/nearest-hydrant';
import { playHazardChime } from '@/lib/chime';

const OTW_HYDRANT_KEY  = 'hydroscout_otw_hydrant_id';
const OTW_ROUTE_KEY    = 'hydroscout_otw_route';
const OTW_MIN_ZOOM     = 13;
const OTW_MAX_ZOOM     = 19;
const ROUTE_BUFFER_M   = 300;
const ROUTE_CORRIDOR_M = 300;

// Fire-truck response factor applied to the free-flow driving ETA. Mapbox has no
// emergency-vehicle profile, so we approximate: a responding fire truck (siren,
// right-of-way, exceeding limits, bypassing congestion) reaches the scene faster
// than an ordinary car obeying normal flow. 0.75 ≈ 25% faster than free-flow.
// Tune to match observed local response times.
const EMERGENCY_ETA_FACTOR = 0.75;

export default function HydroScoutDashboard() {
  // Start on Leaflet/OSM immediately when no Mapbox token is configured, so we
  // never flash a broken Mapbox render before an effect can fall back.
  const [provider, setProvider] = useState<MapProvider>(
    () => (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ? 'mapbox' : 'leaflet'),
  );
  const [autoFallback, setAutoFallback] = useState(
    () => !process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  );
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
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [showPinHydrant,   setShowPinHydrant]   = useState(false);
  const [addHydrantMode,   setAddHydrantMode]   = useState(false);
  const [pendingLocation,  setPendingLocation]  = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [userLocation,     setUserLocation]     = useState<{ lat: number; lng: number } | null>(null);
  const [otwHydrant,       setOtwHydrant]       = useState<Hydrant | null>(null);
  const [otwRoute,         setOtwRoute]         = useState<[number, number][] | null>(null);
  const [viewingUser, setViewingUser] = useState<ViewingUser | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  // Hydrant pending a "route anyway?" confirmation because it's not operational.
  const [nonOperationalConfirm, setNonOperationalConfirm] = useState<Hydrant | null>(null);

  // Nearest hydrant state
  const [nearestHydrant, setNearestHydrant] = useState<RankedHydrant | null>(null);
  const [nearestPanelOpen, setNearestPanelOpen] = useState(false);
  const [otwMeta, setOtwMeta] = useState<{ distanceM: number; durationS: number } | null>(null);
  // OTW hazard panel minimized state — lifted here so tapping the map can collapse it.
  const [hazardPanelMinimized, setHazardPanelMinimized] = useState(false);

  const geoErrorTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef         = useRef<MapController | null>(null);
  const panelScrollRef        = useRef<HTMLDivElement | null>(null);
  const mapLongPressTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapScrollDragStartY   = useRef(0);
  const mapScrollDragStartTop = useRef(0);
  const mapScrollCaptureEl    = useRef<HTMLDivElement | null>(null);
  const mapScrollCaptureId    = useRef<number>(-1);
  const [mapScrollMode, setMapScrollMode] = useState(false);
  const otwFetchedForRef = useRef<string | null>(null);
  const otwRestoredRef  = useRef(false);
  const otwRouteRef     = useRef<[number, number][] | null>(null);
  const lastRouteFetchRef = useRef<number>(0);
  const ROUTE_FETCH_INTERVAL_MS = 10_000;

  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [otwEdgePos, setOtwEdgePos] = useState<{ x: number; y: number; angle: number } | null>(null);
  const [deletedHydrant, setDeletedHydrant] = useState<{ id: string; name: string } | null>(null);
  const deletedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connectivity — notify when the internet drops or is weak so users know the
  // hydrant locations they still see are coming from cache.
  const connection = useOnlineStatus();
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOfflineRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (connection === 'offline' || connection === 'weak') {
      wasOfflineRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowReconnected(false);
    } else if (wasOfflineRef.current) {
      // Just came back — flash a brief confirmation, then auto-dismiss.
      wasOfflineRef.current = false;
      setShowReconnected(true);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => setShowReconnected(false), 3500);
    }
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connection]);

  // Splash screen — shown until BOTH the map is ready AND hydrant data has loaded
  const [splashDone, setSplashDone] = useState(false);
  const [splashFading, setSplashFading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const splashStartedRef = useRef(false);

  const { role } = useAuth();
  const isMobile = useIsMobile();
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
    // Stamp the sync time whenever the live hydrant feed delivers new data —
    // this is inherently a reaction to an external subscription, not derivable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // One-time restore of persisted OTW state after the hydrant list loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // Clear stale route state when the OTW target or GPS fix goes away.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      ? `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&annotations=duration,distance&access_token=${token}`
      : `https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`;

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
        // Extract road distance + ETA. The ETA is scaled by the fire-truck
        // response factor since an emergency vehicle beats ordinary-car flow.
        if (typeof route.distance === 'number' && typeof route.duration === 'number') {
          setOtwMeta({
            distanceM: Math.round(route.distance),
            durationS: Math.round(route.duration * EMERGENCY_ETA_FACTOR),
          });
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

  // Offline, Mapbox can't fetch styles/tiles (they aren't service-worker
  // cached), so switch to Leaflet proactively — its CARTO tiles and chunk are
  // cached, so the map keeps rendering instead of erroring out.
  useEffect(() => {
    if (connection === 'offline' && !userOverride) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProvider('leaflet');
    }
  }, [connection, userOverride]);

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
      // Both controllers report zoom in Mapbox units (LeafletMap converts
      // internally — see OSM_ZOOM_OFFSET), so the viewport carries over as-is.
      setMapViewport({ center: ctrl.getCenter(), zoom: ctrl.getZoom() });
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

  const hasAutoLocatedRef = useRef(false);
  useEffect(() => {
    if (hasAutoLocatedRef.current || !mapReady || !userLocation) return;
    hasAutoLocatedRef.current = true;
    controllerRef.current?.flyTo(userLocation.lat, userLocation.lng, 17);
  }, [mapReady, userLocation]);

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
      // React to the selected hydrant being deleted from the live feed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    setNonOperationalConfirm(null);
  }, [selectedHydrant, nearestHydrant]);

  // Reset the hazard panel back to expanded whenever OTW mode ends.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!otwHydrant) setHazardPanelMinimized(false);
  }, [otwHydrant]);

  // Tapping empty map closes any open panels and, during OTW, collapses the
  // route-hazard window so it's out of the way while navigating.
  const handleMapBackgroundClick = useCallback(() => {
    handleCloseAll();
    if (otwHydrant) setHazardPanelMinimized(true);
  }, [handleCloseAll, otwHydrant]);

  const handleCloseFullDetails = useCallback(() => setShowFullDetails(false), []);
  const handleCloseEdit        = useCallback(() => setShowEdit(false), []);
  const handleCloseReport      = useCallback(() => setShowReport(false), []);

  const handleViewUser = useCallback((name: string, role: string) => {
    setViewingUser({ name, role });
  }, []);

  // Actually enters route mode for `hydrant` — the geolocation dance that used
  // to live directly inside handleRoute. Split out so the non-operational
  // confirm toast can trigger it after the user chooses "Route Anyway".
  const proceedRoute = useCallback((hydrant: Hydrant) => {
    // Already have a fix — enter route mode immediately.
    if (userLocation) {
      setOtwHydrant(hydrant);
      if (isMobile) setSelectedHydrant(null);
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
      setOtwHydrant(hydrant);
      if (isMobile) setSelectedHydrant(null);
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
  }, [userLocation, showGeoError, isMobile]);

  const handleRoute = useCallback(() => {
    if (!selectedHydrant) return;

    // Non-operational hydrant — confirm before entering route mode instead of
    // silently sending a responder toward a hydrant that may not work.
    if (selectedHydrant.status !== 'operational') {
      setNonOperationalConfirm(selectedHydrant);
      playHazardChime();
      return;
    }

    proceedRoute(selectedHydrant);
  }, [selectedHydrant, proceedRoute]);

  const handleConfirmNonOperationalRoute = useCallback(() => {
    if (nonOperationalConfirm) proceedRoute(nonOperationalConfirm);
    setNonOperationalConfirm(null);
  }, [nonOperationalConfirm, proceedRoute]);

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
    setNonOperationalConfirm(null);
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

  const handleTargetLocation = useCallback(() => {
    if (userLocation) {
      handleMapClick(userLocation.lat, userLocation.lng);
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
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUserLocation(loc);
      handleMapClick(loc.lat, loc.lng);
    };
    const onFinalError = (err: GeolocationPositionError) => {
      showGeoError(
        err.code === err.PERMISSION_DENIED
          ? 'Location permission is blocked. Enable it in your browser settings.'
          : err.code === err.POSITION_UNAVAILABLE
          ? 'Could not get a location fix. Try again on a device with GPS.'
          : 'Could not determine your location. Please try again.',
      );
    };
    navigator.geolocation.getCurrentPosition(onSuccess, onFinalError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    });
  }, [userLocation, handleMapClick, showGeoError]);

  // Handle nearest hydrant selection — fly map to it
  const handleNearestHydrantSelect = useCallback((hydrant: RankedHydrant | null) => {
    setNearestHydrant(hydrant);
    if (hydrant) {
      controllerRef.current?.flyTo(hydrant.lat, hydrant.lng, 17);
    }
  }, []);

  const handleMapPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only intercept touch/pen on the map layer; ignore mouse (map pans fine with mouse)
    if (e.pointerType === 'mouse') return;
    const el  = e.currentTarget;
    const pid = e.pointerId;
    mapScrollDragStartY.current = e.clientY;

    mapLongPressTimer.current = setTimeout(() => {
      if (!panelScrollRef.current) return;
      el.setPointerCapture(pid);
      mapScrollCaptureEl.current  = el;
      mapScrollCaptureId.current  = pid;
      mapScrollDragStartTop.current = panelScrollRef.current.scrollTop;
      setMapScrollMode(true);

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pid || !panelScrollRef.current) return;
        const delta = mapScrollDragStartY.current - ev.clientY; // drag up → scroll down
        panelScrollRef.current.scrollTop = mapScrollDragStartTop.current + delta;
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        setMapScrollMode(false);
        mapScrollCaptureEl.current  = null;
        mapScrollCaptureId.current  = -1;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    }, 2000);

    const cancelTimer = () => {
      if (mapLongPressTimer.current) { clearTimeout(mapLongPressTimer.current); mapLongPressTimer.current = null; }
    };
    // Cancel on pointer up / cancel. For move: only cancel if the finger drifted
    // more than 10 px (small jitter is normal on touch — don't break the hold).
    const startX = e.clientX;
    const startY = e.clientY;
    const onMoveCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) {
        cancelTimer();
        el.removeEventListener('pointermove', onMoveCancel);
      }
    };
    el.addEventListener('pointerup',     cancelTimer,    { once: true });
    el.addEventListener('pointercancel', cancelTimer,    { once: true });
    el.addEventListener('pointermove',   onMoveCancel);
  }, []);

  // Compute the off-screen edge indicator for the OTW hydrant
  const handleMapMove = useCallback(() => {
    if (!otwHydrant || !controllerRef.current) { setOtwEdgePos(null); return; }
    const pos = controllerRef.current.project(otwHydrant.lat, otwHydrant.lng);
    if (!pos) { setOtwEdgePos(null); return; }

    const { innerWidth: w, innerHeight: h } = window;
    const isOnScreen = pos.x >= 0 && pos.x <= w && pos.y >= 0 && pos.y <= h;
    if (isOnScreen) { setOtwEdgePos(null); return; }

    const cx = w / 2;
    const cy = h / 2;
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const angle = Math.atan2(dy, dx);
    const sideMargin = 56;
    // Keep indicator below the header: desktop header = 68px, mobile header+search ≈ 108px
    // Add circle radius (20px) so the circle doesn't overlap the header bar
    const topMin = (isMobile ? 108 : 68) + 20;
    const scaleX = Math.abs(dx) > 0 ? (cx - sideMargin) / Math.abs(dx) : Infinity;
    const scaleY = Math.abs(dy) > 0 ? (cy - sideMargin) / Math.abs(dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);
    const ex = cx + dx * scale;
    const ey = Math.max(topMin, cy + dy * scale);
    setOtwEdgePos({ x: ex, y: ey, angle });
  }, [otwHydrant, isMobile]);

  // Recompute when OTW hydrant changes (handleMapMove is recreated when otwHydrant changes)
  useEffect(() => { handleMapMove(); }, [handleMapMove]);

  return (
    <div className="relative h-dvh w-screen overflow-hidden">

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

      {/* Map wrapper — detects 2-second touch hold to activate panel scroll mode */}
      <div
        className="absolute inset-0"
        onPointerDown={handleMapPointerDown}
        style={{ touchAction: mapScrollMode ? 'none' : undefined }}
      >
        <MapView
          provider={provider}
          hydrants={visibleHydrants}
          selectedHydrantId={selectedHydrant?.id ?? null}
          onMapboxError={handleMapboxError}
          onMapReady={handleMapReady}
          onSelectHydrant={handleSelectHydrant}
          addHydrantMode={addHydrantMode}
          onMapClick={handleMapClick}
          onMapBackgroundClick={handleMapBackgroundClick}
          pendingPin={pendingLocation}
          is3D={is3D}
          userLocation={userLocation}
          otwHydrant={otwHydrant}
          otwRoute={otwRoute}
          nearRouteIds={nearRouteIds}
          initialCenter={mapViewport?.center}
          initialZoom={mapViewport?.zoom}
          onMapMove={handleMapMove}
        />
      </div>

      {/* Scroll-mode toast */}
      {mapScrollMode && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[2500] flex -translate-y-1/2 justify-center">
          <div className="flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 shadow-xl backdrop-blur-sm">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
            </svg>
            <span className="text-[11px] font-bold text-white">Drag to scroll panel</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="rotate-180 text-white">
              <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
            </svg>
          </div>
        </div>
      )}
      {/* OTW off-screen hydrant indicator — pulsing edge arrow when hydrant is off viewport */}
      {otwHydrant && otwEdgePos && (
        <button
          className="pointer-events-auto absolute z-[2001] focus:outline-none"
          style={{ left: otwEdgePos.x, top: otwEdgePos.y, transform: 'translate(-50%, -50%)' }}
          onClick={() => controllerRef.current?.flyTo(otwHydrant.lat, otwHydrant.lng, 16)}
          title={`Go to ${otwHydrant.name}`}
        >
          <div className="flex flex-col items-center gap-1">
            <div className="relative flex items-center justify-center">
              <span className="absolute h-10 w-10 animate-ping rounded-full bg-red-500 opacity-60" />
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-red-400 bg-red-700/90 shadow-xl backdrop-blur-sm">
                <svg
                  width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: `rotate(${otwEdgePos.angle * 180 / Math.PI}deg)` }}
                >
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </div>
            </div>
            <span className="rounded-full bg-red-900/85 px-2 py-0.5 text-[9px] font-bold text-white shadow backdrop-blur-sm">
              {otwHydrant.id}
            </span>
          </div>
        </button>
      )}

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
        onOpenAdmin={() => setShowAdminDashboard(true)}
        addHydrantMode={addHydrantMode}
        onToggleAddHydrant={handleToggleAddHydrant}
        hasPendingReports={hasPendingReports}
        onTargetLocation={handleTargetLocation}
        loading={loading}
        lastSynced={lastSynced}
        isOtw={!!otwHydrant}
        routeHazards={routeHazards}
        onSelectHazardHydrant={handleSelectHydrant}
        hazardPanelMinimized={hazardPanelMinimized}
        onHazardPanelMinimizedChange={setHazardPanelMinimized}
      />

      {/* ── Nearest Hydrant Panel — bottom-left, above map, below modals ──
          Raised further up on mobile so it clears the Mapbox attribution bar. */}
      <div style={{ position: "absolute", bottom: isMobile ? 48 : 32, left: 16, zIndex: 1100, pointerEvents: "none" }}>
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
        <div
          className="pointer-events-auto absolute left-1/2 top-[4.75rem] z-[2000] -translate-x-1/2 w-[calc(100vw-1.5rem)] sm:w-auto anim-fade-scale"
          style={isMobile ? { top: 'calc(6.5rem + env(safe-area-inset-top, 0px))' } : undefined}
        >

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
                    {formatDuration(otwMeta.durationS)}
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
                  {formatDuration(otwMeta.durationS)}
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

      {/* Connectivity toast — offline/weak signal, or a brief "back online" flash.
          Anchored bottom-center so it never covers the header, legend chips or
          OTW banner (it used to sit top-center and block those icons). */}
      {(connection === 'offline' || connection === 'weak') && (
        <div
          className="pointer-events-none absolute left-1/2 z-[2200] flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-neutral-900/90 px-4 py-2 shadow-xl backdrop-blur-sm anim-fade-scale max-w-[min(440px,92vw)]"
          style={{ bottom: `calc(${isMobile ? '5.5rem' : '1.25rem'} + env(safe-area-inset-bottom, 0px))` }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={connection === 'offline' ? '#f87171' : '#fbbf24'} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
          <span className="text-xs text-neutral-200 leading-snug">
            {connection === 'offline'
              ? 'No internet connection — showing saved hydrant locations from cache.'
              : 'Weak connection — updates may be slow. Saved hydrant locations still available.'}
          </span>
        </div>
      )}
      {showReconnected && (
        <div
          className="pointer-events-none absolute left-1/2 z-[2200] flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-neutral-900/90 px-4 py-2 shadow-xl backdrop-blur-sm anim-fade-scale max-w-[min(440px,92vw)]"
          style={{ bottom: `calc(${isMobile ? '5.5rem' : '1.25rem'} + env(safe-area-inset-bottom, 0px))` }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
          <span className="text-xs text-neutral-200 leading-snug">Back online — data is syncing.</span>
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

      {/* Non-operational route confirmation toast */}
      {nonOperationalConfirm && (
        <div className="pointer-events-auto absolute left-1/2 top-[4.25rem] z-[2100] flex -translate-x-1/2 flex-col gap-2 rounded-2xl bg-neutral-900/90 px-4 py-3 shadow-xl backdrop-blur-sm anim-fade-scale max-w-[min(420px,92vw)]">
          <div className="flex items-start gap-2.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={STATUS_META[nonOperationalConfirm.status].color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span className="text-xs text-neutral-200 leading-snug">
              <span className="font-bold" style={{ color: STATUS_META[nonOperationalConfirm.status].color }}>
                {nonOperationalConfirm.name}
              </span>{' '}
              is currently <span className="font-semibold">{STATUS_META[nonOperationalConfirm.status].legendLabel}</span>. Route to it anyway?
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setNonOperationalConfirm(null)}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmNonOperationalRoute}
              className="rounded-full bg-[#e0353b] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#c42d32]"
            >
              Route Anyway
            </button>
          </div>
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
          routeCalculating={otwHydrant?.id === selectedHydrant?.id && !otwMeta}
          scrollRef={panelScrollRef}
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
          linkedReports={reports.filter((r) => r.hydrantId === selectedHydrant.id)}
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
          onFindOnMap={(hydrantId) => {
            const target = hydrants.find((h) => h.id === hydrantId);
            if (!target) return;
            setShowOpsDashboard(false);
            handleSelectHydrant(target);
          }}
        />
      )}

      {showAdminDashboard && (
        <div className="anim-fade absolute inset-0 z-[6000] overflow-auto">
          <AdminDashboard onBack={() => setShowAdminDashboard(false)} />
        </div>
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
