'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { FiActivity, FiEye, FiEyeOff, FiLogOut } from 'react-icons/fi';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useStations } from '../data/stations';
import StationNotificationPanels from './StationNotificationPanels';
import StationMembersPanel from './StationMembersPanel';
import type { JoinRequest } from '@/lib/use-station-notifications';
import { locationTimeoutMs } from '@/lib/unit-location-expiry';
import { formatDistance, haversineM } from '@/lib/haversine';
import { INITIAL_SHARING_STATE, planResponseSharing, RESPONSE_VISIBILITY_RADIUS_M } from '@/lib/response-visibility';
import {
  forgetResponseSharing,
  primeResponseSharing,
  readResponsePosition,
  responseMarker,
  useResponseLocationSharing,
  useResponseVisibility,
  type ResponseVisibility,
} from '@/lib/use-response-location-sharing';

type ResponseRecord = {
  firePinId?: string;
  incidentLat?: number;
  incidentLng?: number;
  id: string;
  uid: string;
  displayName: string;
  stationId: string;
  status: 'active' | 'ended';
  startedAt?: { toDate?: () => Date } | null;
  endedAt?: { toDate?: () => Date } | null;
  lastLocationAt?: { toDate?: () => Date } | null;
}

const ADMIN_RESPONSE_STATION_ID = 'SYSTEM_ADMIN';
const ADMIN_RESPONSE_STATION_NAME = 'System Administration';

type ResponseEndMode = 'member' | 'station-head';

async function requestEndResponse(responseId: string, mode: ResponseEndMode): Promise<void> {
  const response = await fetch('/api/station-responses/end', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ responseId, mode }),
  });

  const result: { error?: string } | null = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || 'Could not end the response. Please try again.');
  }
}

const VISIBILITY_RADIUS_LABEL = `${RESPONSE_VISIBILITY_RADIUS_M / 1000} km`;

function visibilityText(visibility: ResponseVisibility): string {
  const away = visibility.distanceM === null ? '' : ` · ${formatDistance(visibility.distanceM)} from fire`;
  switch (visibility.phase) {
    case 'visible': return `Others can see you${away}`;
    case 'hidden': return `Hidden until within ${VISIBILITY_RADIUS_LABEL}${away}`;
    case 'paused': return 'Location sharing is off · others can’t see you';
    case 'unavailable': return 'Can’t get your location right now';
    default: return 'Finding your location…';
  }
}

