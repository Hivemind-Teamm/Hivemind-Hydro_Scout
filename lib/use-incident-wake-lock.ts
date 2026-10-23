'use client';

import { useEffect, useState } from 'react';
import { createIncidentWakeLockController } from './incident-wake-lock-controller.mjs';

export interface IncidentWakeLockState {
  held: boolean;
  supported: boolean;
}

export function useIncidentWakeLock(active: boolean): IncidentWakeLockState {
  const [state, setState] = useState<IncidentWakeLockState>({
    held: false,
    supported: false,
  });

  useEffect(() => {
    const supported =
      typeof navigator !== 'undefined' &&
      typeof navigator.wakeLock?.request === 'function';

    if (!active || !supported) return;

    let mounted = true;

    const controller = createIncidentWakeLockController({
      request: () => navigator.wakeLock.request('screen'),
      isVisible: () => document.visibilityState === 'visible',
      onChange: held => {
        if (mounted) setState({ held, supported: true });
      },
    });

    const onVisibilityChange = () => controller.visibilityChanged();

    document.addEventListener('visibilitychange', onVisibilityChange);
    controller.start();

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controller.stop();
    };
  }, [active]);

  return active
    ? state
    : { held: false, supported: state.supported };
}
