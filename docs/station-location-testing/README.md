# Testing station response locations

## Setup

1. Install dependencies with `npm ci` and run `npm run dev` over localhost or
   HTTPS.
2. Configure the location privacy controller/contact in `.env.local`. Do not
   commit that file.
3. In the Admin Dashboard, create an active station directory entry. The sign-up
   station selector only shows active entries.
4. Create a head account for the station and sign in as that head in one browser.
   Sign up a separate personal account with the station selected; approve its
   pending request in **Station Activity**.

## Response lifecycle

1. Sign in as the approved personal account. Confirm the notice appears before
   browser GPS is requested. Decline and check that no location is published.
2. Consent and grant browser location permission, then press **Start responding**.
   Verify an individual pin appears, labeled with the station name.
3. Keep the page online and active for at least three minutes. The pin's update
   time should advance. Browser suspension, sleep, or network loss can pause
   updates; these are expected web-platform limits.
4. Observe from a different signed-in account. It should see the station-labeled
   pin but not the responder identity. An anonymous browser should not read
   response locations.
5. As the station head, open **Station Activity**. Verify the responder's name,
   response history, and notifications are visible. Open the workspace again and
   verify the access event is recorded. Only heads/admins see the access-log list.
6. As the responder, end the response. Verify the map pin disappears and the
   private response history remains.

## Consent withdrawal and resume

1. Start a response with consent and verify its location exists.
2. Withdraw consent from **Location privacy**. The current live location should
   be deleted and further updates should stop; the response status remains active.
3. Consent again without ending the response. Verify a fresh location document is
   created and the pin returns.
4. End the response and confirm the location is removed. The station record
   should remain in private history.

## Stale-response test

The default stale timeout is 15 minutes. For a faster local test, set this in
`.env.local` before starting/rebuilding the app:

```env
NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES=1
```

Start a response, then close the responder tab or disconnect the device. Keep a
head account signed in. After the last successful location update becomes stale,
the response listener should close the active response, clear its active-response
pointer, remove the map location, and write an in-app station notification.
Restore the normal timeout after testing. The regular update interval is three
minutes, so a one-minute timeout can expire a position between successful
updates.

## Automated checks

Use Node 24 for tests and TypeScript. Firestore emulator tests require Java 21:

```powershell
node --test test/location-consent.test.mjs test/unit-location.test.mjs test/unit-location-reporting.test.mjs test/unit-location-expiry.test.mjs test/map-unit-location.test.mjs
npx.cmd -y firebase-tools@latest emulators:exec --only firestore --project demo-station-responses "node test/station-response-rules.test.mjs"
npx.cmd tsc --noEmit --incremental false
npx.cmd eslint app/src/components/StationResponseControl.tsx lib/auth-context.tsx lib/unit-location.ts test/station-response-rules.test.mjs
```

The station rules test uses a demo project and covers membership request/approval,
response start/end authorization, signed-in cross-station location access, and
responder-name privacy. It does not deploy or use production data.
