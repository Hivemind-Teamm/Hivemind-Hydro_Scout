# Firestore read optimization

This audit covers the station-account, response tracking, presence, and notification work on `feature/station-account-user-tracking`. The estimates below describe application requests. Firebase Usage remains the source of truth for billed operations because listeners, security-rule dependent reads, reconnects, and cache state affect billing.

## Confirmed high-priority findings

| Severity | Area | Root cause | Change |
| --- | --- | --- | --- |
| Critical | Station incident assignment feed | `useAssignedIncidents` called `/api/incidents` every five seconds even when no incident was assigned. Each request verifies the station account and queries incidents. A continuously open station account could initiate 17,280 polls per day and roughly 69,000 document reads before location writes. | Idle accounts now poll once per minute. An assigned incident restores the five-second emergency interval. Every GPS write remains independently protected by Firestore Rules. |
| Critical | Limited-role notifications | The dashboard header and notification panel each mounted `useStationNotifications`. General and authorized accounts could therefore schedule duplicate server feed polling. | The dashboard now owns one notification feed and passes it to both consumers. |
| Critical | Notification read receipts | `GET /api/notifications` performed one point read for every possible receipt, including missing documents. A 100-item feed could bill 100 receipt reads every poll. `POST` rebuilt the complete feed before saving one private receipt. | GET uses one bounded receipt query. POST verifies the session and a session-bound receipt token, then writes the viewer-owned receipt without rebuilding the feed. |
| High | Notification polling | Limited-role activity was rebuilt every 15 seconds even though fire incidents already arrive through the signed-in real-time fire-pin listener. | The feed refreshes every five minutes and immediately on focus or return to a visible tab. |
| High | Unbounded notification history | Station notifications, responses, pending requests, and receipt listeners loaded their complete history after every reconnect. | Activity, pending requests, responses, and receipts now have explicit limits. Recent responses are ordered by start time. |
| High | Station response history | Heads/admins listened to every response ever created even though the component only uses active responses for roster and stale-response handling. | The response-control query now requests active records only. |
| Medium | Station-account approval feed | Station accounts could not open member approvals but still subscribed to pending approval requests. | Station accounts no longer start the pending-request listener. |
| High | Duplicate profile reads | Location consent opened another live listener to the signed-in user's profile even though `AuthProvider` already watches and exposes the station assignment. | Consent now reuses the authenticated profile state. |
| Medium | Station directory subscription | `StationResponseControl` subscribed to the complete station directory only to obtain the current station name. | It now reuses `stationName` from `AuthProvider`. |
| Medium | Abandoned presence sessions | Opening Station Members queried every presence session for the station, including stale sessions left by interrupted tabs. | The query now excludes sessions older than the presence expiry window. |

## Remaining quota risks

These require a second optimization pass because they affect older Hydro-Scout features or need a larger product/data decision:

- `useHydrants` loads the full hydrant collection in every browser. This is required by the current all-markers map, but marker/detail separation or viewport queries may become necessary as the dataset grows.
- `useReports` opens an unbounded collection-group listener as soon as the dashboard mounts, even when Reports is closed. The overlay and operations dashboard currently depend on the full array, so this needs a lightweight pending-summary design plus on-demand history.
- `useUsers` and Admin Dashboard load broad user, station-account, and presence feeds. They mount only on the admin surface, but pagination and one shared station-directory store are needed before the account count grows.
- Presence writes once per minute per open tab. This is below the Spark write quota for four accounts by itself, but abandoned browser tabs and additional devices multiply it. Reliable disconnect-aware presence would require a larger architecture change; Firestore alone does not provide on-disconnect writes.
- Limited notifications still use a server-filtered polling endpoint to avoid exposing management details. A future sanitized real-time collection could remove polling while keeping role-based disclosure.

## Development diagnostics

Set `NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS=true` only in local development. The browser console will count listener starts, snapshots, cleanup, returned document counts, and limited-feed requests. Diagnostics never log UIDs, profile data, or coordinates.

Invocation counters help find duplicate client work; they do not equal billed reads. Compare the same test window in Firebase Console Usage after the daily quota has reset.

## Four-account comparison procedure

1. Close every Hydro-Scout tab and wait until old sessions stop reconnecting.
2. Record the Firestore read/write totals and test start time in Firebase Console Usage.
3. Open one browser per test account and sign in once.
4. Leave all four dashboards idle for 15 minutes. Confirm there is no active incident assignment.
5. Navigate between the map and account panels. Open/close Station Activity and Station Members ten times and confirm diagnostic listener start/stop counts remain paired.
6. Pin one fire incident, start and end one response, and confirm the other signed-in maps receive the incident.
7. Open hydrant details three times, edit one authorized hydrant, then open Reports once.
8. Leave the four dashboards idle for another 15 minutes without refreshing.
9. Record Firebase Usage after metrics settle. Compare it with the same sequence on the prior commit.

Expected code-level differences:

- One station-notification subscription set per account instead of two.
- Idle station assignment checks fall from 180 to about 15 per account during a 15-minute idle window.
- Limited notification timer refreshes fall from about 60 to about 3 per account during a 15-minute window, plus explicit focus/visibility refreshes.
- Opening Station Members does not retrieve presence sessions already older than the expiry window.
- Closing Station Members removes both roster listeners; reopening creates one pair, not an accumulating set.

## Deployment note

The bounded response and presence queries require the composite indexes in `firestore.indexes.json`. Vercel does not deploy these. Run `npm run check:firebase`, then deploy Firestore indexes separately before testing the optimized branch against Firebase.
