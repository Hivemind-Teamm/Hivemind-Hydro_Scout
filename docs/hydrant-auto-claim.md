# Automatic hydrant claim on arrival

A responder who reaches a hydrant claims it for their fire response without
tapping **Claim**.

## When it claims

All of these must hold:

- The responder has an **active response** to a fire and their role can claim
  hydrants (authorized, head or admin), the same as the Claim button.
- **Location sharing** is on (Location privacy consent and browser permission).
- The hydrant is **operational or reduced pressure**, not claimed by anyone,
  and is either in the fire's hydrant list (the same list the fire panel shows,
  including the 500 m expansion when nothing is within 1 km) or the hydrant the
  responder is routing to.
- The responder does not already hold a claim for this response. Auto-claim
  takes one hydrant per response; more can still be claimed by hand.
- **Two GPS readings at least 5 s apart are both within 5 m** of the hydrant,
  each with a reported accuracy of 15 m or better. Driving past a hydrant
  therefore does not claim it.

Routing to a hydrant **without** an active response does not claim it: every
claim belongs to a fire response, and the server checks that.

The values are constants in [`lib/hydrant-auto-claim.ts`](../lib/hydrant-auto-claim.ts).
Phone GPS is usually accurate to 3–10 m outdoors and hydrant pins have their
own error, so a 5 m radius triggers only when the responder is right at the
hydrant. Raise `AUTO_CLAIM_RADIUS_M` if it proves too strict in the field.

## What happens

The claim goes through `/api/hydrant-occupancy/claim`, the same verified
server API as the Claim button, which checks the role, the active response for
that fire and that nobody else holds the hydrant (in a transaction). No
Firestore rules changed. A notice names the hydrant and offers **Undo**, which
releases it; a hydrant that was released or refused is not tried again for the
same response. Claims are not released when the responder walks away; they
are cleared by **Release**, by ending the response or by clearing the fire.

## Cost and battery

- The GPS loop ([`lib/use-hydrant-auto-claim.ts`](../lib/use-hydrant-auto-claim.ts))
  runs only while the conditions above hold and there is at least one target.
- Checks are spaced by the distance to the nearest target: every 5 s within
  about 100 m, up to once a minute when far away. Readings use a 5 s maximum
  age, so they are shared with the 1 km response location loop.
- Nothing is read from or written to Firestore until a claim is made; each
  claim is one API call, as for the Claim button. The device position is used
  only on the device: the request carries the hydrant and fire IDs, not
  coordinates.

## Testing

```powershell
node --test test/hydrant-auto-claim.test.mjs
```

A field check needs a phone at a real hydrant with an active response. In a
desktop browser, DevTools → Sensors → Location can place the device on a
hydrant's coordinates.
