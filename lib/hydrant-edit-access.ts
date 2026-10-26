export function canEditStationHydrant(viewer: {
  role: string | null; accountType: string | null; stationId: string | null; stationMembershipStatus: string;
}, station: { id: string; active: boolean; aorBarangays?: string[] } | undefined, barangay?: string) {
  if (viewer.role === 'admin' && viewer.accountType !== 'station') return true;
  if (!station?.active || station.id !== viewer.stationId || !barangay) return false;
  const eligible = viewer.accountType === 'station' || (viewer.accountType === 'person'
    && (viewer.role === 'authorized' || viewer.role === 'head') && viewer.stationMembershipStatus === 'approved');
  return eligible && !!station.aorBarangays?.includes(barangay);
}
