/** Stable paths shared by clients, server code, and the non-destructive migration. */
export function stationRecordPath(stationId, kind, id) {
  if (typeof stationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(stationId)) throw new Error('Invalid station ID.');
  if (!['joinRequests', 'responses'].includes(kind)) throw new Error('Invalid station record type.');
  if (typeof id !== 'string' || !id || id.includes('/')) throw new Error('Invalid record ID.');
  return `stations/${stationId}/${kind}/${id}`;
}

export const FIRE_INCIDENT_ID_PATTERN = /^(?:[A-Za-z0-9]{20}|FIRE-[0-9]{8}-[a-f0-9]{16})$/;
export function newFireIncidentId(now = new Date(), nonce = crypto.randomUUID()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const day = `${parts.year}${parts.month}${parts.day}`;
  const suffix = nonce.replaceAll('-', '').slice(0, 16);
  if (!/^[a-f0-9]{16}$/.test(suffix)) throw new Error('Invalid incident identifier entropy.');
  return `FIRE-${day}-${suffix}`;
}
