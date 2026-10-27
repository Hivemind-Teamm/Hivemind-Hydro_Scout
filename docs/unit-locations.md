# Station response locations

Documentation reviewed against the checkout on October 24, 2026. Deployment
statements below distinguish recorded past actions from unverified live status.

## BFP requirement and implementation status

The original interview clarification requires automatic sharing by **authorized
BFP accounts associated with a station/substation** while logged in, including
outside incident response, with continued background sharing. The initial audience
is authorized QCFD station/substation users; volunteers are outside that scope.
Locations represent the logged-in device, not a station building or check-in.
They support unit coordination, deployment and selection of suitable hydrants.

The current manual response workflow below does **not** fulfill that automatic
logged-in-sharing requirement. Confirm the intended workflow with BFP before
treating manual response-only tracking as the final requirement. Station logins
and approved personal memberships are implemented account structures; their
implementation does not establish interview approval of that final structure.

| Feature | Current implementation and remaining work |
| --- | --- |
| Station directory, station accounts and membership approval | Implemented |
| Station-labeled positions for active personal responses | Implemented; the responder starts and ends sharing manually |
| Automatic location sharing for logged-in authorized accounts | Not implemented as originally specified |
| Reliable background GPS | Not implemented; current web acquisition is best effort |
| Shared incident creation and dispatch | Partial read/tracking infrastructure; incident-management POST returns `501` |
| Incident-linked station-account tracking | Experimental, development-only; disabled in production |
| Same-truck/unit grouped markers | Not implemented; proposed feature requiring BFP confirmation |
| In-app activity and member approval notifications | Implemented, with per-account persistent read receipts; no alerts outside the app |

**Proposed feature requiring confirmation:** Firefighters assigned to the same
responding truck/unit may be represented by a grouped marker. Separate units
must remain distinguishable even when they belong to the same station. No
specific operational clustering rule was confirmed. The interview clarification
does not establish station check-ins or 24/7 off-duty tracking requirements.

Source: user-provided clarification of the BFP interview and discussion, referencing
`C:\Users\Karl Manangan\Downloads\Interview Respondent\_ BFP (1).pdf`.
The PDF was not independently reviewed for this documentation update.

## Current workflow

Station locations are published by approved personal accounts only while the
responder has an active response. Logging in, being linked to a station, or using
a station account does not start location sharing.

1. An administrator maintains the station directory in the Admin Dashboard.
   Directory entries provide a station ID and display name; create entries before
   users select them at sign-up.
2. A person may select a station during sign-up. This creates a pending membership
   request. A head for that station reviews and approves or rejects it in
   **Member approvals**. Approval assigns the person's station ID; it does not start tracking.
3. With a fire pinned in the current map UI, an approved responder accepts the location notice and presses **Start
   responding**. The app captures an initial location and publishes it with the
   station's label. Updates are attempted every three minutes while the app is
   active/resumed and location access is available.
4. The responder presses **End response** to stop sharing. The live location is
   removed, while the station's private response history is retained.

Location pins are individual and unclustered. They are labeled with the station
name, not a responder's name. There is no first-responder anchor or truck/unit
grouping. This manual response workflow does not associate its response records
with a shared incident; a local fire pin does not create a shared incident record.

## Experimental incident tracking

The checkout also contains a separate station-account incident feed and GPS
controller. `IncidentTrackingStatus` enables it only in development when
`NEXT_PUBLIC_ENABLE_INCIDENT_TRACKING=true`; production builds keep it disabled.
It uses trusted incident assignments and proximity checks. The incident API can
read assignments, but POST returns `501` because incident management is not enabled.

This prototype is separate from the approved personal-account response flow.
It writes incident-linked reports to root `unitLocations`; the normal public
response map reads nested public `unitLocations` reports. Completing incident
creation, map integration, consent verification and production readiness remains
necessary before considering this an operational incident workflow.

## Privacy and audiences

- Signed-in Hydro-Scout users can read active public response reports for
  cross-station coordination. These map documents contain a random response ID,
  station ID/name, coordinates, accuracy, update time, and `public: true`; they
  do not contain a responder UID or display name. Anonymous visitors cannot read
  these locations.
- The responder, that station's head, administrators, and users delegated station
  access can read the private `stationResponses` history, which includes the
  responder identity and response times.
- Full station notifications are visible to the head and administrators.
  Approved authorized station members receive a server-filtered operational
  feed without responder identities or administrative details. Other accounts
  receive only their own membership/report outcomes.
  Station access logs are restricted to heads and administrators.
