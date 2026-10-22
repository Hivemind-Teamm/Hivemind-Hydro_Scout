# Location consent and active-response reporting

## Configure the notice

Set the responsible organization and privacy contact in `.env.local` or the
deployment environment, then restart development or rebuild production:

```env
NEXT_PUBLIC_LOCATION_PRIVACY_CONTROLLER=Your responsible organization
NEXT_PUBLIC_LOCATION_PRIVACY_CONTACT=Your privacy officer contact details
```

These values appear in the consent notice. Configure real details before
operational use and do not commit `.env.local`. The notice follows the information
categories described by the [NPC right-to-be-informed guidance](https://privacy.gov.ph/the-right-to-be-informed/)
and links to [RA 10173](https://privacy.gov.ph/data-privacy-act-/); it is not a
certification of legal compliance. The controller must establish retention and
privacy-request procedures before operational deployment.

## Consent behavior

- Only an approved, station-linked personal account can start a response.
  Signing in or receiving station approval does not itself request location or
  share a position.
- Before **Start responding** can capture GPS, the responder must accept the
  location notice and allow browser location permission. The choice is stored in
  local storage by account, station, and notice version. Consent does not contain
  coordinates and is not a central audit record.
- Declining prevents response start. Withdrawing consent during an active response
  stops future updates and removes that response's current map location. It does
  not automatically end the response; use **End response** to record the end.
- If browser storage is unavailable, a grant cannot be saved. A decline or
  withdrawal still disables sharing for the current session, but may not persist
  after reload.
- Consent is client-side state. Firestore rules enforce approved membership and
  response ownership/state but cannot verify the browser's local consent choice.
  Do not represent this preference as server-verified consent evidence.

## Collected data and recipients

During an active response, the app sends this device's latitude, longitude,
accuracy, update time, station ID, and station name to Firestore. Signed-in users
can read the active station-labeled map location for cross-station coordination.
The map location does not include the responder's UID or name. The responder,
station head, administrators, and delegated station managers can read the private
response history, including responder identity and start/end times. Station heads
and delegated managers receive in-app notifications; no push notification service
is configured.

Ending a response removes its map location and retains its private station
history. A location that receives no successful update is hidden after the
configured stale timeout (15 minutes by default); stale active responses are
closed when observed by the station manager's response listener. Map/routing
features may also send coordinates to Mapbox or the routing provider configured
by the app.

The consent notice version is maintained in `lib/location-consent.ts`. Each
browser/device must make its own choice. Use the persistent **Location privacy**
control to review or withdraw consent.

## Browser reporting limits

The app captures a fresh location when a response starts and attempts updates
approximately every three minutes while the page is active or resumed. Focus,
visibility restoration, and reconnection can trigger another attempt. Browser
timers may be throttled, and geolocation may require a visible page. There is no
guarantee of acquisition when the browser is closed, the device is asleep, the
page is suspended, or connectivity is unavailable. This is not guaranteed
background or 24/7 tracking; a native background-location component would be
needed for that behavior.

## Manual testing

1. Configure the controller and privacy contact. Create an active station
   directory entry in the Admin Dashboard.
2. Sign up with that station selected. Verify that Station Activity shows a
   pending request; approve it as that station's head.
3. Sign in as the approved personal account. Decline the notice and verify that
   **Start responding** does not publish a location.
4. Open **Location privacy**, consent, and allow browser location permission.
   Start a response and verify that the map displays a station-labeled pin.
5. Observe from another signed-in account. Verify the pin is visible without the
   responder's name; verify the station head can see the private response history.
6. Withdraw consent. Verify updates stop and the pin disappears. Consent again
   while the response is still active and verify that the location is recreated;
   then end the response and verify that its history remains.
7. Close/suspend the responder page or disable connectivity. Verify the stale
   location expires and station management closes the stale active response.
8. Deny browser GPS permission or block browser storage. The app must show a
   useful error and must not fabricate a position.

See [station response testing](station-location-testing/README.md) for emulator
and focused test commands.
