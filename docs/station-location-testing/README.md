# Testing live station locations

## Setup

1. Install dependencies with `npm ci` and run `npm run dev`.
2. Use localhost or HTTPS and allow browser location access.
3. Use an admin-provisioned station account whose `users/{uid}` profile has
   `accountType: "station"` and a valid `stationId`. Its role alone does not make
   it a station account. See [the location contract](../unit-locations.md).
4. Sign in as an admin in a separate browser profile or on a second device to
   observe reports independently. Admins see all stations; station accounts see
   their own. Avoid signing another device into the same station during testing:
   the latest report from either device replaces the shared station position.

## Normal reporting

- Login or reload the station app: a successful browser location capture publishes
  a fresh report. Click its pin to check the last reported time and accuracy.
- Keep the station app visible and online for at least three minutes. The report
  timestamp should advance, even if the coordinates stay unchanged.
- Hide the station tab or close its browser. Updates should stop. Keep the admin
  observer open to watch expiry independently.
- Return to the station tab, reload it, or restore connectivity. A new successful
  report should appear without logging out. Resume requests within ten seconds of
  the previous request are coalesced.

## Quick stale-timeout test

Temporarily set this in `.env.local`, then restart the development server:

```env
NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES=1
```

1. Login or reload the station app and allow location access.
2. In the admin observer, find the station and open its detail card. Note its
   last reported timestamp.
3. Close or hide the station app so it cannot refresh its report. Leave the admin
   observer visible.
4. One minute after the last report, its pin, open card, and station cluster badge
   should disappear automatically. Hydrants remain visible. A cluster badge stays
   if that cluster still contains another fresh station.
5. Reload the admin observer: the expired position must remain hidden.
6. Reopen or resume the station app. After a successful location capture, the pin
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

## Environment setting

The exact variable is **`NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES`**. The name
`NEXT_PUBLIC_LOCATION_TIMEOUT_MINUTES` is not used by the application.

This is an optional configuration override, not exclusively a testing setting.
The built-in default is 15 minutes, so leaving `=15` or removing the setting has
the same effect. Positive values up to 1440 minutes are supported; invalid values
fall back to 15 minutes. Keep `.env.local` out of Git.

## Map interactions

- Click a station: the map zooms in and opens its detail card at the lower left
  on desktop or as a bottom sheet on mobile.
- Zoom out: nearby stations appear as small building badges on hydrant clusters.
  The bubble number counts hydrants only. Expand the cluster to restore pins.
- Close the card, click the background or a hydrant, or press Escape to dismiss
  station details.
