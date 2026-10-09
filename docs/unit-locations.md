# Station live location reporting

## Live map icons

The dashboard subscribes to `unitLocations` with Firestore `onSnapshot` and
renders red fire-station building icons on both Mapbox and MapLibre.
New reports move the existing icon; deleted documents remove it. Station icons
show only the building at rest.
When zoomed out, stations share the clustering index with hydrants. Clusters
containing stations show a small building-logo badge; the full station pins are
hidden until the cluster expands. Bubble counts still count hydrants only, and
station-only groups remain individual station pins.

Positions expire 15 minutes after their Firestore `updatedAt` timestamp. Expired
positions and records without a valid timestamp are hidden from both map providers,
cluster badges, and the station detail card. A timer hides them without requiring
another database update; returning to a background tab rechecks expiry immediately.
A fresh report restores the icon. Documents remain stored in Firestore.
Set `NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES` before building to change the
timeout (positive minutes up to 1440; omitted or invalid values use 15 minutes).

Clicking an individual station selects the pin with a yellow pulse and
opens a hydrant-style detail card at the lower left on desktop, or a bottom sheet
on mobile, with its station ID, last reported time, accuracy, and coordinates.
The card's header and View on map button zoom to the reported position. Clicking the
same pin again, the map background, a hydrant, the close button, or Escape dismisses
the details. Only one station is selected at a time. Invalid coordinates are ignored.

All signed-in dashboard roles (admin, authorized, head, and general) can see all
station reports, without needing a station assignment. Anonymous users and unknown
roles cannot read station reports. Listeners are removed on unmount, logout, and
account or role changes. Listener
errors clear icons and show an unavailable message. The public map does not expose
station locations.

These are the latest reported positions, not a guaranteed online presence indicator.
After explicit location consent, the root auth provider captures a fresh position when a session starts (including
login and restored sessions after reload), then every three minutes while the page
is online. Background tabs attempt updates where the browser permits acquisition.
Focus, visibility restoration, and reconnecting trigger a
fresh report. Concurrent requests are coalesced and resume events within ten
seconds of the previous request are ignored to avoid duplicate GPS requests.
Browser suspension, device sleep, shutdown, and connectivity loss can stop fresh reports;
pins expire 15 minutes after the last successful report. Resuming restores the pin
once a fresh report succeeds. Logout, session replacement, or provider unmount
cancels pending capture and removes timers and event listeners.

Station accounts must opt in through the location privacy notice before capture
or publishing. See [consent setup and testing](location-consent.md). Withdrawal
stops new collection; already stored reports expire from the map normally.


Before each location capture, the root auth provider reads
the user's profile from the server. An account with
`users/{uid}.accountType == 'station'` and a valid `users/{uid}.stationId`
requests one fresh browser position. It upserts
`unitLocations/{stationId}`, replacing the previous position for that station.
Individual accounts (including general-user signup) never request location access.

## F1 integration dependency

The F1 schema is not present in this checkout, including the locally available
`origin/pat` reference. This implementation provisionally uses an admin-assigned
`accountType: 'station'` and `stationId`. Existing `authorized` and `head`
accounts are individual people; those roles alone never trigger location capture.
Confirm this discriminator with Pat when F1 lands; if it differs, update both
`stationIdForLocation` and `isAssignedStation` plus their tests together.

Station IDs currently accept 1–128 ASCII letters, digits, underscores, or hyphens.
The existing `station` display name is not an ID and is never used as a fallback.
Accounts without both station fields are skipped without requesting location permission.
Individual accounts never publish a position, even if assigned a station.

## Document shape

| Field | Type | Meaning |
| --- | --- | --- |
| `stationId` | string | Matches the document ID and the user's assigned station |
| `updatedBy` | string | Firebase Auth UID of the publishing station account |
| `lat`, `lng` | number | Browser latitude/longitude in decimal degrees |
| `accuracy` | number | Browser accuracy radius in meters |
| `updatedAt` | timestamp | Firestore server timestamp |

No placeholder records or fabricated coordinates are seeded. Firestore creates
the collection with the first successful write. Multiple accounts assigned to
one station share its latest-position document; this is not a movement history
or continuous presence indicator. Documents remain after logout, but expired
positions are hidden from the map.

Location capture runs independently of navigation and authentication. Denied
permission, unavailable GPS, timeout, invalid coordinates, profile-read failures,
and write failures do not reject login. Failures emit a console warning. Logging
out or replacing the signed-in session before GPS completes cancels the pending capture.
The browser requires HTTPS (or localhost) and location permission. The coordinates
represent that browser's device, not a fixed fire station address.

