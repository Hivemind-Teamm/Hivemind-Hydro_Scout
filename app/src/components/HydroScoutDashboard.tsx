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
import {
  HYDRANTS,
  countByStatus,
  type Hydrant,
  type HydrantStatus,
} from '../data/hydrants';

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
  const [viewingUser, setViewingUser] = useState<ViewingUser | null>(null);

  const controllerRef = useRef<MapController | null>(null);

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
    setProvider((prev) => (prev === 'mapbox' ? 'leaflet' : 'mapbox'));
  }, []);

  const handleMapReady = useCallback((controller: MapController) => {
    controllerRef.current = controller;
  }, []);

  const counts = useMemo(() => countByStatus(HYDRANTS), []);
  const visibleHydrants = useMemo(
    () => (activeStatus ? HYDRANTS.filter((h) => h.status === activeStatus) : HYDRANTS),
    [activeStatus],
  );

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

  const handleCloseSubPanel = useCallback(() => {
    setShowFullDetails(false);
    setShowEdit(false);
    setShowReport(false);
  }, []);

  const handleViewUser = useCallback((name: string, role: string) => {
    setViewingUser({ name, role });
  }, []);

  const handleOpenAccount = useCallback(() => {
    setShowAccount(true);
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
      />
      {showReports && <ReportsPanel onViewUser={handleViewUser} />}

      {/* Mini info panel — always visible when a hydrant is selected */}
      {selectedHydrant && (
        <HydrantInfoPanel
          hydrant={selectedHydrant}
          onClose={handleCloseAll}
          onOpenFullDetails={() => setShowFullDetails(true)}
          onEdit={() => setShowEdit(true)}
          onReport={() => setShowReport(true)}
        />
      )}

      {/* Sub-panels: close returns to mini panel, not away from it */}
      {selectedHydrant && showFullDetails && (
        <FullDetailsPanel
          hydrant={selectedHydrant}
          onClose={handleCloseSubPanel}
          onViewUser={handleViewUser}
        />
      )}
      {selectedHydrant && showEdit && (
        <EditStatusPanel
          hydrant={selectedHydrant}
          onClose={handleCloseSubPanel}
          onOpenAccount={handleOpenAccount}
          onSubmit={(id, status, note) => {
            console.log('Submit edit:', id, status, note);
            handleCloseSubPanel();
          }}
        />
      )}
      {selectedHydrant && showReport && (
        <DamageReportModal
          hydrant={selectedHydrant}
          onClose={handleCloseSubPanel}
          onOpenAccount={handleOpenAccount}
        />
      )}

      {/* Account Center */}
      {showAccount && (
        <AccountCenterModal onClose={() => setShowAccount(false)} />
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
