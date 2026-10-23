/* Dedicated push worker. It does not cache pages or intercept map requests. */
const bindingDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('hydroscout-push', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('settings');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function binding(value) {
  const db = await bindingDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('settings', value === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('settings');
      const request = value === undefined ? store.get('uid') : store.put(value, 'uid');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
self.addEventListener('message', event => {
  if (event.data?.type !== 'PUSH_ACCOUNT') return;
  const uid = typeof event.data.uid === 'string' ? event.data.uid : null;
  event.waitUntil(binding(uid).then(() => event.ports[0]?.postMessage({ ok: true })));
});
// Register click handling before Firebase, so it cannot override this handler.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.stopImmediatePropagation();
  event.waitUntil((async () => {
    const data = event.notification.data;
    if (!data?.uid || data.uid !== await binding()) return;
    const kind = data.kind === 'members' ? 'members' : 'activity';
    const url = new URL(`/dashboard?notifications=${kind}`, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); await existing.focus(); }
    else await self.clients.openWindow(url);
  })());
});
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyD343gpPDZEUGzzVmIEqDCHQaxMlueWIpE',
  authDomain: 'hydro-scout.firebaseapp.com', projectId: 'hydro-scout',
  messagingSenderId: '626033823119', appId: '1:626033823119:web:b0dfa6b41fadd348830ffa',
});
firebase.messaging().onBackgroundMessage(async payload => {
  const data = payload.data;
  if (!data?.uid || data.uid !== await binding()) return;
  await self.registration.showNotification(data.title || 'Hydro-Scout', {
    body: data.body || 'A new station notification is available.',
    icon: '/Hydro-Scout%20Logo.png', tag: data.tag, renotify: false,
    data: { uid: data.uid, kind: data.kind },
  });
});
