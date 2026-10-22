# Station response locations

## Current workflow

Station locations are published by approved personal accounts only while the
responder has an active response. Logging in, being linked to a station, or using
a station account does not start location sharing.

1. An administrator maintains the station directory in the Admin Dashboard.
   Directory entries provide a station ID and display name; create entries before
   users select them at sign-up.
2. A person may select a station during sign-up. This creates a pending membership
   request. A head for that station reviews and approves or rejects it in Station
   Activity. Approval assigns the person's station ID; it does not start tracking.
3. An approved responder accepts the location notice and presses **Start
   responding**. The app captures an initial location and publishes it with the
   station's label. Updates are attempted every three minutes while the app is
   active/resumed and location access is available.
4. The responder presses **End response** to stop sharing. The live location is
   removed, while the station's private response history is retained.

Location pins are individual and unclustered. They are labeled with the station
name, not a responder's name. There is no first-responder anchor and there is no
incident association yet; the current incident UI does not create a shared
incident record.

## Privacy and audiences

- Signed-in Hydro-Scout users can read active public response reports for
  cross-station coordination. These map documents contain a random response ID,
  station ID/name, coordinates, accuracy, update time, and `public: true`; they
  do not contain a responder UID or display name. Anonymous visitors cannot read
  these locations.
- The responder, that station's head, administrators, and users delegated station
  access can read the private `stationResponses` history, which includes the
  responder identity and response times.
- Station notifications are visible to the head and delegated station managers.
  Station access logs are restricted to heads and administrators.
- Each station workspace opening writes an in-app notification and access-log
  entry. Response and membership notifications are in-app only; push notifications
  are not configured.
- Consent is remembered in the browser's local storage. Firestore rules validate
  account assignment and response transitions, but cannot verify the local consent
  record. Do not treat client-side consent storage as server-side consent evidence.

The browser attempts a fresh location immediately when a response starts and
approximately every three minutes thereafter. A page suspension, closed browser,
device sleep, permission denial, or network loss can stop updates. This is
best-effort web reporting, not guaranteed background or off-duty tracking. See
[location consent and reporting limits](location-consent.md).

The map hides a location after its last successful update becomes older than
`NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES` (15 minutes by default). When a
manager's station response listener observes a stale active response, it closes
that response, clears the active-response pointer and removes the live location.
The response history remains.

## Firestore collections

| Collection | Contents | Read access |
| --- | --- | --- |
| `stations/{stationId}` | Admin-managed station ID, name, active flag | Public station directory |
| `stations/{stationId}/unitLocations/{reportId}` | Station GPS reports and active responder map positions | Active response reports are signed-in-readable; private station reports are restricted to their owner and station managers |
| `stationJoinRequests/{uid}` | Requested station and review status | Requesting user and station managers |
| `stationResponses/{responseId}` | Private responder identity, station and start/end history | Responder, station head/delegates, administrators |
| `stations/{stationId}/notifications/{id}` | Membership, response, and station-access notices | Station head/delegates, administrators |
| `stations/{stationId}/accessLogs/{id}` | Who opened station activity and when | Station head and administrators |

The nested `unitLocations` collection contains both location workflows. Legacy
station-account reports retain `updatedBy` and any existing `deviceId` and remain private;
active response reports use `public: true` and omit responder identity so the
map can query them with a `unitLocations` collection-group query. The root
`unitLocations` and `responseLocations` collections were migration sources;
their existing documents have been copied or verified and the root collections
are currently empty. Keep the legacy root rules until the updated rules are
deployed and older app versions are no longer in use.

To move existing root documents, first inspect the proposed copy:

```powershell
node scripts/migrate-unit-locations.mjs --project hydro-scout
```

After reviewing the dry-run totals and preparing valid application-default
credentials for that project, perform the additive copy:

```powershell
node scripts/migrate-unit-locations.mjs --project hydro-scout --apply
```

The migration skips destination documents that already exist, sanitizes copied
response reports to exclude identity fields, and never deletes root documents.
Verify the nested records and deploy compatible app/rules before considering a
separate cleanup of the old collections. The additive migration was run against
`hydro-scout` on 2026-10-23: two legacy `unitLocations` reports were copied and
verified; the root `responseLocations` collection contained no documents. After
explicit confirmation, both root `unitLocations` reports were deleted in a
transaction after verifying their nested copies. The root `unitLocations`
collection is now empty. The updated app and rules have not been deployed.

## Configuration and validation

The existing `hydro-scout` project uses the `(default)` Standard edition
Firestore database. The admin-managed station directory must contain active
entries before they appear in the sign-up selector. Current station IDs accept
1–128 ASCII letters, digits, underscores, or hyphens.

Run client-side and rules tests with Node 24 and Java 21:

```powershell
node --test test/location-consent.test.mjs test/unit-location.test.mjs test/unit-location-reporting.test.mjs test/unit-location-expiry.test.mjs test/map-unit-location.test.mjs
npx.cmd -y firebase-tools@latest emulators:exec --only firestore --project demo-station-responses "node test/station-response-rules.test.mjs"
npx.cmd tsc --noEmit --incremental false
npx.cmd eslint app/src/components/StationResponseControl.tsx lib/auth-context.tsx lib/unit-location.ts test/station-response-rules.test.mjs
```

The emulator suite covers station membership signup and approval, response
start/end batches, cross-station map visibility, and responder-name privacy. The
Firestore rules and application changes are local until explicitly deployed.
Do not deploy the rules or application without deployment approval.

There is no fixed station-coordinate pin, responder clustering, or shared
incident record in this implementation. Browser background location is
best-effort; guaranteed background location requires a native mobile component.