export default function StationResponseControl({ fireIncident, firePins, actionContainer, statusContainer, onViewFireLocation }: {
  fireIncident: { id: string; lat: number; lng: number; stationId: string | null } | null;
  /** Active shared fires, so the location check follows a moved pin. */
  firePins: readonly { id: string; lat: number; lng: number }[];
  actionContainer: HTMLDivElement | null;
  statusContainer: HTMLDivElement | null;
  onViewFireLocation: (lat: number, lng: number) => void;
}) {
  const {
    user, role, accountType, stationId, stationMembershipStatus,
    canUseDeviceLocation, openLocationConsent,
  } = useAuth();
  const { stations } = useStations();
  const isGlobalAdmin = role === 'admin';
  const isPersonalAdmin = isGlobalAdmin && accountType !== 'station';
  const assignedStation = stations.find(item => item.id === stationId);
  const canRespond = !!user && (isPersonalAdmin || (accountType === 'person' && !!stationId && stationMembershipStatus === 'approved'));
  const canViewRoster = isGlobalAdmin || (role === 'head' && !!stationId);
  const canApprove = role === 'head' && !!stationId && accountType !== 'station';
  const [activeResponses, setActiveResponses] = useState<ResponseRecord[]>([]);
  const activeResponseStationId = activeResponses[0]?.stationId ?? null;
  const activeResponseStation = stations.find(item => item.id === activeResponseStationId);
  const [responses, setResponses] = useState<ResponseRecord[]>([]);
  const [responseStation, setResponseStation] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [openMemberApprovals, setOpenMemberApprovals] = useState(false);
  const [openRoster, setOpenRoster] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staleClosuresInFlight = useRef(new Set<string>());

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
    if (!canViewRoster || (!isGlobalAdmin && !stationId)) return;
    const responseQuery = isGlobalAdmin
      ? query(collection(db, 'stationResponses'), where('status', '==', 'active'))
      : query(collection(db, 'stationResponses'), where('stationId', '==', stationId));
    const active = onSnapshot(responseQuery, snapshot => {
      setResponseStation(isGlobalAdmin ? 'all-stations' : stationId);
      setResponses(snapshot.docs.map(record => ({ id: record.id, ...record.data() } as ResponseRecord))
        .sort((a, b) => ((b.startedAt?.toDate?.().getTime() ?? 0) - (a.startedAt?.toDate?.().getTime() ?? 0))));
    }, err => { setResponseStation(null); console.error('Failed to load station response history:', err); setError('Could not load station response history.'); });
    return () => { active(); };
  }, [canViewRoster, isGlobalAdmin, stationId]);

  useEffect(() => {
    if (!user) return;
    const toggleActivity = () => {
      setOpenRoster(false);
      setOpenMemberApprovals(false);
      setOpen(current => !current);
    };
    window.addEventListener('hydroscout:toggle-station-activity', toggleActivity);
    return () => window.removeEventListener('hydroscout:toggle-station-activity', toggleActivity);
  }, [user]);

  useEffect(() => {
    if (!canApprove || !stationId) return;
    const toggleMemberApprovals = () => {
      setOpenRoster(false);
      setOpen(false);
      setOpenMemberApprovals(current => !current);
    };
    window.addEventListener('hydroscout:toggle-station-members', toggleMemberApprovals);
    return () => window.removeEventListener('hydroscout:toggle-station-members', toggleMemberApprovals);
  }, [canApprove, stationId]);

  useEffect(() => {
    if (!canViewRoster || (!isGlobalAdmin && !stationId)) return;
    const toggle = () => { setOpen(false); setOpenMemberApprovals(false); setOpenRoster(current => !current); };
    window.addEventListener('hydroscout:toggle-station-roster', toggle);
    return () => window.removeEventListener('hydroscout:toggle-station-roster', toggle);
  }, [canViewRoster, isGlobalAdmin, stationId]);

  // Live location: published to other users only within 1 km of the fire.
  const activeResponse = activeResponses[0];
  const activeStationName = activeResponseStation?.name
    ?? (activeResponseStationId === ADMIN_RESPONSE_STATION_ID ? ADMIN_RESPONSE_STATION_NAME : null);
  const responseFire = activeResponse?.firePinId ? firePins.find(pin => pin.id === activeResponse.firePinId) : undefined;
  const responseFireLat = responseFire?.lat ?? activeResponse?.incidentLat;
  const responseFireLng = responseFire?.lng ?? activeResponse?.incidentLng;
  useResponseLocationSharing(
    user && activeResponse && activeResponseStationId && activeStationName
      && typeof responseFireLat === 'number' && typeof responseFireLng === 'number'
      ? {
        responseId: activeResponse.id,
        stationId: activeResponseStationId,
        stationName: activeStationName,
        fireLat: responseFireLat,
        fireLng: responseFireLng,
      }
      : null,
    canUseDeviceLocation,
  );
  const visibility = useResponseVisibility(value => value);

  const staleAfterMs = locationTimeoutMs(process.env.NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES);

  useEffect(() => {
    if ((role !== 'head' && role !== 'admin') || (!isGlobalAdmin && !stationId) || !user) return;

    const stale = responses.filter(response => response.status === 'active'
      && response.lastLocationAt?.toDate
      && Date.now() - response.lastLocationAt.toDate().getTime() > staleAfterMs);

    for (const response of stale) {
      if (staleClosuresInFlight.current.has(response.id)) continue;
      staleClosuresInFlight.current.add(response.id);

      void requestEndResponse(response.id, 'station-head')
        .catch(err => {
          console.error('Could not close stale station response:', err);
          setError(err instanceof Error ? err.message : 'Could not close a stale response.');
        })
        .finally(() => {
          staleClosuresInFlight.current.delete(response.id);
        });
    }
  }, [isGlobalAdmin, role, responses, staleAfterMs, stationId, user]);

  async function startResponse() {
    if (!user || !fireIncident) return;
    const responseStationId = isPersonalAdmin ? ADMIN_RESPONSE_STATION_ID : stationId;
    const responseStationName = isPersonalAdmin ? ADMIN_RESPONSE_STATION_NAME : assignedStation?.name;
    if (!responseStationId || !responseStationName) return;
    setError(null);
    if (!canUseDeviceLocation) {
      openLocationConsent();
      return;
    }
    setBusy(true);
    let id: string | null = null;
    try {
      const position = await readResponsePosition();
      id = crypto.randomUUID();
      // Shown to others right away only when already within 1 km of the fire;
      // otherwise the location loop publishes on entering the radius.
      const distanceM = haversineM(position.coords.latitude, position.coords.longitude, fireIncident.lat, fireIncident.lng);
      const plan = planResponseSharing({ ...INITIAL_SHARING_STATE, published: false },
        { lat: position.coords.latitude, lng: position.coords.longitude }, distanceM, Infinity, Date.now());
      const batch = writeBatch(db);
      batch.set(doc(db, 'stationResponses', id), {
        firePinId: fireIncident.id,
        incidentLat: fireIncident.lat,
        incidentLng: fireIncident.lng,
        responseId: id,
        uid: user.uid,
        displayName: user.displayName?.trim() || user.email || 'Responder',
        stationId: responseStationId,
        stationName: responseStationName,
        status: 'active',
        startedAt: serverTimestamp(),
        endedAt: null,
        lastLocationAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', user.uid), { activeResponseId: id });
      if (plan.publish) {
        batch.set(doc(db, 'stations', responseStationId, 'unitLocations', id),
          responseMarker({ responseId: id, stationId: responseStationId, stationName: responseStationName }, position.coords));
      }
      const notice = doc(db, 'stations', responseStationId, 'notifications', `${id}_start`);
      batch.set(notice, {
        type: 'response-started',
        uid: user.uid,
        displayName: user.displayName?.trim() || user.email || 'Responder',
        responseId: id,
        message: `${user.displayName?.trim() || user.email || 'A member'} started responding.`,
        createdAt: serverTimestamp(),
      });
      // Prime before committing: the response listener fires on the local write.
      // The create itself sets lastLocationAt, so it counts as the heartbeat.
      primeResponseSharing(id, { ...plan.next, lastHeartbeatAt: Date.now() }, distanceM, plan.nextCheckMs);
      await batch.commit();
    } catch (err) {
      if (id) forgetResponseSharing(id);
      console.error('Could not start response:', err);
      setError(err instanceof Error ? err.message : 'Could not start the response.');
    } finally {
      setBusy(false);
    }
  }

  async function endResponse(response: ResponseRecord) {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      await requestEndResponse(response.id, 'member');
    } catch (err) {
      console.error('Could not end response:', err);
      setError(err instanceof Error ? err.message : 'Could not end the response.');
    } finally {
      setBusy(false);
    }
  }

  async function reviewRequest(request: JoinRequest, approved: boolean) {
    if (!canApprove || !stationId) return;
    setError(null);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'stationJoinRequests', request.id), { status: approved ? 'approved' : 'rejected', reviewedAt: serverTimestamp(), reviewedBy:user?.uid });
      batch.update(doc(db, 'users', request.uid), {
        stationMembershipStatus: approved ? 'approved' : 'rejected',
        stationId: approved ? stationId : null,
        station: approved ? (assignedStation?.name ?? stationId) : 'Unassigned',
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
  const canShowResponseAction = canRespond && (!!fireIncident || !!activeResponse) && (!activeResponse
    || !activeResponse.firePinId || activeResponse.firePinId === fireIncident?.id);

  const responseAction = canShowResponseAction ? (
    <button
      disabled={busy}
      onClick={() => void (activeResponses.length > 0 ? endResponse(activeResponses[0]) : startResponse())}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-white disabled:opacity-60 ${activeResponses.length > 0 ? 'bg-neutral-800 hover:bg-neutral-700 dark:bg-neutral-700 dark:hover:bg-neutral-600' : 'bg-[#e0353b] hover:bg-[#c92e34]'}`}
    >
      {activeResponses.length > 0 ? <FiLogOut className="h-3.5 w-3.5 shrink-0" /> : <FiActivity className="h-3.5 w-3.5 shrink-0" />}
      <span>{busy ? (activeResponses.length > 0 ? 'Ending…' : 'Starting…') : (activeResponses.length > 0 ? 'End response' : 'Start response')}</span>
    </button>
  ) : null;

  const shownVisibility = canShowResponseAction && activeResponse && visibility?.responseId === activeResponse.id ? visibility : null;
  const responseStatus = shownVisibility ? (
    <p role="status" className={`flex items-center gap-1.5 text-[11px] font-semibold ${shownVisibility.phase === 'visible' ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-500 dark:text-neutral-400'}`}>
      {shownVisibility.phase === 'visible' ? <FiEye className="h-3 w-3 shrink-0" /> : <FiEyeOff className="h-3 w-3 shrink-0" />}
      <span>{visibilityText(shownVisibility)}</span>
    </p>
  ) : null;

  return (
    <>
      {actionContainer && responseAction && createPortal(responseAction, actionContainer)}
      {statusContainer && actionContainer && responseStatus && createPortal(<div className="px-3.5 pt-2">{responseStatus}</div>, statusContainer)}
      {((canShowResponseAction && !actionContainer) || hasPendingStationRequest || error) && <div className="pointer-events-auto absolute bottom-[calc(6.5rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[2500] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl bg-white/95 p-2 shadow-xl backdrop-blur dark:bg-neutral-900/95">
        {!actionContainer && responseAction}
        {!actionContainer && responseStatus && <div className="px-1">{responseStatus}</div>}
        {hasPendingStationRequest && <span className="px-2 text-xs font-semibold text-amber-700">Station request pending approval</span>}
        {error && <span role="alert" className="max-w-56 text-xs text-red-600">{error}</span>}
      </div>}
      <StationNotificationPanels key={user.uid + ':' + stationId} stationName={isGlobalAdmin ? 'All stations' : assignedStation?.name ?? stationId ?? 'Station'}
        activityOpen={open} membersOpen={openMemberApprovals && canApprove}
        closeActivity={() => setOpen(false)} closeMembers={() => setOpenMemberApprovals(false)}
        reviewRequest={reviewRequest} onViewFireLocation={onViewFireLocation} />
      {openRoster && canViewRoster && (isGlobalAdmin || stationId) && <StationMembersPanel key={`roster:${user.uid}:${isGlobalAdmin ? 'all-stations' : stationId}`} stationId={isGlobalAdmin ? null : stationId}
        stationName={isGlobalAdmin ? 'All stations' : assignedStation?.name ?? stationId ?? ''} allStations={isGlobalAdmin} onClose={() => setOpenRoster(false)}
        responsesReady={responseStation === (isGlobalAdmin ? 'all-stations' : stationId)}
        respondingUids={new Set(responses.filter(response => responseStation === (isGlobalAdmin ? 'all-stations' : stationId) && (isGlobalAdmin || response.stationId === stationId) && response.status === 'active').map(response => response.uid))} />}
    </>
  );
}
