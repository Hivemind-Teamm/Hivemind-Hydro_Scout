import {
  deleteDoc,
  doc,
  type Firestore,
} from 'firebase/firestore';
import { getExistingIncidentDeviceId } from './incident-device-id';
import { incidentLocationDocumentId } from './incident-location-document-id.mjs';

interface IncidentDeviceCleanupOptions {
  db: Firestore;
  uid: string;
  getCurrentUid: () => string | null;
}

/**
 * Delete this browser device's incident-location document.
 *
 * Can operate after a reload without a mounted GPS controller.
 * Requires a persistent device UUID and an authenticated owner.
 *
 * Must be called before Firebase sign-out.
 */
export async function deleteIncidentDeviceLocation({
  db,
  uid,
  getCurrentUid,
}: IncidentDeviceCleanupOptions): Promise<void> {
  if (getCurrentUid() !== uid) {
    throw new Error('location-session-changed');
  }

  const deviceId = getExistingIncidentDeviceId();

  if (!deviceId) {
    // Never assume that an unknown device ID means cleanup succeeded.
    throw new Error('device-identity-unavailable');
  }

  const locationId = incidentLocationDocumentId(uid, deviceId);

  // Check authentication again immediately before initiating deletion.
  if (getCurrentUid() !== uid) {
    throw new Error('location-session-changed');
  }

  await deleteDoc(doc(db, 'unitLocations', locationId));
}