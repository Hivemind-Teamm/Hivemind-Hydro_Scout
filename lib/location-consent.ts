export const LOCATION_NOTICE_VERSION = '2026-10-09-v2';
export type LocationConsentDecision = 'granted' | 'declined';
export interface LocationConsentRecord {
  version: string;
  uid: string;
  stationId: string;
  decision: LocationConsentDecision;
  decidedAt: number;
}
export function consentKey(uid: string, stationId: string) {
  return `hydroscout-location-consent:${uid}:${stationId}`;
}
export function parseLocationConsent(raw: string | null, uid: string, stationId: string): LocationConsentRecord | null {
  try {
    const value = JSON.parse(raw ?? 'null') as LocationConsentRecord | null;
    return value && value.version === LOCATION_NOTICE_VERSION && value.uid === uid && value.stationId === stationId
      && (value.decision === 'granted' || value.decision === 'declined')
      && Number.isFinite(value.decidedAt) && value.decidedAt > 0 ? value : null;
  } catch { return null; }
}

export function readLocationConsent(uid: string, stationId: string) {
  try { return parseLocationConsent(localStorage.getItem(consentKey(uid, stationId)), uid, stationId); }
  catch { return null; }
}
