'use client';

import type { User } from 'firebase/auth';
import type { Messaging } from 'firebase/messaging';
import app, { auth } from './firebase';

const deviceKey = 'hydroscout-push-device';
const preferenceKey = (uid: string) => `hydroscout-push-enabled:${uid}`;
let messaging: Messaging | undefined;
let foregroundStop: (() => void) | undefined;
const preferenceFallback = new Map<string, boolean>();

export function pushConfigured() { return !!process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY?.trim(); }
export function pushPreference(uid: string) {
  if (preferenceFallback.has(uid)) return preferenceFallback.get(uid)!;
  try { return localStorage.getItem(preferenceKey(uid)) === 'true'; } catch { return false; }
}
export function savePushPreference(uid: string, enabled: boolean) {
  try { localStorage.setItem(preferenceKey(uid), String(enabled)); preferenceFallback.delete(uid); }
  catch { preferenceFallback.set(uid, enabled); }
}
async function worker() {
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
    scope: '/push-notifications/', updateViaCache: 'none',
  });
  if (!registration.active) {
    await new Promise<void>((resolve, reject) => {
      const pending = registration.installing ?? registration.waiting;
      const timeout = setTimeout(() => reject(new Error('Device notifications could not start. Please retry.')), 20_000);
      if (!pending) { clearTimeout(timeout); reject(new Error('Notification worker unavailable.')); return; }
      const changed = () => {
        if (pending.state === 'activated' || pending.state === 'redundant') {
          clearTimeout(timeout); pending.removeEventListener('statechange', changed);
          if (pending.state === 'activated') resolve(); else reject(new Error('Notification worker could not activate.'));
        }
      };
      pending.addEventListener('statechange', changed); changed();
    });
  }
  return registration;
}
async function bind(registration: ServiceWorkerRegistration, uid: string | null) {
  if (!registration.active) throw new Error('Notification worker unavailable.');
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Could not secure device notifications.')); }, 5000);
    channel.port1.onmessage = () => { clearTimeout(timeout); channel.port1.close(); resolve(); };
    registration.active!.postMessage({ type: 'PUSH_ACCOUNT', uid }, [channel.port2]);
  });
}
async function saveDevice(user: User, token: string, remove = false) {
  const response = await fetch('/api/push/devices', {
    method: remove ? 'DELETE' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error('Could not save device notifications. Check your connection and station access.');
}
export async function pauseDevicePush() {
  foregroundStop?.(); foregroundStop = undefined;
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/push-notifications/');
  if (registration?.scope === new URL('/push-notifications/', location.origin).href) {
    try { await bind(registration, null); }
    catch {
      await (await registration.pushManager.getSubscription())?.unsubscribe();
      await registration.unregister();
    }
  }
}
export async function enableDevicePush(user: User, current: () => boolean) {
  if (!pushConfigured()) throw new Error('Device notifications are awaiting administrator setup.');
  const sdk = await import('firebase/messaging');
  if (!await sdk.isSupported()) throw new Error('This browser does not support device notifications.');
  if (Notification.permission !== 'granted') throw new Error('Allow notifications in your browser settings.');
  const registration = await worker();
  if (!current()) return;
  messaging ??= sdk.getMessaging(app);
  const token = await sdk.getToken(messaging, { vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
  if (!current() || auth.currentUser?.uid !== user.uid) return;
  if (!token) throw new Error('Could not register this device for notifications.');
  await saveDevice(user, token);
  if (!current() || auth.currentUser?.uid !== user.uid) return;
  localStorage.setItem(deviceKey, JSON.stringify({ uid: user.uid, token }));
  await bind(registration, user.uid);
  foregroundStop?.();
  foregroundStop = sdk.onMessage(messaging, payload => {
    const data = payload.data;
    if (!current() || auth.currentUser?.uid !== user.uid || data?.uid !== user.uid) return;
    void registration.showNotification(data.title || 'Hydro-Scout', {
      body: data.body, icon: '/Hydro-Scout%20Logo.png', tag: data.tag,
      data: { uid: user.uid, kind: data.kind },
    }).catch(() => {});
  });
}
/** Stop local delivery before remote cleanup or Firebase sign-out. */
export async function disableDevicePush(user: User) {
  await pauseDevicePush();
  let device: { uid?: string; token?: string } | null = null;
  try { device = JSON.parse(localStorage.getItem(deviceKey) ?? 'null'); } catch { /* Still unsubscribe locally. */ }
  const ownedToken = device?.uid === user.uid && typeof device.token === 'string' ? device.token : null;
  const results = await Promise.allSettled([
    ownedToken ? saveDevice(user, ownedToken, true) : Promise.resolve(),
    (async () => {
      // A cold Messaging instance would register Firebase's default worker when
      // deleting. Unsubscribe our explicit registration instead in that case.
      if (messaging) {
        const sdk = await import('firebase/messaging');
        await sdk.deleteToken(messaging);
      } else {
        const registration = await navigator.serviceWorker.getRegistration('/push-notifications/');
        if (registration?.scope === new URL('/push-notifications/', location.origin).href) {
          await (await registration.pushManager.getSubscription())?.unsubscribe();
        }
      }
    })(),
  ]);
  // Keep a failed remote cleanup token so the next attempt can retry it.
  if (ownedToken && results.every(result => result.status === 'fulfilled')) {
    try { localStorage.removeItem(deviceKey); } catch { /* Local binding is already paused. */ }
  }
}
