# Shared fire map pins

Active fire pins sync through Firestore to every signed-in account, across
stations, on both MapLibre and Mapbox. Public map visitors never subscribe to
or render them; rules reject unauthenticated reads, including direct reads.
Multiple incidents coexist. Selecting one opens local response/hydrant planning;
other pins stay visible. Receiving an update does not unexpectedly move the camera.
General users can view/select map markers; responder roles have the planning panel.

New remote pins received after the first server-confirmed map snapshot show two
one-shot expanding orange rings and play the same descending two-tone chime as
OTW activation. Existing pins on load/login, local creations, position edits and
known pins after reconnection do not replay alerts. Multiple new pins in one
snapshot produce one chime. Arrival timing is client-only and is not stored in
Firestore; switching map providers later does not restart an expired pulse.
Reduced-motion users get a brief static orange highlight instead of expanding
rings. Sound requires browser audio permission/user interaction and an unmuted
tab; old blocked sounds are not queued for later playback. These remain in-app
alerts, with no browser/device push notifications.

The global Pin fire tool creates another shared incident. The selected incident's
Move pin action and marker drag move that incident. Creators, admins, and the
responsible station's head/delegated managers may edit; other responders have
read-only controls. Clearing sets status to `cleared`, removing the pin from all
active map subscriptions while preserving history. Closing details does not clear
the shared incident. Server validation preserves creation time and station, checks
coordinate bounds and prevents reopening cleared records through a client edit.

## Data and privacy

`firePins/{id}` contains only `lat`, `lng`, `stationId`, `status`, `createdAt`,
and `updatedAt`. Its separate immutable `firePinOwners/{id}` document contains
`uid`, `stationId`, and `createdAt`; only the creator, appropriate station managers
and admins can read it. Signed-in general map readers receive no creator identity.
Creation atomically saves the map pin, ownership and the creator station's activity
notification (when a station is assigned). The optional notification `firePinId`
is checked against that new pin and its ownership. Notification visibility stays
station-scoped even though map pins are visible across stations.

This feature is separate from trusted `incidents` dispatch assignments and does
not enable incident dispatch, tracking assignments or off-duty GPS collection.
Old local-storage fire pins are not automatically published as real incidents.
Active shared pins persist across reloads until explicitly cleared; the previous
local 12-hour expiry no longer controls them. Hydrant selections, supply routes,
addresses and panel selection remain local UI state.

Deploy the revised Firestore rules with the app. The active-status and own-owner
queries use default single-field indexes; there is no new fire-pin composite index.

## Verification

`test/shared-fire-pins-rules.test.mjs` covers two authenticated map clients,
live move/clear propagation, multiple pins, public denial, private ownership,
creator/manager/admin edit permissions, malformed data, immutable station/owner,
and atomic pin/notification creation. For UI checks, use two signed-in browsers:
create two pins, select/move/clear one, and switch map providers. Confirm the other
pin remains visible and a signed-out public window shows neither pin.

Focused rule audit:

```json
{ "score": 5, "summary": "Signed-in-only map data, separate private ownership, authoritative station/creator validation, bounded fields, immutable ownership and creation metadata, and explicit edit roles. Tested public denial and cross-client updates.", "findings": [] }
```
# Incident-linked responses

New responses store `firePinId`, `incidentLat`, and `incidentLng`. Starting a
response requires the selected incident to remain active, with matching
coordinates, and no existing active response for that account. Response actions
appear only on an active incident. Each grouped response entry includes the
incident coordinates and a **View in map** action; coordinates remain available
after clearing. Older history without saved coordinates cannot provide this link.

`POST /api/fire-pins/clear` verifies the Firebase session cookie and authoritative
account profile, then checks incident ownership or station-management/admin access.
One Firestore transaction clears the pin, ends its active responses across stations,
clears response pointers, deletes response markers, and creates end notifications.
Offline responders are included. Responses for other incidents remain active.
Unlinked legacy responses end when the final active incident clears. A failed
transaction leaves the incident and responses unchanged; retry is safe.

Client rules deny direct clearing so the cleanup cannot be bypassed. Deploy app
code and these rules together: older clients must refresh after rollout. Verify
preview `/api/health` and an actual login before production rollout.

Scoped security review:
```json
{"score":5,"summary":"Incident-linked starts validate authoritative incident state and coordinates; direct clearing is denied and the verified server transaction enforces cross-station cleanup.","findings":[]}
```
