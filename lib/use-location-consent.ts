'use client';

import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { stationIdForLocation } from './unit-location';
import { consentKey, readLocationConsent, LOCATION_NOTICE_VERSION, type LocationConsentDecision, type LocationConsentRecord } from './location-consent';

export function useLocationConsent(uid: string | undefined) {
  const [state, setState] = useState<{ uid?: string; ready: boolean; stationId: string | null; record: LocationConsentRecord | null }>({ ready: false, stationId: null, record: null });
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const unsavedDecline = useRef<LocationConsentRecord | null>(null);
  useEffect(() => {
    if (!uid) return;
    let stationId: string | null = null;
    const recordFor = (id: string) => unsavedDecline.current?.uid === uid && unsavedDecline.current.stationId === id
      ? unsavedDecline.current : readLocationConsent(uid, id);
    const stop = onSnapshot(doc(db, 'users', uid), snapshot => {
      stationId = stationIdForLocation(snapshot.data());
      setState({ uid, ready: true, stationId, record: stationId ? recordFor(stationId) : null });
    }, error => {
      console.warn('Could not load location privacy profile', error);
      setState({ uid, ready: false, stationId: null, record: null });
    });
    const sync = () => {
      if (stationId) setState({ uid, ready: true, stationId, record: recordFor(stationId) });
    };
    window.addEventListener('storage', sync);
    return () => { stop(); window.removeEventListener('storage', sync); };
  }, [uid]);
  const current = state.uid === uid && !!uid;
  const stationId = current ? state.stationId : null;
  const granted = current && state.record?.decision === 'granted';
  const decide = (decision: LocationConsentDecision) => {
    if (!uid || !stationId) return;
    const record: LocationConsentRecord = { uid, stationId, decision, version: LOCATION_NOTICE_VERSION, decidedAt: Date.now() };
    try {
      localStorage.setItem(consentKey(uid, stationId), JSON.stringify(record));
      unsavedDecline.current = null;
      setState({ uid, ready: true, stationId, record });
      setNoticeFor(null);
      setStorageError(false);
    } catch {
      setStorageError(true);
      if (decision === 'declined') {
        unsavedDecline.current = record;
        setState({ uid, ready: true, stationId, record });
        setNoticeFor(null);
      }
    }
  };
  return {
    stationId, granted,
    canUseDeviceLocation: current && state.ready && (!stationId || granted),
    noticeOpen: !!stationId && (!state.record || noticeFor === uid),
    storageError, decide,
    openNotice: () => { if (uid) setNoticeFor(uid); },
    closeNotice: () => setNoticeFor(null),
  };
}
