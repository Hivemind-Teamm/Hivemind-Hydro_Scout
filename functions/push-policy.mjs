/** Trusted profile policy shared by registration and delivery. */
export function canReceiveStationPush(profile, stationId) {
  if (!profile || typeof stationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(stationId)) return false;
  if (profile.accountType === 'station') return profile.stationId === stationId;
  return profile.role === 'admin'
    || (profile.role === 'head' && profile.stationId === stationId)
    || (Array.isArray(profile.stationAccessIds) && profile.stationAccessIds.includes(stationId));
}

/** Generic lock-screen text deliberately excludes names, emails and coordinates. */
export function stationPushContent(kind, type) {
  if (kind === 'members') return {
    title: 'Hydro-Scout · Member approval', body: 'A new station membership request needs review.', urgency: 'normal',
  };
  const types = {
    'response-started': ['Hydro-Scout · Response started', 'A station member has started responding. Open Hydro-Scout for details.', 'high'],
    'response-ended': ['Hydro-Scout · Response ended', 'A station response has ended. Open Hydro-Scout for details.', 'normal'],
    'station-response-closed': ['Hydro-Scout · Response closed', 'Station management closed a response. Open Hydro-Scout for details.', 'normal'],
    'personal-station-assigned': ['Hydro-Scout · Account assignment', 'A station account assignment changed. Open Hydro-Scout to review.', 'normal'],
    'membership-approved': ['Hydro-Scout · Membership update', 'A station membership request was approved.', 'normal'],
    'membership-rejected': ['Hydro-Scout · Membership update', 'A station membership request was rejected.', 'normal'],
  };
  const entry = types[type];
  return entry ? { title: entry[0], body: entry[1], urgency: entry[2] } : null;
}
