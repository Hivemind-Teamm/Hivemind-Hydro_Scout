# Station account profiles

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
independent actions. Each unread row and
its main notification icon display a red dot; the icon clears after all its rows
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

Each response appears as one live card in Station Activity. Its title is
`[Responder] started response` while active, with an animated yellow glow that
does not depend on whether the notification is read. On response end or management
closure, the same card changes to `[Responder] ended response` and stops glowing.
Users requesting reduced motion get a static yellow highlight while active.

Cards show the station, start date/time, end date/time or ongoing status, and
duration. Details also include the last location-report time, response ID and
ending account when recorded. Times are labeled as Philippine time (PHT).
Missing historical fields are shown as not recorded rather than fabricated.

The feed groups immutable start/end/closure events by `responseId` and reconciles
them with the authorized station response history. Existing historical events
therefore also appear as one card without migrating stored records. The latest
source event remains the read-receipt identity: an end/closure update can become
unread again until opened, while GPS heartbeats do not reset read state. Separate
responses from the same person remain separate cards.

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
