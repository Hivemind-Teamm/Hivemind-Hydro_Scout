'use client';

import { useEffect } from 'react';
import { beforeAuthStateChanged } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { PRESENCE_HEARTBEAT_MS, presenceSession } from '@/lib/account-presence-state';

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// Reloads reuse this tab's session document. A fresh ID per page load left an
// orphan behind every time (unload never runs the delete), and station roster
// queries read every orphan.
function presenceSessionId(uid: string) {
  const key = `hydroscout:presence-session:${uid}`;
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && SESSION_ID.test(saved)) return saved;
  } catch { /* Fall back to a page-only session. */ }
  const id = crypto.randomUUID();
  try { sessionStorage.setItem(key, id); } catch { /* Presence still works. */ }
  return id;
}

// A remount reuses the same document, so it must not write until the previous
// session's delete has finished.
let previousStop: Promise<unknown> = Promise.resolve();

export default function AccountPresenceReporter() {
  const { user, role, loading, stationId } = useAuth();
  const uid = !loading && role !== null ? user?.uid : undefined;
  useEffect(() => {
    if (!uid) return;
    const ref = doc(db, 'accountPresenceSessions', presenceSessionId(uid));
    const ready = previousStop;
    const session = presenceSession(
      () => ready.then(() => setDoc(ref, { uid, stationId, lastSeenAt: serverTimestamp() })),
      () => deleteDoc(ref),
    );
    // Focus/visibility fire constantly; only refresh a heartbeat that is getting old.
    let lastBeat = -Infinity;
    const heartbeat = () => {
      if (!navigator.onLine || Date.now() - lastBeat < PRESENCE_HEARTBEAT_MS / 2) return;
      lastBeat = Date.now();
      void session.heartbeat().catch(error => {
        lastBeat = -Infinity;
        console.warn('Account presence update failed:', error.code);
      });
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
      const stopping = session.stop().catch(() => {});
      previousStop = stopping;
      await Promise.race([
        stopping,
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
