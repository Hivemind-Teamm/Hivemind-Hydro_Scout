'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, collectionGroup, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hydrant } from '@/app/src/data/hydrants';

export type HydrantCheckStatus = 'checked' | 'follow-up' | 'skipped';

export type HydrantCheckingSession = {
  id: string;
  stationId: string;
  name: string;
  status: 'active' | 'completed';
  startedAt: Date | null;
  endedAt: Date | null;
  targetHydrantCount: number;
};

export type HydrantCheck = {
  hydrantId: string;
  status: HydrantCheckStatus;
  note: string;
  checkedByName: string;
  checkedAt: Date | null;
};

function toDate(value: unknown): Date | null {
  return value && typeof (value as { toDate?: unknown }).toDate === 'function'
    ? (value as { toDate: () => Date }).toDate() : null;
}

export function useHydrantChecking(stationId: string | null, isAdmin: boolean, enabled = true) {
  const [sessions, setSessions] = useState<HydrantCheckingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [checks, setChecks] = useState<HydrantCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const completionAttempted = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || (!stationId && !isAdmin)) return;
    // Coverage history is useful, but an ever-growing listener is not. The
    // current session is always among the newest records and the panel keeps
    // the most recent completed sessions for reference.
    const source = isAdmin && !stationId
      ? query(collectionGroup(db, 'checkingSessions'), orderBy('startedAt', 'desc'), limit(25))
      : query(collection(db, 'stations', stationId!, 'checkingSessions'), orderBy('startedAt', 'desc'), limit(25));
    return onSnapshot(source, snapshot => {
      const next = snapshot.docs.flatMap(record => {
        const data = record.data();
        const id = typeof data.stationId === 'string' ? data.stationId : record.ref.parent.parent?.id;
        if (!id || typeof data.name !== 'string' || (data.status !== 'active' && data.status !== 'completed')) return [];
        return [{ id: record.id, stationId: id, name: data.name, status: data.status, startedAt: toDate(data.startedAt), endedAt: toDate(data.endedAt),
          targetHydrantCount: Number.isInteger(data.targetHydrantCount) && data.targetHydrantCount >= 0 ? data.targetHydrantCount : 0 }];
      });
      setSessions(next);
      setSelectedSessionId(current => current && next.some(item => item.id === current) ? current : (next.find(item => item.status === 'active')?.id ?? next[0]?.id ?? null));
      setLoading(false);
    }, () => { setSessions([]); setLoading(false); });
  }, [stationId, isAdmin, enabled]);

  const selectedSession = useMemo(() => enabled ? sessions.find(item => item.id === selectedSessionId) ?? null : null, [sessions, selectedSessionId, enabled]);
  useEffect(() => {
    if (!enabled || !selectedSession) return;
    return onSnapshot(collection(db, 'stations', selectedSession.stationId, 'checkingSessions', selectedSession.id, 'items'), snapshot => {
      setChecks(snapshot.docs.flatMap(record => {
        const data = record.data();
        if (data.hydrantId !== record.id || !['checked', 'follow-up', 'skipped'].includes(data.status)) return [];
        return [{ hydrantId: data.hydrantId, status: data.status as HydrantCheckStatus, note: typeof data.note === 'string' ? data.note : '', checkedByName: typeof data.checkedByName === 'string' ? data.checkedByName : 'Responder', checkedAt: toDate(data.checkedAt) }];
      }));
    }, () => setChecks([]));
  }, [selectedSession, enabled]);

  useEffect(() => {
    if (!selectedSession || selectedSession.status !== 'active' || !selectedSession.targetHydrantCount || checks.length < selectedSession.targetHydrantCount) return;
    if (completionAttempted.current === selectedSession.id) return;
    completionAttempted.current = selectedSession.id;
    void completeHydrantCheckingSession(selectedSession).catch(() => { completionAttempted.current = null; });
  }, [checks.length, selectedSession]);

  return {
    sessions: enabled ? sessions : [],
    selectedSession,
    selectedSessionId: enabled ? selectedSessionId : null,
    setSelectedSessionId,
    checks: enabled ? checks : [],
    loading: enabled ? loading : false,
  };
}

async function checkingRequest(body: Record<string, unknown>) {
  const response = await fetch('/api/checking-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not update hydrant checking.');
  return data;
}

export async function startHydrantCheckingSession(name: string) {
  await checkingRequest({ action: 'start', name: name.trim().slice(0, 120) });
}

export async function completeHydrantCheckingSession(session: HydrantCheckingSession) {
  await checkingRequest({ action: 'complete', sessionId: session.id });
}

export async function recordHydrantCheck(session: HydrantCheckingSession, hydrant: Hydrant, input: { uid: string; displayName: string; status: HydrantCheckStatus; note?: string }) {
  await setDoc(doc(db, 'stations', session.stationId, 'checkingSessions', session.id, 'items', hydrant.id), {
    hydrantId: hydrant.id, status: input.status, note: input.note?.trim().slice(0, 500) ?? '', checkedByUid: input.uid, checkedByName: input.displayName, checkedAt: serverTimestamp(),
  });
}
