/** Alert only on unseen, server-confirmed additions after the initial baseline. */
export function firePinArrivalTracker() {
  let initialized = false;
  const seen = new Set<string>();
  return (records: { id: string; pending: boolean }[], fromCache: boolean, local: Set<string>) => {
    if (fromCache) return [];
    const arrivals = initialized ? records.filter(record => !seen.has(record.id) && !record.pending && !local.has(record.id)).map(record => record.id) : [];
    for (const record of records) seen.add(record.id);
    initialized = true;
    return arrivals;
  };
}

export const FIRE_ARRIVAL_DURATION_MS = 1600;
