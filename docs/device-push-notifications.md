# Browser and device push notifications

Station managers can enable **Device notifications** in Account Center or either
station notification panel. Browser permission is requested only after pressing
Enable. Each browser/device makes its own choice. The in-app inbox and red unread
dots remain the history; opening a push opens the appropriate list, and visiting
a linked profile still marks that notification read.

## Delivery

- A newly created station activity document triggers `stationActivityPush`.
- A newly created pending join request triggers `stationMembershipPush`.
- Cloud Functions run independently of an open app tab. Firebase Cloud Messaging
  delivers the event to registered devices; a dedicated service worker displays it.
- A response-started event requests high delivery urgency. Other activity and
  approval messages use normal urgency. Urgency does not override mute, Do Not
  Disturb, browser suspension, network loss, or operating-system delivery policy.
- Lock-screen text is generic, without member names, email addresses, or GPS data.
- Only accounts with current management access to the station receive pushes.
  Both registration and delivery resolve the current trusted personal/station
  profile, including the station-account index. Revoked assignments are excluded.
- Logout clears the worker's persisted account binding before sign-out and attempts
  server-token cleanup/unsubscription. Queued messages for a different or logged-out
  account are ignored. Logging back in resumes the account's opt-in preference.
- Device registrations expire after 30 days without a refresh. Enabled sessions
  refresh on load, reconnect and every 12 hours. Expired registrations are ignored;
  invalid/unregistered FCM tokens are removed after delivery failures.
- Push events expire after five minutes. Retries can produce duplicate deliveries;
  stable per-event notification tags replace duplicates where supported.

These alerts cover the existing station activity and member approval events. They
do not introduce incident dispatch, guaranteed emergency delivery, SMS, or native
mobile critical alerts. Retain an operational fallback for urgent communication.

## Administrator setup and release

1. In Firebase Console for `hydro-scout`, open Project settings → Cloud Messaging.
   Ensure the FCM HTTP v1 API is enabled and generate a Web Push certificate key
   pair. Put its **public** key in the Next.js build/deployment environment:

   ```env
   NEXT_PUBLIC_FIREBASE_VAPID_KEY=your_public_web_push_certificate_key
   ```

   The private key stays in Firebase. Do not place service-account credentials in
   public environment variables. The Next.js server still needs its existing
   `FIREBASE_SERVICE_ACCOUNT_KEY` for authenticated registration.

2. Install and deploy the event-triggered sender. Cloud Functions deployment
   requires an appropriately billed Firebase project, permissions and enabled
   APIs. The configured Node 22 functions run in `asia-southeast1`, matching the
   existing Firestore location.

   ```powershell
   npm.cmd ci --prefix functions
   npx.cmd -y firebase-tools@latest deploy --only functions:notifications --project hydro-scout
   ```

3. Rebuild/redeploy the Next.js app with the public VAPID key. Device settings show
   “awaiting administrator setup” until the key is configured. A configured key
   alone does not deploy the sender; complete both deployments.

4. Use HTTPS in production (localhost is suitable for desktop development). On
   supported iPhones/iPads, add the app to the Home Screen and enable notifications
   from that installed app. Browser and operating-system support varies.

The `pushDevices` collection is server-only; the existing default-deny rules block
direct client reads and writes. Registration uses verified Firebase ID tokens,
ignores client-supplied roles/station IDs, and binds token deletion to its owner.
Functions use their managed service identity; no credential file is packaged.

## Testing

```powershell
node --test test/push-notifications.test.mjs test/push-device-api.test.mjs test/notification-read-state.test.mjs
npx.cmd tsc --noEmit --incremental false
```

After completing setup, use dedicated test accounts and real devices:

1. Sign in as a station manager, enable device notifications and allow the browser
   prompt. Check the server-side `pushDevices` record without exposing its token.
2. In another session, create a genuine station join request or account assignment
   that normally produces a station notification. Confirm an OS/browser alert.
3. Background/close the receiving app and repeat. The alert must arrive without a
   Firestore listener in an open tab; tapping it opens the appropriate list.
4. Confirm opening the list leaves its row unread; visiting either linked profile
   clears that row's dot and the icon dot clears when all rows are read.
5. Turn device alerts off and repeat; the inbox still updates but this device
   displays no push. Log out or switch accounts and confirm old-account pushes
   cannot display or open a list for the previous account.
6. Revoke the account's station-management access and verify it no longer receives
   pushes. Denied browser permission must leave the app usable.

Automated tests mock delivery and do not send real pushes. End-to-end device
delivery requires the deployed functions, VAPID configuration and browser permission.

References: [FCM web setup](https://firebase.google.com/docs/cloud-messaging/web/get-started),
[foreground/background delivery](https://firebase.google.com/docs/cloud-messaging/web/receive-messages),
[Firestore event triggers](https://firebase.google.com/docs/functions/firestore-events).
