
import {
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore';

import { verifiedProfile } from './server-profile';
import { locationTimeoutMs } from './unit-location-expiry';

import {
  readResponseHydrantClaims,
  releaseResponseHydrantClaims,
} from './response-hydrant-cleanup';

export class EndStationResponseError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'EndStationResponseError';
  }
}

export type ResponseEndMode = 'member' | 'station-head';

const responseIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/**
 * End an individual station response.
 *
 * Authorization:
 * - Members can end only their own responses.
 * - Station heads can close stale responses at their station.
 * - Administrators can close stale responses across stations.
 *
 * Cleanup:
 * - End the station response.
 * - Clear the matching active response pointer.
 * - Delete response location records.
 * - Create the appropriate station notification.
 * - Release hydrants claimed by this exact response.
 *
 * All changes happen in a single Firestore transaction.
 */
export async function endStationResponse(
  db: Firestore,
  uid: string,
  responseId: string,
  mode: ResponseEndMode,
) {
  // --------------------------------------------------
  // VALIDATE REQUEST
  // --------------------------------------------------

  if (!responseIdPattern.test(responseId)) {
    throw new EndStationResponseError(
      'Invalid response ID.',
      400,
    );
  }

  if (mode !== 'member' && mode !== 'station-head') {
    throw new EndStationResponseError(
      'Invalid response-ending mode.',
      400,
    );
  }

  // --------------------------------------------------
  // VERIFY USER
  // --------------------------------------------------

  const profile = await verifiedProfile(db, uid);

  const role =
    profile.accountType === 'station'
      ? 'head'
      : profile.role;

  const displayName =
    typeof profile.displayName === 'string' &&
    profile.displayName.trim()
      ? profile.displayName.trim()
      : 'Responder';

  // --------------------------------------------------
  // START TRANSACTION
  // --------------------------------------------------

  return db.runTransaction(async transaction => {
    const responseRef = db.doc(
      `stationResponses/${responseId}`,
    );

    const responseSnapshot = await transaction.get(
      responseRef,
    );

    if (!responseSnapshot.exists) {
      throw new EndStationResponseError(
        'Response not found.',
        404,
      );
    }

    const response = responseSnapshot.data()!;

    // --------------------------------------------------
    // VALIDATE RESPONSE RECORD
    // --------------------------------------------------

    if (
      typeof response.uid !== 'string' ||
      !response.uid ||
      typeof response.stationId !== 'string' ||
      !response.stationId
    ) {
      throw new EndStationResponseError(
        'Invalid station response record.',
        409,
      );
    }

    // --------------------------------------------------
    // VERIFY AUTHORIZATION BEFORE RETURNING STATUS
    // --------------------------------------------------

    if (mode === 'member') {
      // A responder can end only their own response.
      if (response.uid !== uid) {
        throw new EndStationResponseError(
          'You cannot end another responder’s response.',
          403,
        );
      }
    } else {
      // Station management authorization.
      const isAdmin = role === 'admin';

      const canManageStation =
        role === 'head' &&
        (
          profile.stationId === response.stationId ||
          (
            Array.isArray(profile.stationAccessIds) &&
            profile.stationAccessIds.includes(
              response.stationId,
            )
          )
        );

      if (!isAdmin && !canManageStation) {
        throw new EndStationResponseError(
          'Not authorized to close this station response.',
          403,
        );
      }
    }

    // --------------------------------------------------
    // HANDLE ALREADY-ENDED RESPONSES
    // --------------------------------------------------

    // Authorization has already been checked.
    // Repeated requests must not create new notifications
    // or affect other responders' hydrant claims.
    if (response.status === 'ended') {
      return {
        responseId,
        alreadyEnded: true,
        releasedHydrants: 0,
      };
    }

    if (response.status !== 'active') {
      throw new EndStationResponseError(
        'Invalid station response status.',
        409,
      );
    }

    // --------------------------------------------------
    // VERIFY STALE RESPONSE FOR STATION MANAGEMENT
    // --------------------------------------------------

    if (mode === 'station-head') {
      // Only genuinely stale active responses can be
      // automatically closed by station management.
      const lastLocationAt = response.lastLocationAt;

      if (
        !lastLocationAt ||
        typeof lastLocationAt.toMillis !== 'function'
      ) {
        throw new EndStationResponseError(
          'Response has no valid location timestamp.',
          409,
        );
      }

      const staleAfterMs = locationTimeoutMs(
        process.env.NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES,
      );

      const elapsed =
        Date.now() - lastLocationAt.toMillis();

      if (elapsed <= staleAfterMs) {
        throw new EndStationResponseError(
          'Response is not stale.',
          409,
        );
      }
    }

    // --------------------------------------------------
    // READ RESPONSE DATA BEFORE TRANSACTION WRITES
    // --------------------------------------------------

    const responderRef = db.doc(
      `users/${response.uid}`,
    );

    const [responderSnapshot, hydrantClaims] =
      await Promise.all([
        transaction.get(responderRef),

        readResponseHydrantClaims(
          db,
          transaction,
          responseId,
        ),
      ]);

    // --------------------------------------------------
    // END RESPONSE
    // --------------------------------------------------

    const now = FieldValue.serverTimestamp();

    const isManagerClosure =
      mode === 'station-head';

    const endReason = isManagerClosure
      ? 'station-head'
      : 'member';

    transaction.update(responseRef, {
      status: 'ended',
      endedAt: now,
      endedByUid: uid,
      endedByName: displayName,
      endReason,
    });

    // --------------------------------------------------
    // CLEAR ACTIVE RESPONSE POINTER
    // --------------------------------------------------

    // Only clear the pointer if it still refers to
    // the response being ended.
    //
    // Never erase a newer response assignment.
    if (
      responderSnapshot.exists &&
      responderSnapshot.data()?.activeResponseId === responseId
    ) {
      transaction.update(responderRef, {
        activeResponseId: null,
      });
    }

    // --------------------------------------------------
    // DELETE RESPONSE LOCATIONS
    // --------------------------------------------------

    transaction.delete(
      db.doc(
        `stations/${response.stationId}/unitLocations/${responseId}`,
      ),
    );

    transaction.delete(
      db.doc(`responseLocations/${responseId}`),
    );

    // --------------------------------------------------
    // CREATE STATION NOTIFICATION
    // --------------------------------------------------

    const noticeId = isManagerClosure
      ? `${responseId}_closed`
      : `${responseId}_end`;

    const noticeType = isManagerClosure
      ? 'station-response-closed'
      : 'response-ended';

    const responderName =
      typeof response.displayName === 'string' &&
      response.displayName.trim()
        ? response.displayName.trim()
        : 'A responder';

    const message = isManagerClosure
      ? `A stale response from ${responderName} was closed by station management.`
      : `${responderName} ended responding.`;

    transaction.set(
      db.doc(
        `stations/${response.stationId}/notifications/${noticeId}`,
      ),
      {
        type: noticeType,
        uid,
        displayName,
        responseId,
        message,
        createdAt: now,
      },
    );

    // --------------------------------------------------
    // RELEASE HYDRANT OCCUPANCY CLAIMS
    // --------------------------------------------------

    // Delete only claims associated with this exact
    // response ID.
    //
    // Other responders and incidents are unaffected.
    const releasedHydrants =
      releaseResponseHydrantClaims(
        transaction,
        hydrantClaims,
      );

    // --------------------------------------------------
    // RETURN RESULT
    // --------------------------------------------------

    return {
      responseId,
      alreadyEnded: false,
      releasedHydrants,
    };
  });
}
