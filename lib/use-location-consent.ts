'use client';

import { useEffect, useState } from 'react';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { consentScopeForResponse } from './unit-location';
import { usePrivacyGovernance } from './privacy-governance';
import {
  consentKey,
  readLocationConsent,
  LOCATION_NOTICE_VERSION,
  type LocationConsentDecision,
  type LocationConsentRecord,
} from './location-consent';

interface ProfileState {
  uid?: string;
  ready: boolean;
  stationId: string | null;
}

interface ServerConsentState {
  uid?: string;
  stationId: string | null;
  verified: boolean;
  decision: LocationConsentDecision | null;
  noticeVersion: string | null;
  governanceUpdatedAt: Timestamp | null;
}

interface WriteState {
  uid: string;
  stationId: string;
  decision: LocationConsentDecision;
  phase: 'pending' | 'confirmed' | 'failed';
  id: number;
}

// A decision stored in the browser is not server authorization.
// Only a verified Firestore consent record can authorize GPS sharing.
let nextWriteId = 0;

// Temporary operational setting: retain explicit, server-recorded consent but
// do not require an administrator-published controller/contact document before
// a responder can enable location sharing.
export const LOCATION_GOVERNANCE_REQUIRED = false;

export function useLocationConsent(uid: string | undefined) {
  const governance = usePrivacyGovernance();

  const [profile, setProfile] = useState<ProfileState>({
    ready: false,
    stationId: null,
  });

  const [serverConsent, setServerConsent] = useState<ServerConsentState>({
    stationId: null,
    verified: false,
    decision: null,
    noticeVersion: null,
    governanceUpdatedAt: null,
  });

  const [localDecision, setLocalDecision] =
    useState<LocationConsentRecord | null>(null);

  const [writeState, setWriteState] =
    useState<WriteState | null>(null);

  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    if (!uid) return;

    return onSnapshot(
      doc(db, 'users', uid),
      snapshot => {
        setProfile({
          uid,
          ready: true,
          stationId: consentScopeForResponse(snapshot.data()),
        });
      },
      error => {
        console.warn('Could not load location privacy profile', error);

        setProfile({
          uid,
          ready: false,
          stationId: null,
        });
      },
    );
  }, [uid]);

  const current = !!uid && profile.uid === uid;
  const stationId = current ? profile.stationId : null;

  useEffect(() => {
    if (!uid || !stationId) return;

    const syncLocalDecision = () => {
      setLocalDecision(readLocationConsent(uid, stationId));
    };

    syncLocalDecision();
    window.addEventListener('storage', syncLocalDecision);

    return () => {
      window.removeEventListener('storage', syncLocalDecision);
    };
  }, [uid, stationId]);

  useEffect(() => {
    if (!uid || !stationId) return;

    return onSnapshot(
      doc(db, 'users', uid, 'locationConsents', stationId),
      { includeMetadataChanges: true },
      snapshot => {
        const data = snapshot.data();

        const decision =
          data?.decision === 'granted' || data?.decision === 'declined'
            ? data.decision
            : null;

        const validIdentity =
          data?.uid === uid &&
          data?.stationId === stationId;

        setServerConsent({
          uid,
          stationId,
          verified:
            !snapshot.metadata.fromCache &&
            !snapshot.metadata.hasPendingWrites,
          decision: validIdentity ? decision : null,
          noticeVersion:
            validIdentity && typeof data?.noticeVersion === 'string'
              ? data.noticeVersion
              : null,
          governanceUpdatedAt:
            validIdentity && data?.governanceUpdatedAt instanceof Timestamp
              ? data.governanceUpdatedAt
              : null,
        });
      },
      error => {
        console.warn('Could not verify server location consent', error);

        setServerConsent({
          uid,
          stationId,
          verified: false,
          decision: null,
          noticeVersion: null,
          governanceUpdatedAt: null,
        });

        setStorageError(true);
      },
    );
  }, [uid, stationId]);

  const verifiedRevision =
    !governance.loading &&
    !governance.error &&
    governance.configured
      ? governance.revision
      : null;

  const publishedAt =
    verifiedRevision && governance.publishedAt
      ? governance.publishedAt
      : null;

  const matchingServerConsent =
    !!uid &&
    !!stationId &&
    serverConsent.uid === uid &&
    serverConsent.stationId === stationId &&
    serverConsent.verified &&
    serverConsent.noticeVersion === LOCATION_NOTICE_VERSION &&
    (
      !LOCATION_GOVERNANCE_REQUIRED ||
      (
        publishedAt !== null &&
        serverConsent.governanceUpdatedAt !== null &&
        serverConsent.governanceUpdatedAt.isEqual(publishedAt)
      )
    );

  const scopedLocalDecision =
    localDecision?.uid === uid &&
    localDecision?.stationId === stationId
      ? localDecision
      : null;

  // Local refusal takes effect without waiting for a server write.
  // A local withdrawal remains effective even if the governance
  // revision becomes unavailable and later returns. Only an explicit
  // new choice can clear the local refusal.
  const locallyDeclined =
    scopedLocalDecision?.decision === 'declined' &&
    scopedLocalDecision.version === LOCATION_NOTICE_VERSION;

  const currentWrite =
    writeState?.uid === uid &&
    writeState?.stationId === stationId
      ? writeState
      : null;

  // Do not enable sharing from an older server grant while a new
  // local decision is still awaiting acknowledgment.
  const blockedByWrite =
    currentWrite?.phase === 'pending' ||
    (
      currentWrite?.decision === 'granted' &&
      currentWrite.phase === 'failed'
    );

  const granted =
    current &&
    profile.ready &&
    matchingServerConsent &&
    serverConsent.decision === 'granted' &&
    !locallyDeclined &&
    !blockedByWrite;

  const hasCurrentDecision =
    matchingServerConsent &&
    (
      serverConsent.decision === 'granted' ||
      serverConsent.decision === 'declined'
    );

  const localDeclineForNotice =
    locallyDeclined &&
    scopedLocalDecision?.version === LOCATION_NOTICE_VERSION;

  function decide(decision: LocationConsentDecision) {
    if (!uid || !stationId || !current || !profile.ready) return;

    if (
      decision === 'granted' &&
      LOCATION_GOVERNANCE_REQUIRED &&
      (!verifiedRevision || !publishedAt)
    ) {
      return;
    }

    const decidedUid = uid;
    const decidedStationId = stationId;

    const nextRecord: LocationConsentRecord = {
      uid: decidedUid,
      stationId: decidedStationId,
      decision,
      version: LOCATION_NOTICE_VERSION,
      decidedAt: Date.now(),
      ...(verifiedRevision
        ? { governanceRevision: verifiedRevision }
        : {}),
    };

    // Immediately apply the decision to the current browser.
    setLocalDecision(nextRecord);
    setNoticeFor(null);
    setStorageError(false);

    try {
      localStorage.setItem(
        consentKey(decidedUid, decidedStationId),
        JSON.stringify(nextRecord),
      );
    } catch {
      // Server authorization never depends on browser storage.
      setStorageError(true);
    }

    const id = ++nextWriteId;

    setWriteState({
      uid: decidedUid,
      stationId: decidedStationId,
      decision,
      phase: 'pending',
      id,
    });

    // A decline can be recorded even while the published privacy
    // document is unavailable. Grants require a verified revision.
    const governanceUpdatedAt =
      publishedAt ?? Timestamp.fromMillis(0);

    void (async () => {
      try {
        await setDoc(
          doc(
            db,
            'users',
            decidedUid,
            'locationConsents',
            decidedStationId,
          ),
          {
            uid: decidedUid,
            stationId: decidedStationId,
            decision,
            noticeVersion: LOCATION_NOTICE_VERSION,
            governanceUpdatedAt,
            updatedAt: serverTimestamp(),
          },
        );

        setWriteState(previous =>
          previous?.id === id
            ? { ...previous, phase: 'confirmed' }
            : previous,
        );
      } catch (error) {
        console.warn('Could not save server location consent', error);

        setWriteState(previous =>
          previous?.id === id
            ? { ...previous, phase: 'failed' }
            : previous,
        );

        setStorageError(true);
      }
    })();
  }

  return {
    stationId,
    granted,
    governanceRevision: verifiedRevision,

    // Preserve the existing non-station map behavior.
    // Station-linked sharing requires a confirmed server grant.
    canUseDeviceLocation:
      current &&
      profile.ready &&
      (!stationId || granted),

    noticeOpen:
      !!stationId &&
      (
        noticeFor === uid ||
        (currentWrite?.decision === 'granted' &&
          (currentWrite.phase === 'pending' ||
            currentWrite.phase === 'failed')) ||
        (!hasCurrentDecision && !localDeclineForNotice)
      ),

    savingConsent:
      currentWrite?.decision === 'granted' &&
      currentWrite.phase === 'pending',
    storageError,
    decide,
    openNotice: () => {
      if (uid) setNoticeFor(uid);
    },
    closeNotice: () => setNoticeFor(null),
  };
}
