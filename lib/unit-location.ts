/**
 * Legacy import compatibility for station identity validation.
 *
 * Login-based and periodic GPS reporting have been retired.
 * Incident-only tracking is implemented separately.
 */
export {
  stationIdForLocation,
  type StationProfile,
} from './station-location-identity';