- Activity and member approval lists use Reports Register-style cards, clickable
  account profiles and numbered unread badges on activity rows and main icons. Opening a linked
  profile marks that row read; opening the list alone does not. Read state is
  saved per account/station in Firestore, so it survives logout and synchronizes
  across devices once the updated read-receipt rules are deployed. Browser storage
  remains an immediate fallback; existing local read choices are migrated.
- Responses share one live daily card per station using the Philippine start
  date, including overnight responses. Titles name one/two people or the first
  person plus N others; mixed active/ended groups say their status was updated.
  Cards glow while any response remains active. Opening a group reveals personnel
  entries with status, timestamps and duration; expanding each entry marks only
  that update read and reduces the group/main icon counts. Immutable lifecycle
  events and existing per-account read receipts remain unchanged.
- Notifications are in-app only. Users must open Hydro-Scout to review activity
  and member approval updates; the app does not send browser or device alerts.
- Access-log paths and permissions exist, but the current UI does not write an
  access log or notification merely because a station panel is opened.
- Consent is remembered in the browser's local storage. Firestore rules validate
  account assignment and response transitions, but cannot verify the local consent
  record. Do not treat client-side consent storage as server-side consent evidence.

The browser attempts a fresh location immediately when a response starts and
approximately every three minutes thereafter. A page suspension, closed browser,
device sleep, permission denial, or network loss can stop updates. This is
best-effort web reporting, not guaranteed background or off-duty tracking. See
[location consent and reporting limits](location-consent.md).

After six minutes without a successful update (two missed three-minute reports),
the map marks the last known location stale with an amber warning. The marker
remains visible until its last successful update becomes older than
`NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES` (15 minutes by default). When a
manager's station response listener observes an active response past that
timeout, it closes the response, clears the active-response pointer and removes
the live location. The response history remains.

## Firestore collections

| Collection | Contents | Read access |
| --- | --- | --- |
| `stations/{stationId}` | Admin-managed station ID, name, active flag | Public station directory |
| `stations/{stationId}/unitLocations/{reportId}` | Station GPS reports and active responder map positions | Active response reports are signed-in-readable; private station reports are restricted to their owner and station managers |
| `stationJoinRequests/{uid}` | Requested station and review status | Requesting user and station managers |
| `stationResponses/{responseId}` | Private responder identity, station and start/end history | Responder, station head/delegates, administrators |
| `stations/{stationId}/notifications/{id}` | Membership, response, and map activity | Raw documents: station head/admins; limited operational projection via authenticated API for approved authorized station members |
| `stations/{stationId}/notificationReads/{uid}/items/{id}` | Management event-version read receipts | Only that account, while it is a station head/admin |
| `users/{uid}/notificationReads/{eventVersionHash}` | Limited-role read receipts | Own account, through the authenticated notifications API |
| `stations/{stationId}/accessLogs/{id}` | Who opened station activity and when | Station head and administrators |
| `incidents/{incidentId}` | Trusted assignments for the experimental incident feed | Server-managed; exposed through the authenticated incident API |

The nested `unitLocations` collection contains both location workflows. Legacy
station-account reports retain `updatedBy` and any existing `deviceId` and remain private;
active response reports use `public: true` and omit responder identity so the
map can query them with a `unitLocations` collection-group query. The root
`unitLocations` and `responseLocations` collections were migration sources;
their migration status is recorded below. Root `unitLocations` is also used by
the experimental incident writer, so historical cleanup is not evidence that it
is empty now. Keep rules compatible with every enabled location workflow.

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
collection was empty at that verification. The recorded rules deployment to
`hydro-scout` occurred on 2026-10-23; that historical deployment does not establish
that later rule changes are deployed. Application changes have been pushed to
`main`. The current Vercel release has not been verified in this documentation
review. A local `.env` change does not update
Vercel; its project owner must configure the deployment environment and redeploy.

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
start/end batches, cross-station map visibility, and responder-name privacy.
The live map also requires the `unitLocations.public` ascending collection-group
index declared in `firestore.indexes.json`. Deploy the indexes and wait for the
index to finish building; emulator tests do not detect a missing production index.
For notification read-state checks, see the
[station testing guide](station-location-testing/README.md). These commands do not by themselves
confirm the currently deployed application or rules.

There is no fixed station-coordinate pin, responder clustering, or shared
incident creation workflow in this implementation. Browser background location is
best-effort; guaranteed background location requires a native mobile component.
