'use client';

import { useEffect } from 'react';
import { beforeAuthStateChanged } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { PRESENCE_HEARTBEAT_MS, presenceSession } from '@/lib/account-presence-state';

export default function AccountPresenceReporter() {
  const { user, role, loading, stationId } = useAuth();
  const uid = !loading && role !== null ? user?.uid : undefined;
  useEffect(() => {
    if (!uid) return;
    const ref = doc(db, 'accountPresenceSessions', crypto.randomUUID());
    const session = presenceSession(
      () => setDoc(ref, { uid, stationId, lastSeenAt: serverTimestamp() }),
      () => deleteDoc(ref),
    );
    const heartbeat = () => {
      if (navigator.onLine) void session.heartbeat().catch(error => console.warn('Account presence update failed:', error.code));
    };
    heartbeat();
    const timer = setInterval(heartbeat, PRESENCE_HEARTBEAT_MS);
    window.addEventListener('focus', heartbeat);
    window.addEventListener('online', heartbeat);
    const visible = () => { if (!document.hidden) heartbeat(); };
    document.addEventListener('visibilitychange', visible);
    // Give an explicit sign-out a chance to remove just this tab/device before
    // Firebase clears its identity. Offline logout must still be possible.
    const removeWithTimeout = async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        session.stop().catch(() => {}),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, 2000); }),
      ]);
      clearTimeout(timeout);
    };
    const unsubscribe = beforeAuthStateChanged(auth, next => next?.uid !== uid ? removeWithTimeout() : undefined);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', heartbeat);
      window.removeEventListener('online', heartbeat);
      document.removeEventListener('visibilitychange', visible);
      void removeWithTimeout().finally(unsubscribe);
    };
  }, [uid, stationId]);
  return null;
}
