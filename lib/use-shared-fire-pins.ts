'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { useAuth } from './auth-context';
import { db } from './firebase';
import { getUserProfile } from './user-profile';
import { firePinArrivalTracker } from './fire-pin-arrivals';
import { playHazardChime, prepareNotificationAudio } from './chime';

export type SharedFirePin = { id: string; lat: number; lng: number; stationId: string | null; pinnedAt: number; arrivalAt?: number };
export type MapFirePin = Pick<SharedFirePin, 'id' | 'lat' | 'lng' | 'arrivalAt'>;
const movePin = (id: string, lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  ? updateDoc(doc(db, 'firePins', id), { lat, lng, updatedAt: serverTimestamp() }) : Promise.reject(new Error('Invalid fire coordinates.'));
const clearPin = async (id: string) => {
  const result = await fetch('/api/fire-pins/clear', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  if (!result.ok) throw new Error('Could not clear the incident and end its responses.');
};
export function useSharedFirePins() {
  const { user, role, stationId, stationAccessIds } = useAuth();
  const [state, setState] = useState<{ uid?: string; pins: SharedFirePin[]; owned: string[]; error: string | null }>({ pins: [], owned: [], error: null });
  const uid = user?.uid;
  const localCreations = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    if (!uid) return;
    const local = localCreations.current.get(uid) ?? new Set<string>();
    localCreations.current.set(uid, local);
    const trackArrivals = firePinArrivalTracker();
    const arrivals = new Map<string, number>();
    const unlock = () => prepareNotificationAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    let pins: SharedFirePin[] = [];
    let owned: string[] = [];
    let error: string | null = null;
    const publish = () => setState({ uid, pins, owned, error });
    const stopPins = onSnapshot(query(collection(db, 'firePins'), where('status', '==', 'active')), { includeMetadataChanges: true }, snapshot => {
      const incoming = trackArrivals(snapshot.docs.map(record => ({ id: record.id, pending: record.metadata.hasPendingWrites })), snapshot.metadata.fromCache, local);
      if (incoming.length) {
        const now = Date.now();
        incoming.forEach(id => arrivals.set(id, now));
        playHazardChime();
      }
      pins = snapshot.docs.map(record => { const data = record.data(); return {
        id: record.id, lat: data.lat, lng: data.lng, stationId: data.stationId ?? null, pinnedAt: data.createdAt?.toMillis?.() ?? 0,
        arrivalAt: arrivals.get(record.id),
      }; }).filter(pin => Number.isFinite(pin.lat) && Number.isFinite(pin.lng) && Math.abs(pin.lat) <= 90 && Math.abs(pin.lng) <= 180)
        .sort((a, b) => b.pinnedAt - a.pinnedAt);
      error = null; publish();
    }, () => { pins = []; error = 'Shared fire incidents could not load. Check your connection and deployed Firestore rules.'; publish(); });
    const stopOwners = onSnapshot(query(collection(db, 'firePinOwners'), where('uid', '==', uid)), snapshot => {
      owned = snapshot.docs.map(record => record.id); publish();
    }, () => { owned = []; publish(); });
    return () => { stopPins(); stopOwners(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [uid]);
  const pins = uid && state.uid === uid ? state.pins : [];
  const owned = uid && state.uid === uid ? state.owned : [];
  const canEdit = (pin: SharedFirePin) => !!uid && (role === 'admin' || owned.includes(pin.id)
    || (!!pin.stationId && ((role === 'head' && stationId === pin.stationId) || stationAccessIds.includes(pin.stationId))));
  const create = useCallback(async (lat: number, lng: number) => {
      if (!uid) throw new Error('Sign in before pinning a fire incident.');
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Invalid fire coordinates.');
      const { data } = await getUserProfile(uid);
      const assigned = typeof data?.stationId === 'string' ? data.stationId : null;
      const pin = doc(collection(db, 'firePins'));
      const local = localCreations.current.get(uid) ?? new Set<string>();
      local.add(pin.id); localCreations.current.set(uid, local);
      const batch = writeBatch(db);
      batch.set(pin, { lat, lng, stationId: assigned, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batch.set(doc(db, 'firePinOwners', pin.id), { uid, stationId: assigned, createdAt: serverTimestamp() });
      if (assigned) {
        const displayName = data?.displayName || 'Responder';
        batch.set(doc(collection(db, 'stations', assigned, 'notifications')), {
          type: 'fire-pinned', uid, displayName, lat, lng, firePinId: pin.id,
          message: `${displayName} pinned a fire incident.`, createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      return pin.id;
  }, [uid]);
  return { pins, canEdit, error: uid && state.uid === uid ? state.error : null, create, move: movePin, clear: clearPin };
}
