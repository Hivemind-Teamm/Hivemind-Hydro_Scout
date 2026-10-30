# Station Areas of Responsibility (AOR)

Hydrant writes are limited to the station whose Area of Responsibility (AOR) contains the hydrant. A Krus na Ligas account cannot pin, edit, report on or manage reports for a hydrant in Laging Handa. Everyone can still **view** every hydrant, and admins are not restricted.

## Who can do what

The AOR station is the account's own station (station accounts) or its assigned station once membership is **approved**. Pending, rejected and station-less accounts have no AOR.

| Action | Admin | Station account / Head | Authorized member | General |
|---|---|---|---|---|
| View hydrants | Anywhere | Anywhere | Anywhere | Anywhere |
| Pin a new hydrant | Anywhere | Own AOR | Own AOR | No |
| Edit status, pressure, photos, notes, maintenance | Anywhere | Own AOR | Operational status only (plus its pressure and history entry), own AOR | No |
| File a damage report | Anywhere | Own AOR | Own AOR | No |
| Resolve, deny or delete a report | Anywhere | Own AOR | No | No |
| Change a hydrant's barangay or location | Yes | No | No | No |
| Delete a hydrant | Yes | No | No | No |
| Change a station's AOR | Yes | No | No | No |

Hydrants with no barangay, or in a barangay that no station covers, are admin-only.

## How it is enforced

- **Boundaries.** [`lib/qc-barangays.json`](../lib/qc-barangays.json) holds all 142 Quezon City barangays (OpenStreetMap, © OpenStreetMap contributors, ODbL), simplified to about 1 m, with each barangay's PSGC code. Regenerate it with `node scripts/build-barangay-boundaries.mjs`.
- **Hydrant barangay.** `hydrants/{id}.barangay` is derived from the hydrant's GPS position, never typed in.
- **Creation is server-side.** `POST /api/hydrants` verifies the session with Firebase Admin, derives the barangay from the coordinates and rejects non-admins outside their station's AOR (403). Firestore rules deny every direct client create, because rules cannot do point-in-polygon tests and a client could otherwise self-declare an in-AOR barangay.
- **Edits and reports use Firestore rules.** `hydrantAccess()` in [`firestore.rules`](../firestore.rules) compares the **existing** hydrant's barangay with `stations/{stationId}.aorBarangays`. Non-admins cannot change `barangay` or `location`, so a hydrant can never be moved into an AOR. The profile and station are read once, because a hydrant edit plus its activity notice share Firestore's 1,000-expression budget per request.
- **UI.** `useAuth().canWriteInAor(barangay)` mirrors the rules. It hides Edit/Report, photo options and Resolve/Deny outside the AOR, dims other-AOR pins on the map, and shows the barangay plus an AOR warning in the pin form. The UI is a convenience; the server and rules are the barrier.

The per-account `aorBarangays` profile field is no longer used for access.

## Initial AORs (BFP Quezon City sheet)

| Station | Barangays |
|---|---|
| Paligsahan | Kalusugan, Kristong Hari, Paligsahan, Roxas |
| Central | Central, Old Capitol Site, Teachers' Village West |
| Krus na Ligas | Krus na Ligas, U.P. Campus, U.P. Village, Botocan, San Vicente, Teachers' Village East |
| Laging Handa | Kamuning, Laging Handa, Obrero, Sacred Heart, South Triangle |

"Roxas District" on the sheet is the barangay officially named **Roxas**. These lists are offered as one-click presets ([`lib/station-aor.ts`](../lib/station-aor.ts)) when the station's name contains Paligsahan, Central, Krus na Ligas or Laging Handa.

## Rollout (after deploying)

Until both steps are done, non-admins cannot edit any hydrant, because no station has an AOR and existing hydrants have no barangay.

1. Sign in as an admin, open **System Administration → Areas of Responsibility**, and select **Assign barangays to N hydrants**. Use **Review changes** first to check them.
2. For each of the four stations, select it, choose **Use BFP sheet for …**, and **Save AOR**.
3. Confirm: as a Krus na Ligas account, a U.P. Campus hydrant shows Edit; a Laging Handa hydrant shows "outside your station's area of responsibility".

Firestore rules deploy through `.github/workflows/firebase-deploy.yml` on push to `main`; no new indexes are needed. Per the production guardrails, check `GET /api/health` and a real login on the Vercel preview.

## Known limits

- OpenStreetMap boundaries are community-maintained and may differ slightly from official city maps. Barangay borders often run along street centrelines, where hydrants stand: 17 of the 48 surveyed hydrants are within 15 m of a border. Check border cases on site. An admin can correct a hydrant's barangay.
- 16 of the 48 surveyed hydrants (for example in Pinyahan, Loyola Heights and Sikatuna Village) are outside these four AORs, so they stay admin-only until the stations covering them are given AORs.

## Tests

```bash
node --test test/station-aor.test.mjs           # boundaries, presets, mirrors of the rules (no emulator)
firebase emulators:exec --only firestore,auth "node --test test/station-aor-rules.test.mjs test/aor-rules.test.mjs test/sub-admin-aor-rules.test.mjs test/rbac.test.mjs test/map-activity-rules.test.mjs"
# End-to-end API test: see the header of test/hydrant-create-api.test.mjs (needs a dev server on the emulators).
```
