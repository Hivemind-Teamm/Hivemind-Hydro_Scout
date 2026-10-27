'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './auth-context';
import { accountIsPresent, type PresenceRecord } from './account-presence-state';
import { useLoginClock } from './use-login-clock';

export function useAccountPresence(uid?: string) {
  const { user, role, loading, stationId } = useAuth();
  const now = useLoginClock();
  const scope = user && uid ? `${user.uid}:${uid}:${role}:${stationId}` : null;
  const [state, setState] = useState<{ scope: string | null; records: PresenceRecord[]; checkedAt?: number }>({ scope: null, records: [] });
  useEffect(() => {
    if (!scope || !uid || (role !== 'admin' && uid !== user?.uid && !stationId)) return;
    const filters = [where('uid', '==', uid)];
    if (role !== 'admin' && uid !== user?.uid) filters.push(where('stationId', '==', stationId));
    return onSnapshot(query(collection(db, 'accountPresenceSessions'), ...filters), snapshot => {
      setState({ scope, records: snapshot.docs.map(record => record.data() as PresenceRecord), checkedAt: Date.now() });
    }, () => setState({ scope, records: [] }));
  }, [scope, uid, role, user?.uid, stationId]);
  return !!uid && ((!loading && role !== null && user?.uid === uid)
    || (state.scope === scope && accountIsPresent(state.records, uid, Math.max(now, state.checkedAt ?? now))));
}
