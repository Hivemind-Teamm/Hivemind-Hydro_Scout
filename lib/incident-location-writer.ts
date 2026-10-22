import {
  deleteDoc,
  doc,
  GeoPoint,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import type { LocationFix } from './incident-location-algorithm';
import { getIncidentDeviceId } from './incident-device-id';
import { incidentLocationDocumentId } from './incident-location-document-id.mjs';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_INCIDENT_ID = /^[A-Za-z0-9_-]+$/;

interface IncidentLocationWriterOptions {
  db: Firestore;
  uid: string;
  stationId: string;
  getCurrentUid: () => string | null;
}

export function createIncidentLocationWriter({
  db,
  uid,
  stationId,
  getCurrentUid,
}: IncidentLocationWriterOptions) {
  if (!SAFE_ID.test(stationId)) {
    throw new Error('invalid-location-identity');
  }

  const deviceId = getIncidentDeviceId();

  if (!deviceId) {
    throw new Error('device-identity-unavailable');
  }

  const locationId = incidentLocationDocumentId(uid, deviceId);
  const locationRef = doc(db, 'unitLocations', locationId);

  function requireOwner() {
    if (getCurrentUid() !== uid) {
      throw new Error('location-session-changed');
    }
  }

  return {
    locationId,

    async writeLocation(incidentId: string, fix: LocationFix) {
      requireOwner();

      if (!SAFE_INCIDENT_ID.test(incidentId)) {
        throw new Error('invalid-incident-id');
      }

      if (
        !Number.isFinite(fix.lat) ||
        !Number.isFinite(fix.lng) ||
        Math.abs(fix.lat) > 90 ||
        Math.abs(fix.lng) > 180 ||
        !Number.isFinite(fix.accuracy) ||
        fix.accuracy < 0 ||
        fix.accuracy > 50
      ) {
        throw new Error('invalid-location-fix');
      }

      // Recheck identity immediately before requesting the write.
      requireOwner();

      await setDoc(locationRef, {
        stationId,
        updatedBy: uid,
        incidentId,
        location: new GeoPoint(fix.lat, fix.lng),
        accuracy: fix.accuracy,
        updatedAt: serverTimestamp(),
      });
    },

    async deleteLocation() {
      // Deletion must occur while the owner is authenticated.
      // Incident assignment is deliberately NOT required for cleanup.
      requireOwner();

      await deleteDoc(locationRef);
    },
  };
}