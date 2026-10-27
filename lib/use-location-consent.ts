'use client';

import { useEffect, useState } from 'react';
import { consentKey, readLocationConsent, LOCATION_NOTICE_VERSION, type LocationConsentDecision, type LocationConsentRecord } from './location-consent';

export function useLocationConsent(uid: string | undefined, assignedStationId: string | null) {
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [unsavedDecline, setUnsavedDecline] = useState<LocationConsentRecord | null>(null);
  const [, refresh] = useState(0);
  const stationId = uid ? assignedStationId : null;
  const record = uid && stationId
    ? (unsavedDecline?.uid === uid && unsavedDecline.stationId === stationId
      ? unsavedDecline
      : readLocationConsent(uid, stationId))
    : null;

  useEffect(() => {
    if (!uid || !stationId) return;
    const sync = () => refresh(value => value + 1);
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [uid, stationId]);
  const current = !!uid;
  const granted = current && record?.decision === 'granted';
  const decide = (decision: LocationConsentDecision) => {
    if (!uid || !stationId) return;
    const record: LocationConsentRecord = { uid, stationId, decision, version: LOCATION_NOTICE_VERSION, decidedAt: Date.now() };
    try {
      localStorage.setItem(consentKey(uid, stationId), JSON.stringify(record));
      setUnsavedDecline(null);
      refresh(value => value + 1);
      setNoticeFor(null);
      setStorageError(false);
    } catch {
      setStorageError(true);
      if (decision === 'declined') {
        setUnsavedDecline(record);
        refresh(value => value + 1);
        setNoticeFor(null);
      }
    }
  };
  return {
    stationId, granted,
    canUseDeviceLocation: current && (!stationId || granted),
    noticeOpen: !!stationId && (!record || noticeFor === uid),
    storageError, decide,
    openNotice: () => { if (uid) setNoticeFor(uid); },
    closeNotice: () => setNoticeFor(null),
  };
}