## Rules and activation

The existing `hydro-scout` project uses `(default)`, Standard edition. Deploy the
reviewed rules using an authenticated Firebase CLI:

```powershell
npx.cmd -y firebase-tools@latest deploy --only firestore:rules --project hydro-scout
```

Only explicitly marked station accounts can create or update their assigned station's
position. The same field, type, coordinate-range, writer-UID, and server-timestamp
validation applies to both operations. All recognized signed-in roles may read
individual positions and list all positions; only admins may delete positions.
Anonymous users, missing profiles, and unrecognized roles are denied access.

Self-signup is limited to `role: general` and the existing signup fields, closing
the previous ability to self-assign an operational role or station. Admin-managed
profile creation and updates retain their existing permissions.

For a manual end-to-end test before F1, create a dedicated **test station** user
in Firebase Console > Authentication > Users > Add user. Copy that user's UID.
In Firestore Data > `users`, add a document with that exact UID and the fields
`email` (same as Auth), `displayName` (for example, "Station 1 test"),
`role: 'authorized'`, `accountType: 'station'`, and
`stationId: 'station-1'`. Use the string type for all five fields. Do not mark
an existing person's account as a station. The test account's role lets the
current dashboard recognize it; location permission is controlled by the account
type and station ID. Confirm that Pat's F1 schema will use these fields before
relying on this arrangement beyond the test.

After deploying the rules, sign in with the new station account over
HTTPS/localhost on the device whose position should be recorded and allow
location access. Verify its
`unitLocations/{stationId}` document, UID, coordinates, and server timestamp.
Repeat login to verify the same document updates. Deny location permission and
confirm login still works and the previous position is retained.

## Automated checks

```powershell
node --test test/unit-location.test.mjs test/unit-location-reporting.test.mjs test/unit-location-expiry.test.mjs
npx.cmd -y firebase-tools@latest emulators:exec --only firestore --project demo-unit-locations "node test/unit-location-rules.test.mjs"
npx.cmd tsc --noEmit --incremental false
npx.cmd eslint lib/auth-context.tsx lib/unit-location.ts test/unit-location*.mjs
```

Use Node 24 for the TypeScript unit-test import and Java 21 for the emulator.
The emulator test uses a demo project and never seeds production positions.
Existing `test/rbac.test.mjs` predates the current hydrant permissions and has
contradictory expectations; use the focused suite above for this change.

### Rules audit scope

The focused suite covers anonymous listing, unauthorized reads/writes/deletes,
wrong-station writes, writer impersonation, invalid create/update payloads,
field omission, extra fields, invalid types/ranges, oversized IDs, timestamp
spoofing, self-assigned roles/stations, and an allowed signup/admin assignment.
`stationId` is bound to the document path; `updatedBy` intentionally changes when
another authorized account at the same station publishes. No immutable creation
timestamp, nested collection, counter, or state transition exists in this model.
Unmatched subcollections remain denied. This audit is scoped to location access
and the profile permissions on which it depends, not unrelated hydrant rules.

Validation on September 29, 2026: seven unit tests passed; the complete focused
rules suite passed against Firestore emulator 1.22.0, including a position write
through `writeLoginLocation` and verification of the stored server timestamp.
TypeScript and targeted ESLint checks passed. The rules have since been deployed
to `hydro-scout`, and a dedicated test station login wrote
`unitLocations/station-1` on September 30, 2026 (Philippine time). A read-only
check confirmed valid coordinates, accuracy, writer UID, and server timestamp.

Focused rules-auditor result (not a whole-application security assessment):

```json
{
  "score": 5,
  "summary": "No bypass found in the tested unitLocations and station-assignment permissions. F1 contract confirmation remains pending.",
  "findings": []
}
```

Validation on October 9, 2026: TypeScript, targeted ESLint, ten consent/map/expiry
unit tests, and the focused Firestore emulator suite passed. The suite confirms
all recognized signed-in roles can get and list reports, including general users
and accounts assigned to other stations, while anonymous/missing/invalid roles
are denied. Existing station-write, payload validation, deletion, and profile
privilege checks also passed. The notice audience was updated and its version
bumped to `2026-10-09-v2` to require a renewed station consent choice.
Live deployment of this access change is pending Firebase CLI authentication.