const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Construct the exact device-document identity accepted by Firestore rules.
 * The UID and UUID must be provided by trusted authentication and
 * persistent device-identity mechanisms, never by user input.
 */
export function incidentLocationDocumentId(uid, deviceId) {
  if (
    typeof uid !== 'string' ||
    !SAFE_UID.test(uid) ||
    typeof deviceId !== 'string' ||
    !UUID_PATTERN.test(deviceId)
  ) {
    throw new Error('invalid-location-identity');
  }

  return `${uid}_${deviceId}`;
}