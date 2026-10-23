'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { FiActivity, FiLogOut } from 'react-icons/fi';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useStations } from '../data/stations';
import StationNotificationPanels from './StationNotificationPanels';
import type { JoinRequest } from '@/lib/use-station-notifications';
import { locationTimeoutMs } from '@/lib/unit-location-expiry';

type ResponseRecord = {
  id: string;
  uid: string;
  displayName: string;
  stationId: string;
  status: 'active' | 'ended';
  startedAt?: { toDate?: () => Date } | null;
  endedAt?: { toDate?: () => Date } | null;
  lastLocationAt?: { toDate?: () => Date } | null;
}

function currentPosition(): Promise<GeolocationPosition> {
  if (!navigator.geolocation) return Promise.reject(new Error('This device does not support location sharing.'));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, error => {
    reject(new Error(error.code === error.PERMISSION_DENIED
      ? 'Allow location access in your browser before starting a response.'
      : 'Could not get your current location. Check your GPS and try again.'));
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }));
}

export default function StationResponseControl({ hasFireIncident }: { hasFireIncident: boolean }) {
  const {
    user, role, accountType, stationId, stationMembershipStatus, stationAccessIds,
    canUseDeviceLocation, openLocationConsent,
  } = useAuth();
  const { stations } = useStations();
  const station = stations.find(item => item.id === stationId);
  const canRespond = !!user && accountType === 'person' && !!stationId && stationMembershipStatus === 'approved';
  const canManage = !!user && !!stationId && (role === 'admin' || role === 'head' || stationAccessIds.includes(stationId));
  const canApprove = role === 'admin' || role === 'head';
  const [activeResponses, setActiveResponses] = useState<ResponseRecord[]>([]);
  const [responses, setResponses] = useState<ResponseRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [openMemberApprovals, setOpenMemberApprovals] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, 'stationResponses'), where('uid', '==', user.uid), where('status', '==', 'active')), snapshot => {
      setActiveResponses(snapshot.docs.map(record => ({ id: record.id, ...record.data() } as ResponseRecord)));
    }, err => {
      console.error('Failed to load your active responses:', err);
      setError('Could not load your response status.');
    });
  }, [user]);

  useEffect(() => {
    if (!canManage || !stationId) return;
    const active = onSnapshot(query(collection(db, 'stationResponses'), where('stationId', '==', stationId)), snapshot => {
      setResponses(snapshot.docs.map(record => ({ id: record.id, ...record.data() } as ResponseRecord))
        .sort((a, b) => ((b.startedAt?.toDate?.().getTime() ?? 0) - (a.startedAt?.toDate?.().getTime() ?? 0))));
    }, err => { console.error('Failed to load station response history:', err); setError('Could not load station response history.'); });
    return () => { active(); };
  }, [canManage, stationId]);

  useEffect(() => {
    if (!canManage) return;
    const toggleActivity = () => {
      setOpenMemberApprovals(false);
      setOpen(current => !current);
    };
    window.addEventListener('hydroscout:toggle-station-activity', toggleActivity);
    return () => window.removeEventListener('hydroscout:toggle-station-activity', toggleActivity);
  }, [canManage]);

  useEffect(() => {
    if (!canApprove || !stationId) return;
    const toggleMemberApprovals = () => {
      setOpen(false);
      setOpenMemberApprovals(current => !current);
    };
    window.addEventListener('hydroscout:toggle-station-members', toggleMemberApprovals);
    return () => window.removeEventListener('hydroscout:toggle-station-members', toggleMemberApprovals);
  }, [canApprove, stationId]);

  useEffect(() => {
    const response = activeResponses[0];
    if (!response || !stationId) return;
    if (!canUseDeviceLocation) {
      void deleteDoc(doc(db, 'stations', stationId, 'unitLocations', response.id)).catch(err => {
        console.error('Could not remove the location after consent withdrawal:', err);
      });
      void deleteDoc(doc(db, 'responseLocations', response.id)).catch(err => {
        console.error('Could not remove the legacy location after consent withdrawal:', err);
      });
      return;
    }
    if (!station) return;
    let stopped = false;
    let inFlight = false;
    const refresh = async () => {
      if (stopped || inFlight || !navigator.onLine) return;
      inFlight = true;
      try {
        const position = await currentPosition();
        if (stopped) return;
        const batch = writeBatch(db);
        batch.set(doc(db, 'stations', stationId, 'unitLocations', response.id), {
          responseId: response.id,
          stationId,
          stationName: station.name,
          public: true,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          updatedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'stationResponses', response.id), { lastLocationAt: serverTimestamp() });
        await batch.commit();
      } catch (err) {
        console.warn('Active response location was not updated:', err);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 3 * 60_000);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [activeResponses, canUseDeviceLocation, station, stationId]);

  const staleAfterMs = locationTimeoutMs(process.env.NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES);

  useEffect(() => {
    if ((role !== 'head' && role !== 'admin') || !stationId || !user) return;
    const stale = responses.filter(response => response.status === 'active'
      && response.lastLocationAt?.toDate
      && Date.now() - response.lastLocationAt.toDate().getTime() > staleAfterMs);
    if (!stale.length) return;
    const batch = writeBatch(db);
    for (const response of stale) {
      batch.update(doc(db, 'stationResponses', response.id), {
        status: 'ended',
        endedAt: serverTimestamp(),
        endedByUid: user.uid,
        endedByName: user.displayName || user.email || 'Station manager',
        endReason: 'station-head',
      });
      batch.update(doc(db, 'users', response.uid), { activeResponseId: null });
      batch.delete(doc(db, 'stations', stationId, 'unitLocations', response.id));
      batch.delete(doc(db, 'responseLocations', response.id));
      batch.set(doc(db, 'stations', stationId, 'notifications', `${response.id}_closed`), {
        type: 'station-response-closed',
        uid: user.uid,
        displayName: user.displayName || user.email || 'Station manager',
        responseId: response.id,
        message: `A stale response from ${response.displayName} was closed by station management.`,
        createdAt: serverTimestamp(),
      });
    }
    void batch.commit().catch(err => {
      console.error('Could not close stale station responses:', err);
      setError('Could not close a stale response. Try again from station activity.');
    });
  }, [role, responses, staleAfterMs, stationId, user]);

  async function startResponse() {
    if (!user || !stationId || !station) return;
    setError(null);
    if (!canUseDeviceLocation) {
      openLocationConsent();
      return;
    }
    setBusy(true);
    try {
      const position = await currentPosition();
      const id = crypto.randomUUID();
      const batch = writeBatch(db);
      batch.set(doc(db, 'stationResponses', id), {
        responseId: id,
        uid: user.uid,
        displayName: user.displayName?.trim() || user.email || 'Responder',
        stationId,
        stationName: station.name,
        status: 'active',
        startedAt: serverTimestamp(),
        endedAt: null,
        lastLocationAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', user.uid), { activeResponseId: id });
      batch.set(doc(db, 'stations', stationId, 'unitLocations', id), {
        responseId: id,
        stationId,
        stationName: station.name,
        public: true,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        updatedAt: serverTimestamp(),
      });
      const notice = doc(db, 'stations', stationId, 'notifications', `${id}_start`);
      batch.set(notice, {
        type: 'response-started',
        uid: user.uid,
        displayName: user.displayName?.trim() || user.email || 'Responder',
        responseId: id,
        message: `${user.displayName?.trim() || user.email || 'A member'} started responding.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      console.error('Could not start response:', err);
      setError(err instanceof Error ? err.message : 'Could not start the response.');
    } finally {
      setBusy(false);
    }
  }

  async function endResponse(response: ResponseRecord) {
    if (!user || !stationId) return;
    setError(null);
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'stationResponses', response.id), {
        status: 'ended',
        endedAt: serverTimestamp(),
        endedByUid: user.uid,
        endedByName: user.displayName?.trim() || user.email || 'Responder',
        endReason: 'member',
      });
      batch.update(doc(db, 'users', user.uid), { activeResponseId: null });
      batch.delete(doc(db, 'stations', stationId, 'unitLocations', response.id));
      batch.delete(doc(db, 'responseLocations', response.id));
      const notice = doc(db, 'stations', stationId, 'notifications', `${response.id}_end`);
      batch.set(notice, {
        type: 'response-ended',
        uid: user.uid,
        displayName: user.displayName?.trim() || user.email || 'Responder',
        responseId: response.id,
        message: `${user.displayName?.trim() || user.email || 'A member'} ended responding.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      console.error('Could not end response:', err);
      setError(err instanceof Error ? err.message : 'Could not end the response.');
    } finally {
      setBusy(false);
    }
  }

  async function reviewRequest(request: JoinRequest, approved: boolean) {
    if (!stationId) return;
    setError(null);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'stationJoinRequests', request.id), { status: approved ? 'approved' : 'rejected', reviewedAt: serverTimestamp(), reviewedBy: user?.uid });
      batch.update(doc(db, 'users', request.uid), {
        stationMembershipStatus: approved ? 'approved' : 'rejected',
        stationId: approved ? stationId : null,
        station: approved ? (station?.name ?? stationId) : 'Unassigned',
        requestedStationId: null,
      });
      const notice = doc(db, 'stations', stationId, 'notifications', `join-review-${request.uid}-${approved ? 'approved' : 'rejected'}`);
      batch.set(notice, {
        type: approved ? 'membership-approved' : 'membership-rejected',
        uid: request.uid,
        displayName: request.displayName,
        message: `${request.displayName}’s station membership request was ${approved ? 'approved' : 'rejected'}.`,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      console.error('Could not review station membership:', err);
      setError(err instanceof Error ? err.message : 'Could not review the station request.');
    }
  }

  if (!user) return null;
  const hasPendingStationRequest = stationMembershipStatus === 'pending';
  const canShowResponseAction = canRespond && (activeResponses.length > 0 || hasFireIncident);
  if (!canShowResponseAction && !canManage && !hasPendingStationRequest) return null;

  return (
    <>
      {(canShowResponseAction || hasPendingStationRequest || error) && <div className="pointer-events-auto absolute bottom-[calc(6.5rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[2500] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl bg-white/95 p-2 shadow-xl backdrop-blur dark:bg-neutral-900/95">
        {canShowResponseAction && (activeResponses.length > 0 ? (
          <button disabled={busy} onClick={() => void endResponse(activeResponses[0])} className="flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
            <FiLogOut /> End response
          </button>
        ) : (
          <button disabled={busy} onClick={() => void startResponse()} className="flex items-center gap-2 rounded-lg bg-[#e0353b] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
            <FiActivity /> {busy ? 'Starting…' : 'Start responding'}
          </button>
        ))}
        {hasPendingStationRequest && <span className="px-2 text-xs font-semibold text-amber-700">Station request pending approval</span>}
        {error && <span role="alert" className="max-w-56 text-xs text-red-600">{error}</span>}
      </div>}
      <StationNotificationPanels key={user.uid + ':' + stationId} stationName={station?.name ?? stationId ?? 'Station'}
        activityOpen={open && canManage} membersOpen={openMemberApprovals && canApprove}
        closeActivity={() => setOpen(false)} closeMembers={() => setOpenMemberApprovals(false)}
        reviewRequest={reviewRequest} />
    </>
  );
}
