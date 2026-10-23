'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { disableDevicePush, enableDevicePush, pauseDevicePush, pushConfigured, pushPreference, savePushPreference } from '@/lib/browser-push';

type PushState = { status: 'off' | 'on' | 'busy'; error: string | null };
const PushContext = createContext<PushState & { eligible: boolean; configured: boolean; toggle: () => Promise<void> }>({
  status: 'off', error: null, eligible: false, configured: false, toggle: async () => {},
});

export default function DevicePushProvider({ children }: { children: ReactNode }) {
  const { user, role, stationId, stationAccessIds, loading } = useAuth();
  const eligible = !loading && !!user && !!stationId && (role === 'admin' || role === 'head' || stationAccessIds.includes(stationId));
  const scope = eligible ? `${user!.uid}:${stationId}` : '';
  const generation = useRef(0);
  const [state, setState] = useState<PushState & { scope: string }>({ scope: '', status: 'off', error: null });

  useEffect(() => {
    let stopped = false;
    let running = false;
    const sync = async () => {
      if (running) return;
      running = true;
      const token = ++generation.current;
      const current = () => !stopped && token === generation.current;
      try {
        await pauseDevicePush();
        if (!current() || !user || !scope) return;
        if (!pushConfigured() || !pushPreference(user.uid) || !('Notification' in window) || Notification.permission !== 'granted') {
          setState({ scope, status: 'off', error: null }); return;
        }
        await enableDevicePush(user, current);
        if (current()) setState({ scope, status: 'on', error: null });
      } catch (error) {
        if (current()) setState({ scope, status: 'off', error: error instanceof Error ? error.message : 'Device notifications unavailable.' });
      } finally { running = false; }
    };
    void sync();
    const online = () => { void sync(); };
    window.addEventListener('online', online);
    const timer = setInterval(online, 12 * 60 * 60_000);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('online', online); };
  }, [scope, user]);

  async function toggle() {
    if (!user || !scope || state.status === 'busy') return;
    const token = ++generation.current;
    const current = () => token === generation.current;
    const wasOn = state.scope === scope && state.status === 'on';
    setState({ scope, status: 'busy', error: null });
    try {
      if (wasOn) {
        savePushPreference(user.uid, false);
        await disableDevicePush(user);
      } else {
        if (!('Notification' in window) || !('serviceWorker' in navigator) || !window.isSecureContext) {
          throw new Error('Use a supported browser over HTTPS. On iPhone or iPad, open the installed Home Screen app.');
        }
        // Ask only in direct response to this button, never on page load.
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings to enable device alerts.');
        savePushPreference(user.uid, true);
        await enableDevicePush(user, current);
      }
      if (current()) setState({ scope, status: wasOn ? 'off' : 'on', error: null });
    } catch (error) {
      if (current() && !wasOn) {
        try { savePushPreference(user.uid, false); } catch { /* Storage may be blocked. */ }
        await pauseDevicePush().catch(() => {});
      }
      if (current()) setState({ scope, status: 'off', error: error instanceof Error ? error.message : 'Could not update device notifications.' });
    }
  }
  const visible = state.scope === scope ? state : { status: 'off' as const, error: null };
  return <PushContext.Provider value={{ ...visible, eligible, configured: pushConfigured(), toggle }}>{children}</PushContext.Provider>;
}

export function DevicePushSettings({ compact = false }: { compact?: boolean }) {
  const push = useContext(PushContext);
  if (!push.eligible) return null;
  return <section className={compact ? 'border-b border-neutral-100 px-4 py-2 font-sans dark:border-neutral-800' : 'rounded-xl border border-neutral-200 p-3 dark:border-neutral-700'}>
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-100">Device notifications {push.status === 'on' ? '· On' : '· Off'}</p>
      <button type="button" disabled={!push.configured || push.status === 'busy'} onClick={() => void push.toggle()}
        className="shrink-0 rounded-lg bg-[#e0353b] px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">
        {push.status === 'busy' ? 'Saving…' : push.status === 'on' ? 'Turn off' : 'Enable'}
      </button>
    </div>
    {!compact && <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">Receive station activity and member approval alerts on this device, even when Hydro-Scout is in the background. Delivery depends on browser and device settings.</p>}
    {!push.configured && <p className="mt-1 text-[10px] text-neutral-500">Device alerts are awaiting administrator setup.</p>}
    {push.error && <p role="alert" className="mt-2 text-[11px] text-red-600">{push.error}</p>}
  </section>;
}
