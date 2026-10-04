# Station location on login

## Live map icons

The dashboard subscribes to `unitLocations` with Firestore `onSnapshot` and
renders red fire-station building icons on both Mapbox and MapLibre.
New reports move the existing icon; deleted documents remove it. Station icons
show only the building at rest.
When zoomed out, stations share the clustering index with hydrants. Clusters
containing stations show a small building-logo badge; the full station pins are
hidden until the cluster expands. Bubble counts still count hydrants only, and
station-only groups remain individual station pins.

Clicking an individual station selects the pin with a yellow pulse and
opens a hydrant-style detail card at the lower left on desktop, or a bottom sheet
on mobile, with its station ID, last reported time, accuracy, and coordinates.
The card's header and View on map button zoom to the reported position. Clicking the
same pin again, the map background, a hydrant, the close button, or Escape dismisses
the details. Only one station is selected at a time. Invalid coordinates are ignored.

Existing read permissions apply: admins see all station reports; explicitly
marked station accounts see their own station. Other accounts do not subscribe.
Listeners are removed on unmount, logout, and account or station changes. Listener
errors clear icons and show an unavailable message. The public map does not expose
station locations.

These are the latest reported positions, not continuous GPS tracking or an online
presence indicator: the current publisher still captures one position per login.


After a successful explicit email/password login, the root auth provider reads
the user's profile from the server. An account with
`users/{uid}.accountType == 'station'` and a valid `users/{uid}.stationId`
requests one fresh browser position. It upserts
`unitLocations/{stationId}`, replacing the previous position for that station.
Signup, restored sessions, and token refreshes do not trigger capture.

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
or continuous presence indicator. Positions remain after logout.

Location capture runs independently of navigation and authentication. Denied
permission, unavailable GPS, timeout, invalid coordinates, profile-read failures,
and write failures do not reject login. Failures emit a console warning. Logging
out or starting another login before GPS completes cancels the pending capture.
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
validation applies to both operations. Admins may read/delete; station accounts
may read their own station document. General and anonymous users have no access.
An admin can list all positions; station clients should fetch their document by ID
or query by document ID. Arbitrary collection-wide station queries are denied.

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
node --test test/unit-location.test.mjs
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
