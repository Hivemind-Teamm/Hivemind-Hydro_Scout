'use client';
import { useAuth } from './auth-context';
import { useStations } from '@/app/src/data/stations';
import { canEditStationHydrant } from './hydrant-edit-access';

export function useHydrantEditAccess(barangay?: string) {
  const viewer = useAuth();
  const { stations, error } = useStations();
  return !!viewer.user && !viewer.loading && (!error || viewer.role === 'admin')
    && canEditStationHydrant(viewer, stations.find(station => station.id === viewer.stationId), barangay);
}
