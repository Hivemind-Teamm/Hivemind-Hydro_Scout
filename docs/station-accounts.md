# Station account profiles

## Login activity status

Personal and station accounts with a live session display `Active now` (green).
Offline accounts explicitly display `Last logged in [date and time] (PHT)` using
`lastLoginAt`, or `Never logged in` when no timestamp exists. A recent login date
alone never marks someone active. Profile popups show membership separately.

`AccountPresenceReporter` runs only for a Firebase-authenticated user with a
loaded account role. Each tab/device writes its own UUID record at
`accountPresenceSessions/{sessionId}` with only `uid`, assigned `stationId` and
server-generated `lastSeenAt`. Heartbeats run once per minute, on focus and on
reconnection. Explicit sign-out attempts to remove that session before identity
is cleared, without blocking an offline logout indefinitely. Other devices keep
their own records. Closed/crashed/disconnected sessions stop counting after
three minutes (plus the UI's up-to-one-minute refresh interval). Suspended browser
tabs may also age out until they resume; this is connected app presence, not a
guarantee that a person is looking at the screen.

Only owners may create/update their own presence, with the current assigned
station and request-time timestamp. Admins can read the directory; station heads
and existing station delegates can read same-station presence. General users
can read only their own sessions. Presence never grants permissions. No location,
IP address or device fingerprint is stored. The `uid`/`stationId` index supports
same-station profile lookups. Stale documents are ignored by freshness checks;
administrators may remove them as maintenance. Existing login timestamp writes
and token/session verification are unchanged.

Presence rules/indexes must deploy before other accounts can report their live
status. The verified current account can immediately display its own active
session. Focused presence audit:

```json
{ "score": 5, "summary": "Tested own-session writes, authoritative station/timestamps, immutable owner, cross-station privacy, independent tabs/devices and stale-session expiry. Presence does not affect authorization.", "findings": [] }
```

## Station members panel

Station Members, Member Approvals and Station Activity use the Account Settings
header color (`#e0353b`) in both themes.

Station accounts, heads and admins with an assigned station can open **Station
Members** from the header's members icon on desktop or mobile. The adjacent
check-mark icon remains **Member Approvals**, with its independent unread count.
Activity, approvals and the roster are mutually exclusive panels.

The searchable roster reads existing personal profiles assigned to the current
station, showing name, role, active/last-login status and active response status.
Selecting a row opens its profile. Pending/rejected requests and station sign-in
accounts are excluded. Legacy manually assigned personal profiles without an
approval flag remain visible because their station assignment is authoritative.
No duplicate roster or access-log record is written. Removed/reassigned members
disappear from the list and any open profile. Opening the roster marks no
notification read and grants no account-edit, removal or reassignment controls.

Roster queries, presence and response subscriptions are station-scoped and covered
by existing manager/admin read permissions. Tests verify public visitors,
ordinary members and other-station heads cannot issue these roster queries.
No additional rules or indexes are needed for this panel.

## Profile storage

The admin's Manage Accounts table supports name ordering, ascending/descending
access tiers, most recent login and newest account creation. Tier order is
General, Authorized, Head/Station, Admin; station accounts retain their fixed
head-equivalent operations tier. Sorting does not change permissions and applies
after the existing role/search filters. Station Directory supports name ordering,
recent station-account login and latest station-account creation. Where a station
has several logins, its date ordering uses the most recent matching timestamp.
Missing dates sort last; ties use names and IDs consistently.

Personal profiles remain at `users/{uid}`. A station login's profile is stored
at `stations/{stationId}/accounts/{uid}` so a station can have multiple
accounts without placing login data on its public directory document.

`stationAccountIndex/{uid}` contains only the station ID. The client and
Firestore rules use it to find the station profile by authenticated UID. Only
the account owner and authorized administrators can read the index; only
administrators can write it. A station profile contains the station name,
email, station assignment, and an empty AOR list; it has no personal role.
Station logins receive fixed station-operations access, without system-admin
access. Their password is set by the administrator and may be changed in
Account Center.

When an administrator assigns a personal account to a station or changes its
station assignment, the destination station's activity feed receives an
in-app notification with the admin email, account name, and destination station
ID. Station heads for that station can see the notification; the assignment
and notification are written together.

All activity cards are clickable and open notification details. Both the admin
and edited-account names in an assignment notification still link to profile
cards. Opening a notification or either profile marks that update read. Member
request cards open the requester's profile; approval/rejection buttons remain
independent actions. Unread activity rows and main notification icons display
red count badges (shown as `99+` above 99); the icon clears after all its entries
are read. Membership-request unread state is separate from approval status.
Read state is stored per viewer/station in Firestore, with browser storage as a
fallback. Logging out and back in must not restore dots on already-read events.
Another device signed into the same account receives those read receipts; another
account has its own independent state. Deploy the read-receipt rules with the app.

Receipts live at `stations/{stationId}/notificationReads/{uid}/items/{receiptId}`.
Only the viewing account can read or write its receipts, and it must still be
a station head or admin. A receipt references an existing notification or
same-station request and its creation timestamp. A new event version is unread.
Receipts cannot change the source notification or membership approval status.

## Notification access by role

| Viewer | Visible notifications | Detail level |
| --- | --- | --- |
| Head, station account, admin | Full assigned-station activity and member approvals | Actor/account links, response history and management fields; approval actions |
| Approved authorized personal member | Assigned-station hydrant pins/updates, fire pins, start/end responses, plus own updates | Generic event summary, hydrant/pin location, station, status and event times; no other people's names, profiles, emails, GPS heartbeat or management identifiers |
| General user, pending/rejected member, unassigned account | Own report and membership status updates only | Own outcome, hydrant ID and event time; no station operations or other accounts |

Delegated station access does not grant full notification details or member
approval controls. Direct reads of raw station notifications and management
read receipts are restricted to station heads and admins. Other roles use the
authenticated `/api/notifications` endpoint: it resolves the viewer's profile
on every request, scopes all queries to that station/UID and constructs an
explicit safe-field projection before sending data to the browser. It does not
send raw event messages, actor identities or administrative event categories.

Limited feeds refresh every 15 seconds while the page is visible and on focus.
They include up to 100 recent station events and the viewer's 100 most recent
reports. Reads persist under `users/{uid}/notificationReads/{eventVersionHash}`
through a same-origin, authenticated endpoint; only currently visible event
versions may be marked read. Browser/session read state is a fallback. A new
outcome has a new read identity; logging in again does not restore read dots.

New reports carry the creator's verified `reporterUid`, which cannot be changed
by later report edits. Legacy reports without an owner UID are deliberately
excluded from personal notifications; names/emails are not used to guess
ownership. Existing report-submission permissions are unchanged.

Deploy the rules and additive report-query indexes with the application:

```powershell
npx.cmd -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes --project hydro-scout
```

Focused access audit:

```json
{ "score": 5, "summary": "Limited notifications use server-side station/owner selection and an explicit field allowlist. Tested revoked membership, delegated access, administrative/identity exclusion, report ownership and event versions. Raw management notifications stay restricted to heads/admins.", "findings": [] }
```

## Live response notification cards

Station-associated accounts also publish a station activity entry when pinning
a hydrant or placing a fire incident. Entries include the actor, server time,
and coordinates; hydrant entries also include the hydrant ID. Hydrant creation
and its entry are atomic. Moving/restoring an existing fire pin does not publish
another entry. Unassigned accounts have no destination station feed.

Notification colors describe the category: hydrant pins brown, hydrant updates
blue, fire incidents orange, active responses cyan, ended responses slate,
account assignments purple, and membership activity pink. Active responses
retain their yellow animated glow as a separate ongoing-status indicator.
Report resolved/pending/denied colors remain
green/yellow/red. Hydrant update colors do not depend on pressure status.
Unread indicators remain red and independent of these event colors.

Both notification panels appear above hydrant full details with a dimmed
backdrop. Opening a panel does not mark its items read.
Fire incident notification cards with valid saved coordinates mark the update
read, close the activity panel and fly the map to the original pin location.
This navigation does not create a new incident or move the user's current fire
pin. Historical notifications without usable coordinates still open details.
Shared fire markers are visible across stations to all signed-in accounts; public
visitors cannot read them. See [shared fire map pins](shared-fire-pins.md) for
ownership, clear/move behavior and deployment requirements.

Deploy the updated `firestore.rules` before using pin activity against the live
database. Map events are create-only and restricted to authorized actors in
their own station; actor identity and event time are checked against Auth and
the profile/server time. Hydrant events must match a newly created hydrant's
coordinates in the same transaction. A fire event records a planning pin; it
does not create or assign a dispatch incident.

Focused map-activity rules audit (not an audit of unrelated existing rules):

```json
{ "score": 5, "summary": "Tested map activity rules reject spoofed actors, cross-station writes, invalid coordinates, edits, deletes, and replayed hydrant creation notices. Hydrant/notice writes are atomic.", "findings": [] }
```

Responses share one daily card per station, based on the response's start date
in Philippine time. One person is named directly; two people show both names;
three or more show the first name and `N others`. Distinct people are counted
once in the title, while repeat responses remain separate detail entries.
All-active/all-ended groups say `started response`/`ended response`; mixed groups
say `updated their response status`. Limited-role summaries never include names.
An overnight response remains in its start-day group until ended. Historical
entries missing timestamps remain individual rather than receiving invented dates.

The daily card glows yellow while any response in it is active, independently
of read status. It stops glowing when all responses end. Reduced-motion users
get a static yellow highlight. Opening a daily card reveals an expandable list;
expanding each personnel entry marks only that entry's current event version read.
Opening the group alone does not mark all personnel read. New updates arriving
while the group is open remain unread until their entries are viewed again.

Cards show the station, start date/time, end date/time or ongoing status, and
duration. Details also include the last location-report time, response ID and
ending account when recorded. Times are labeled as Philippine time (PHT).
Missing historical fields are shown as not recorded rather than fabricated.

The feed groups immutable start/end/closure events by `responseId` and reconciles
them with the authorized station response history. Existing historical events
therefore also appear as one card without migrating stored records. The latest
source event remains the read-receipt identity: an end/closure update can become
unread again until viewed, while GPS heartbeats do not reset read state. Daily
group IDs are presentation keys and are never written as read receipts. No data
migration or rule/index changes are needed for this grouping. The group badge
counts unread response entries; the main activity badge counts unread response
entries plus other unread activity. Each view decreases the corresponding count.
Member approval icon counts independently track unread pending requests.

```powershell
npx.cmd -y firebase-tools@latest deploy --only firestore:rules --project hydro-scout
```

Focused receipt rules tests cover ownership, session persistence, independent
accounts, invalid payloads/timestamps, source versions, revoked station access,
field omissions, cross-station references, deletion and nested-path attempts.
Focused audit scope: account read receipts only, not unrelated application rules.

```json
{ "score": 5, "summary": "No bypass found in the tested per-account notification read-receipt permissions.", "findings": [] }
```

Notifications are in-app only. Users must open the app to see updates; no browser
permission, device registration or notification sender deployment is required.
A station account does not automatically start GPS sharing on login; see
[location workflows and remaining decisions](unit-locations.md).

To inspect existing station profiles before migrating:

```powershell
node scripts/migrate-station-accounts.mjs --project hydro-scout
```

After reviewing the dry run and deploying the application and Firestore rules
that understand this structure, copy and verify the profiles while retaining
the original `users/{uid}` documents:

```powershell
node scripts/migrate-station-accounts.mjs --project hydro-scout --apply
```

Only after confirming the new application and rules are in use, the source
profiles may be removed with the separate destructive option. The script
re-verifies each destination and checks that its source has not changed before
deleting that source:

```powershell
node scripts/migrate-station-accounts.mjs --project hydro-scout --apply --delete-source
```

Do not run the destructive option until the new application and rules have
been deployed and the migrated account paths have been checked.
