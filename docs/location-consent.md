# Location consent and background reporting

## Configure the notice

Set the actual responsible organization and privacy contact in `.env.local` (or
the deployment environment), then restart development or rebuild production:

```env
NEXT_PUBLIC_LOCATION_PRIVACY_CONTROLLER=Your responsible organization
NEXT_PUBLIC_LOCATION_PRIVACY_CONTACT=Your privacy officer contact details
```

These are public notice fields. Supply real details, not placeholder values.
The consent button is currently enabled while these details are pending
configuration. Declining still permits use of the map.

The notice follows the information categories described by the
[NPC right-to-be-informed guidance](https://privacy.gov.ph/the-right-to-be-informed/)
and links to [RA 10173](https://privacy.gov.ph/data-privacy-act-/). It discloses
purpose, collected fields, recipients, actual storage behavior, device/browser
limits, withdrawal and data-subject rights. It is not a certification of legal
compliance. The controller must review the notice and establish its retention
and privacy-request procedures before operational deployment.

All signed-in dashboard roles (admin, authorized, head, and general) can view
all station reports. The October 9, 2026 notice version requires a new consent
choice for this expanded audience before station reporting resumes.

## Consent behavior

- Explicitly marked station accounts see the notice before automatic GPS capture
  or station publishing. Existing browser location permission does not imply
  consent to station sharing.
- Allowing saves an electronic choice with UID, station ID, notice version and
  decision timestamp in this browser's local storage. No GPS coordinates are
  stored in the consent record. Browser location permission is still required.
- Declining leaves automatic device location and station publishing disabled.
  The map and manually selected map locations remain usable.
- The persistent **Location privacy** button reopens the notice for review or
  withdrawal. Withdrawal cancels pending captures and stops new reporting;
  previously stored reports remain until replaced or administratively deleted.
- Choices are per account, station, browser and notice version. A changed
  station assignment or notice version requires a new decision. Storage events
  synchronize choices across tabs using the same browser profile.
- If browser storage fails, consent cannot be granted. Decline/withdrawal still
  stops sharing for the current session; a failed saved withdrawal may not persist
  across reloads. Revoke the site's browser location permission as well in that case.
- Consent records are client-side preferences, not a central audit log. Firestore
  access rules still enforce station assignment; this change adds no server-side
  consent enforcement or automatic location deletion.

## Background reporting limits

After consent, the root auth provider attempts a fresh report every three minutes
when online, even if the tab is hidden. Focus, visibility changes and reconnection
request a refresh. Concurrent requests are coalesced; logout, withdrawal,
reassignment and unmount cancel the publisher.

This is best-effort web reporting, not a native background GPS service. The
[Geolocation specification](https://www.w3.org/TR/geolocation/) permits acquisition
to wait for a visible document. Browsers can throttle timers and suspend pages.
There is no guarantee of new GPS readings in a hidden tab, with the browser
closed, or during device sleep. No service worker acquires GPS or uploads old
queued samples as fresh reports. Returning to the app captures a fresh position.

The existing 15-minute stale timeout is unchanged. Observers hide the station
when no successful report has refreshed its timestamp in that period.

## Manual testing

1. Configure the real controller/contact above. Use a station account on localhost
   or HTTPS. Remove its `hydroscout-location-consent:<uid>:<stationId>` local-storage
   entry using browser developer tools to test first use.
2. Reload. The app notice must appear before any automatic browser GPS request.
   Decline: the map must remain usable and no station report should be published.
3. Reopen **Location privacy**, allow sharing, then allow the browser's location
   prompt. A new station report should appear. Reload: the saved choice is reused.
4. Keep the page online for three minutes and verify the report time advances.
5. Switch to another tab while watching from a separate admin browser/device.
   If the browser allows background acquisition, reports can continue. If it
   suspends acquisition, the station eventually expires; this is an expected
   browser limitation. Return to the station tab and verify a fresh report.
6. Withdraw consent while a GPS request is pending. That result must not publish.
   Check that updates remain stopped after three minutes. Reload and confirm the
   declined decision persists when storage is available.
7. Change the station assignment, sign into another account or use another browser.
   The previous consent must not authorize the new account/station/browser.
8. Deny browser GPS permission, disable connectivity or block browser storage.
   The app must remain usable and failures must not fabricate a new location.

Run automated tests with Node 24:

```powershell
node --test test/location-consent.test.mjs test/unit-location.test.mjs test/unit-location-reporting.test.mjs test/unit-location-expiry.test.mjs
npx.cmd tsc --noEmit --incremental false
```
