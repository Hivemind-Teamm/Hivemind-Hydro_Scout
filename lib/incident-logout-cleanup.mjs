/**
 * Complete incident-location cleanup before Firebase sign-out.
 * Pure coordinator: no Firebase, GPS, or browser APIs imported.
 */
export async function cleanupIncidentLocationBeforeLogout({
  uid,
  registry,
  getExistingDeviceId,
  deleteDeviceLocation,
}) {
  if (
    typeof uid !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(uid)
  ) {
    throw new Error('invalid-logout-identity');
  }

  if (
    !registry ||
    typeof registry.cleanup !== 'function' ||
    typeof getExistingDeviceId !== 'function' ||
    typeof deleteDeviceLocation !== 'function'
  ) {
    throw new Error('invalid-logout-dependencies');
  }

  const registeredUid = registry.registeredUid;

  if (registeredUid !== null && registeredUid !== uid) {
    throw new Error('incident-cleanup-session-mismatch');
  }

  // This waits for any in-flight write and the controller's deletion.
  if (registeredUid === uid) {
    await registry.cleanup(uid);
  }

  // A previously published document may survive a page reload.
  // The read-only lookup must never generate a fresh device UUID.
  const deviceId = getExistingDeviceId();

  if (deviceId === null) {
    if (registeredUid === uid) {
      // The active controller's authenticated cleanup already succeeded.
      return;
    }

    // No known device document: ordinary logout needs no deletion.
    // A lost historical UUID cannot be recovered by this function.
    return;
  }

  await deleteDeviceLocation(uid);
}