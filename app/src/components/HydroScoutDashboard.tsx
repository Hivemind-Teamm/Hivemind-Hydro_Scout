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

export default function HydroScoutDashboard() {
  const [provider, setProvider] = useState<MapProvider>('mapbox');
  const [autoFallback, setAutoFallback] = useState(false);
  const [userOverride, setUserOverride] = useState(false);
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
  const [viewingUser, setViewingUser] = useState<ViewingUser | null>(null);

  const controllerRef = useRef<MapController | null>(null);

  const { role } = useAuth();
  const { hydrants, loading, error } = useHydrants();
  const { reports, loading: reportsLoading } = useReports();
  const hasPendingReports = reports.some((r) => r.status === 'pending');

  useEffect(() => {
    console.log('[mapbox token]', process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
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
    setProvider((prev) => (prev === 'mapbox' ? 'leaflet' : 'mapbox'));
  }, []);

  const handleMapReady = useCallback((controller: MapController) => {
    controllerRef.current = controller;
  }, []);

  const counts = useMemo(() => countByStatus(hydrants), [hydrants]);
  const visibleHydrants = useMemo(
    () => (activeStatus ? hydrants.filter((h) => h.status === activeStatus) : hydrants),
    [activeStatus, hydrants],
  );

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
    controllerRef.current?.flyTo(hydrant.lat, hydrant.lng, 17);
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
        pendingPin={pendingLocation}
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
        showReports={showReports}
        onToggleReports={() => setShowReports((v) => !v)}
        onOpenAccount={handleOpenAccount}
        onOpenDashboard={() => setShowOpsDashboard(true)}
        addHydrantMode={addHydrantMode}
        onToggleAddHydrant={handleToggleAddHydrant}
        hasPendingReports={hasPendingReports}
      />

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
           onOpenFullDetails={() => setShowFullDetails(true)}
           onEdit={() => setShowEdit(true)}
           onReport={() => setShowReport(true)}
           onFlyTo={(lat, lng) => controllerRef.current?.flyTo(lat, lng, 17)}
         />
       )}

{/* Sub-panels: each closes only itself, mini panel and siblings stay */}
       {selectedHydrant && showFullDetails && !showEdit && (
         <FullDetailsPanel
           hydrant={selectedHydrant}
           onClose={handleCloseFullDetails}
           onViewUser={handleViewUser}
           onFlyTo={(lat, lng) => controllerRef.current?.flyTo(lat, lng, 17)}
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
