# Testing live station locations

## Setup

Configure the location privacy notice in `.env.local` with the real responsible
organization and contact, then restart the server (rebuild for production):

```env
NEXT_PUBLIC_LOCATION_PRIVACY_CONTROLLER=Your responsible organization
NEXT_PUBLIC_LOCATION_PRIVACY_CONTACT=Your privacy officer contact details
```

The consent button is disabled until both fields are configured. These values
appear publicly in the notice. Do not commit `.env.local`.

1. Install dependencies with `npm ci` and run `npm run dev`.
2. Use localhost or HTTPS. Accept the app's location consent notice before
   allowing browser location access. Existing browser permission alone does not
   enable station sharing.
3. Use an admin-provisioned station account whose `users/{uid}` profile has
   `accountType: "station"` and a valid `stationId`. Its role alone does not make
   it a station account. See [the location contract](../unit-locations.md).
4. Sign in as an admin in a separate browser profile or on a second device to
   observe reports independently. Admins see all stations; station accounts see
   their own. Avoid signing another device into the same station during testing:
   the latest report from either device replaces the shared station position.

## Normal reporting

- On first use, the station account sees a location consent notice. Declining
  keeps the map usable without automatic GPS capture or station publishing.
- Open **Location privacy**, choose to consent, then allow browser location access.
  The choice is remembered per account, station and browser, with its notice version.

- Login or reload the station app: a successful browser location capture publishes
  a fresh report. Click its pin to check the last reported time and accuracy.
- Keep the station app visible and online for at least three minutes. The report
  timestamp should advance, even if the coordinates stay unchanged.
- Hide the station tab: reporting is attempted in the background where the browser
  permits location acquisition. Browsers may throttle or pause it. Closing the
  browser, sleep or connectivity loss can stop reports; keep the admin observer
  open to watch expiry independently.
- Return to the station tab, reload it, or restore connectivity. A new successful
  report should appear without logging out. Resume requests within ten seconds of
  the previous request are coalesced.

## Consent and withdrawal test

1. Use a station account in a fresh browser profile. Confirm the app notice
   appears before automatic browser location requests.
2. Decline. Verify the map works and no new station report is sent.
3. Reopen **Location privacy**, consent and allow browser GPS permission. Verify
   a fresh station report, then reload and confirm the choice is remembered.
4. Choose **Withdraw consent**. Automatic capture and new publishing must stop,
   including pending GPS results. The existing station report is not deleted;
   its icon disappears when it expires.
5. Reload: withdrawal should persist when browser storage is available. Use another
   station/account/browser to verify the previous consent is not reused.

For storage-error cases and deployment limitations, see
[the consent guide](../location-consent.md).

## Quick stale-timeout test

Temporarily set this in `.env.local`, then restart the development server:

```env
NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES=1
```

1. Login or reload the station app and allow location access.
2. In the admin observer, find the station and open its detail card. Note its
   last reported timestamp.
3. Withdraw consent or close the station app so it cannot refresh its report. Leave the admin
   observer visible.
4. One minute after the last report, its pin, open card, and station cluster badge
   should disappear automatically. Hydrants remain visible. A cluster badge stays
   if that cluster still contains another fresh station.
5. Reload the admin observer: the expired position must remain hidden.
6. Reopen or resume the station app; re-enable consent if you withdrew it. After a successful location capture, the pin
   should return without a new login.

The normal reporting interval is three minutes, so a one-minute test timeout can
also expire a pin between reports while the station app is active. Use the normal
15-minute timeout for regular operation.

After testing, remove the override or restore it to `15`, then restart the dev
server. For a production build, set the value before `npm run build`; changing an
environment file requires rebuilding to update the browser bundle.

## Normal 15-minute expiry test

Publish a report, then close the station browser, put its device to sleep, or
disconnect it. Observe from a separate admin device. The icon should disappear
15 minutes after the last successful report. Reopen/resume the station app with
connectivity and location access to restore it.

## Map interactions

- Click a station: the map zooms in and opens its detail card at the lower left
  on desktop or as a bottom sheet on mobile.
- Zoom out: nearby stations appear as small building badges on hydrant clusters.
  The bubble number counts hydrants only. Expand the cluster to restore pins.
- Close the card, click the background or a hydrant, or press Escape to dismiss
  station details.
