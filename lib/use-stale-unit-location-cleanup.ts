'use client';

import { useEffect } from 'react';
import {
  collectionGroup,
  getDocs,
  query,
  where,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

const STALE_AFTER_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 3 * 60 * 1000;
const CHUNK_SIZE = 100;

export function useStaleUnitLocationCleanup(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let running = false;

    async function cleanup() {
      if (cancelled || running) return;

      running = true;

      try {
        const cutoff = Date.now() - STALE_AFTER_MS;
        const snapshot = await getDocs(
          query(
            collectionGroup(db, 'unitLocations'),
            where('updatedAt', '<', Timestamp.fromMillis(cutoff))
          )
        );

        const stale = snapshot.docs.filter(record => {
          const updatedAt = record.data().updatedAt;
          return updatedAt instanceof Timestamp &&
            updatedAt.toMillis() < cutoff;
        });

        for (let i = 0; i < stale.length; i += CHUNK_SIZE) {
          if (cancelled) break;

          const chunk = stale.slice(i, i + CHUNK_SIZE);

          await runTransaction(db, async transaction => {
            const current = await Promise.all(
              chunk.map(record => transaction.get(record.ref))
            );

            current.forEach(record => {
              if (!record.exists()) return;

              const updatedAt = record.data().updatedAt;

              if (
                updatedAt instanceof Timestamp &&
                updatedAt.toMillis() < cutoff
              ) {
                transaction.delete(record.ref);
              }
            });
          });
        }
      } catch (error) {
        console.warn('Admin unit-location cleanup failed:', error);
      } finally {
        running = false;
      }
    }

    void cleanup();

    const interval = window.setInterval(() => {
      void cleanup();
    }, CLEANUP_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled]);
}
