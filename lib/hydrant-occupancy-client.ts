'use client';

/** Error from the hydrant occupancy API; `status` is 0 when the request never reached it. */
export class HydrantOccupancyRequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'HydrantOccupancyRequestError';
  }
}

/**
 * Claim or release a hydrant for a fire incident through the verified server
 * API. The result appears through the live `hydrantOccupancy` listener, so
 * callers should not mark a hydrant claimed or free on their own.
 */
export async function requestHydrantOccupancy(
  action: 'claim' | 'release',
  hydrantId: string,
  firePinId: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/hydrant-occupancy/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hydrantId, firePinId }),
    });
  } catch {
    throw new HydrantOccupancyRequestError(`Could not ${action} hydrant. Check your connection.`, 0);
  }
  const result: { error?: string } = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HydrantOccupancyRequestError(result.error || `Could not ${action} hydrant.`, response.status);
  }
}
