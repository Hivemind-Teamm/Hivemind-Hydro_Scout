/**
 * Validate the trusted incident-feed response before exposing assignments.
 * Invalid or incomplete data must never authorize location reporting.
 */
export function validateIncidentFeed(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid-incident-feed');
  }

  const incidents = value.incidents;

  if (!Array.isArray(incidents) || incidents.length > 100) {
    throw new Error('invalid-incident-feed');
  }

  const result = [];
  const ids = new Set();

  for (const item of incidents) {
    if (!item || typeof item !== 'object') {
      throw new Error('invalid-incident-feed');
    }

    const record = item;

    if (
      typeof record.id !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(record.id) ||
      ids.has(record.id) ||
      typeof record.lat !== 'number' ||
      typeof record.lng !== 'number' ||
      !Number.isFinite(record.lat) ||
      !Number.isFinite(record.lng) ||
      Math.abs(record.lat) > 90 ||
      Math.abs(record.lng) > 180
    ) {
      throw new Error('invalid-incident-feed');
    }

    ids.add(record.id);

    result.push({
      id: record.id,
      lat: record.lat,
      lng: record.lng,
    });
  }

  return result;
}