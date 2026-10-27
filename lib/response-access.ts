export function canStartStationResponse(viewer: { role: string | null; accountType: string | null; stationId: string | null; stationMembershipStatus: string }) {
  return viewer.accountType === 'person' && (viewer.role === 'authorized' || viewer.role === 'head')
    && !!viewer.stationId && viewer.stationMembershipStatus === 'approved';
}
