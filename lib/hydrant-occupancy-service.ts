
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { verifiedProfile } from './server-profile';

export class HydrantOccupancyError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'HydrantOccupancyError';
  }
}

const hydrantIdPattern = /^HYD-[0-9]{3,}$/;
const firePinIdPattern = /^[A-Za-z0-9]{20}$/;

/**
 * Claim a hydrant for an active fire incident.
 *
 * Requirements:
 * - The caller must have an authorized role.
 * - The fire incident must be active.
 * - The caller must have an active response linked to the incident.
 * - A hydrant cannot be claimed by another responder or incident.
 * - Repeated claims from the same response are idempotent.
 */
export async function claimHydrant(
  db: Firestore,
  uid: string,
  hydrantId: string,
  firePinId: string,
) {
  if (
    !hydrantIdPattern.test(hydrantId) ||
    !firePinIdPattern.test(firePinId)
  ) {
    throw new HydrantOccupancyError(
      'Invalid hydrant or incident ID.',
      400,
    );
  }

  const profile = await verifiedProfile(db, uid);

  const role =
    profile.accountType === 'station'
      ? 'head'
      : profile.role;

  if (!['authorized', 'head', 'admin'].includes(role)) {
    throw new HydrantOccupancyError(
      'Not authorized to claim hydrants.',
      403,
    );
  }

  return db.runTransaction(async (transaction) => {
    const occupancyRef = db.doc(`hydrantOccupancy/${hydrantId}`);
    const hydrantRef = db.doc(`hydrants/${hydrantId}`);
    const fireRef = db.doc(`firePins/${firePinId}`);

    const responseQuery = db
      .collection('stationResponses')
      .where('uid', '==', uid)
      .where('status', '==', 'active');

    // Read all documents before performing transaction writes.
    const [occupancy, hydrant, fire, responses] = await Promise.all([
      transaction.get(occupancyRef),
      transaction.get(hydrantRef),
      transaction.get(fireRef),
      transaction.get(responseQuery),
    ]);

    if (!hydrant.exists) {
      throw new HydrantOccupancyError(
        'Hydrant not found.',
        404,
      );
    }

    if (!fire.exists || fire.data()?.status !== 'active') {
      throw new HydrantOccupancyError(
        'Fire incident is not active.',
        409,
      );
    }

    // Find a verified active response belonging to this user
    // and associated with the selected fire incident.
    const matchingResponse = responses.docs.find((record) => {
      const response = record.data();

      if (
        response.firePinId !== firePinId ||
        response.uid !== uid
      ) {
        return false;
      }

      if (role === 'admin') {
        return true;
      }

      return (
        typeof profile.stationId === 'string' &&
        response.stationId === profile.stationId
      );
    });

    if (!matchingResponse) {
      throw new HydrantOccupancyError(
        'No verified active response for this incident.',
        403,
      );
    }

    // Do not overwrite an existing occupancy claim.
    if (occupancy.exists) {
      const current = occupancy.data();

      if (
        current?.firePinId === firePinId &&
        current?.claimedByUid === uid &&
        current?.responseId === matchingResponse.id
      ) {
        return {
          hydrantId,
          firePinId,
          responseId: matchingResponse.id,
          alreadyClaimed: true,
        };
      }

      throw new HydrantOccupancyError(
        'Hydrant is already occupied.',
        409,
      );
    }

    // A transaction ensures competing claims cannot both win.
    transaction.create(occupancyRef, {
      hydrantId,
      firePinId,
      responseId: matchingResponse.id,
      claimedByUid: uid,
      claimedAt: FieldValue.serverTimestamp(),
    });

    return {
      hydrantId,
      firePinId,
      responseId: matchingResponse.id,
      alreadyClaimed: false,
    };
  });
}

/**
 * Release a hydrant occupancy claim.
 *
 * Requirements:
 * - The caller must have an authorized role.
 * - The incident ID must match the existing claim.
 * - Only the original claimant or a verified administrator can release it.
 * - Repeated releases are handled safely.
 *
 * An active response is not required for release because the
 * responder may already have finished responding.
 */
export async function releaseHydrant(
  db: Firestore,
  uid: string,
  hydrantId: string,
  firePinId: string,
) {
  if (
    !hydrantIdPattern.test(hydrantId) ||
    !firePinIdPattern.test(firePinId)
  ) {
    throw new HydrantOccupancyError(
      'Invalid hydrant or incident ID.',
      400,
    );
  }

  const profile = await verifiedProfile(db, uid);

  const role =
    profile.accountType === 'station'
      ? 'head'
      : profile.role;

  if (!['authorized', 'head', 'admin'].includes(role)) {
    throw new HydrantOccupancyError(
      'Not authorized to release hydrants.',
      403,
    );
  }

  return db.runTransaction(async (transaction) => {
    const occupancyRef = db.doc(
      `hydrantOccupancy/${hydrantId}`,
    );

    const occupancy = await transaction.get(occupancyRef);

    if (!occupancy.exists) {
      return {
        hydrantId,
        released: false,
        alreadyAvailable: true,
      };
    }

    const current = occupancy.data();

    if (current?.firePinId !== firePinId) {
      throw new HydrantOccupancyError(
        'Hydrant belongs to a different incident.',
        409,
      );
    }

    if (
      current?.claimedByUid !== uid &&
      role !== 'admin'
    ) {
      throw new HydrantOccupancyError(
        'You cannot release another responder’s hydrant.',
        403,
      );
    }

    // Delete only the claim observed by this transaction.
    // A concurrent replacement causes the transaction to retry.
    transaction.delete(occupancyRef);

    return {
      hydrantId,
      released: true,
      alreadyAvailable: false,
    };
  });
}
