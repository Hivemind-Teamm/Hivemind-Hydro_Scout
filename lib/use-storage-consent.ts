'use client';

import { useState, useCallback, useRef } from 'react';

const STORAGE_KEY = 'hydro-scout-storage-consent';

export function useStorageConsent() {
  const [modalOpen, setModalOpen] = useState(false);
  const resolveRef = useRef<((granted: boolean) => void) | null>(null);

  const requestConsent = useCallback((): Promise<boolean> => {
    if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'granted') {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setModalOpen(true);
    });
  }, []);

  function handleAllow() {
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, 'granted');
    setModalOpen(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }

  function handleDecline() {
    setModalOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }

  return { requestConsent, modalOpen, handleAllow, handleDecline };
}
