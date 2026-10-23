# Testing station response locations

These steps test the manual approved-responder workflow, not automatic sharing
on login or the development-only incident prototype. See the
[implementation status](../unit-locations.md#bfp-requirement-and-implementation-status).

## Setup

1. Install dependencies with `npm ci` and run `npm run dev` over localhost or
   HTTPS.
2. Configure the location privacy controller/contact in `.env.local`. Do not
   commit that file.
3. In the Admin Dashboard, create an active station directory entry. The sign-up
   station selector only shows active entries.
4. Create a head account for the station and sign in as that head in one browser.
   Sign up a separate personal account with the station selected; approve its
   pending request in **Member approvals**.

## Response lifecycle

1. Sign in as the approved personal account. Confirm the notice appears before
   browser GPS is requested. Decline and check that no location is published.
2. Consent and grant browser location permission. Pin a fire in the map, then
   press **Start responding**.
   Verify an individual pin appears, labeled with the station name.
3. Keep the page online and active for at least three minutes. The pin's update
   time should advance. Browser suspension, sleep, or network loss can pause
   updates; these are expected web-platform limits.
4. Observe from a different signed-in account. It should see the station-labeled
   pin but not the responder identity. An anonymous browser should not read
   response locations.
5. As the station head, open **Station Activity**. Verify response notifications
   are visible. Click the linked account to open its profile and clear the row's
   unread dot. Opening the list alone must not mark it read. Reopening the panel
   does not itself create an access event in the current UI.
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

The map marks a location stale after six minutes without updates and removes it
after the default 15-minute timeout. For a faster local test that preserves the
stale-warning window, set this in `.env.local` before starting/rebuilding the
app:

```env
NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES=7
```

Start a response, then close the responder tab or disconnect the device. Keep a
head account signed in with the station activity panel open. After six minutes
without a successful update, verify the map pin and details show a stale status.
After seven minutes, verify the response listener closes the response, clears
the active-response pointer, removes the map location and writes an in-app
station notification. Restore the normal timeout after testing.

## In-app notification checks

1. As a station manager, receive two activity events and a new membership request
   from separate test sessions. Both main icons and the corresponding unread rows
   should have red dots.
2. Open an activity's linked admin or edited-account profile. Only that activity
   should become read. Its main icon should remain dotted while another unread
   row exists; clear the remaining row to remove the main dot.
3. Open the requesting member's profile in **Member approvals**. Its unread dot
   should clear without approving or rejecting the membership request.
4. Reload, then log out and back into the same account. Previously read rows must
   stay read. Sign into that account in another browser/device and confirm the
   read state synchronizes. Another account must have independent read state.
   While any one row remains unread, its main icon must still show a red dot.
   Deploy the updated Firestore read-receipt rules before this cross-device test.
5. Confirm Account Center and the notification panels have no device-alert
   controls or browser notification permission prompts. Notifications are in-app
   only; they do not produce alerts while the app is closed.

## Live response notification card

1. Start a response as an approved member and observe Station Activity as the
   station manager. One card should say `[Name] started response`, glow yellow,
   and show the station, start date/time (PHT), ongoing status and duration.
2. Click anywhere on the card to open details and mark the update read. Check
   keyboard access with Tab and Enter/Space. Verify its account link still opens
   the correct profile. The yellow active glow must remain after the red unread
   dot clears; these indicators represent different states.
3. End the response. The same response card must change to `[Name] ended response`,
   stop glowing, retain the original start time, and show its end time and fixed
   duration. There must be no separate start and end cards for the same response.
4. Repeat with a management-closed stale response. Its card must stop glowing,
   preserve the responder's identity and show the recorded ending account.
5. Verify an end update is unread until opened, while routine GPS updates do not
   revive unread dots. Older event-only response history must also consolidate.
6. Open assignment and membership-update cards to view their details. Click a
   member-request card to open the requester profile; clicking approve/reject
   must perform only that action. Check the active card with reduced motion enabled.

## Automated checks

Use Node 24 for tests and TypeScript. Firestore emulator tests require Java 21:

```powershell
node --test test/location-consent.test.mjs test/unit-location.test.mjs test/unit-location-reporting.test.mjs test/unit-location-expiry.test.mjs test/map-unit-location.test.mjs
node --test test/notification-read-state.test.mjs
node --test test/station-notification-feed.test.mjs
npx.cmd -y firebase-tools@latest emulators:exec --only firestore --project demo-station-responses "node test/station-response-rules.test.mjs"
npx.cmd -y firebase-tools@latest emulators:exec --only firestore --project demo-notification-reads "node test/notification-read-rules.test.mjs"
npx.cmd tsc --noEmit --incremental false
npx.cmd eslint app/src/components/StationResponseControl.tsx lib/auth-context.tsx lib/unit-location.ts test/station-response-rules.test.mjs
```

The station rules test uses a demo project and covers membership request/approval,
response start/end authorization, signed-in cross-station location access, and
responder-name privacy. It does not deploy or use production data.
