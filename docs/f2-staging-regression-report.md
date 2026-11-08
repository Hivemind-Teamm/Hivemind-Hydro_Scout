# HydroScout F2 — Staging Regression Report

Date: November 8, 2026
Branch: feature/staging-firebase-isolation
Status: PARTIAL — field testing and usage comparison pending

## 1. Test Environment

- Firebase staging project: hydro-scout-staging
- Staging deployment: https://hivemind-hydro-scout-staging.vercel.app
- Station ID: F2_TEST_STATION
- Station AOR: West Kamias, Quezon City
- Test incident: F2_TEST_INCIDENT_001
- Test hydrant: HYD-001
- Hydrant status: Out of Service
- Checking session: F2 TEST ONLY - West Kamias Hydrant Check
- Test data is fictional and must not be used for emergency response.

Production Firebase was not intentionally modified during these tests.

## 2. Automated Regression Results

| Test Suite | Passed | Failed |
|---|---:|---:|
| Wake-lock controller | 7 | 0 |
| Incident-location controller | 29 | 0 |
| Incident-location algorithm | 11 | 0 |
| Unit-location expiry | 6 | 0 |
| Incident-tracking hook | 11 | 0 |
| TOTAL | 64 | 0 |

All five selected automated suites passed after correcting outdated authentication fixtures.

Test correction commit: 7943dc8

## 3. E2 Field Test Matrix

| Test ID | Requirement | Current Result |
|---|---|---|
| E2-01 | Cross 500m incident boundary | Automated PASS; field test pending |
| E2-02 | Close tracking tab and verify marker expiration | Automated PASS; field test pending |
| E2-03 | Auto-lock / screen wake lock | 7 automated tests PASS; physical device test pending |
| E2-04 | Deny browser GPS permission and verify warning | Controller tests PASS; deployed staging test blocked |
| E2-05 | Laptop must never appear as tracking unit | Potential implementation gap; live test pending |
| E2-06 | Public map does not reveal unit locations | PASS for tested anonymous-access scope |
| E2-07 | Hydrant "Occupied by" and GPS accuracy | Potential feature gap; field test pending |

No unperformed field test is marked PASS.

## 4. E2-06 — Public Map Privacy

Observed:
- Public map loaded in Chrome Incognito without login.
- No responder or tracking-unit markers were visible.
- Local Firestore emulator denied anonymous collection reads for:
  - incidentUnitLocations
  - unitLocations
  - stations/F2_TEST_STATION/unitLocations
  - responseLocations
- An unauthenticated HTTP GET to staging Firestore's incidentUnitLocations collection returned HTTP 403.

Result: PASS for the tested anonymous-access scope.

Limitations:
- This does not prove all authenticated access boundaries are correct.
- Direct live staging access was tested for incidentUnitLocations only.
- The local emulator tests validate repository rules, not deployed rules equivalence.

## 5. GPS Configuration

| Setting | Configured Value |
|---|---|
| Incident proximity boundary | 500 meters |
| Maximum accepted GPS accuracy | 50 meters |
| Minimum movement | 10 meters |
| Minimum movement write interval | 5 seconds |
| Heartbeat interval | 30 seconds |
| Incident stale timeout | 90 seconds |
| High-accuracy GPS | Enabled |

The separate general unit-location expiry system has a configurable timeout with a 15-minute default.

These settings must not be confused with observed live field-test results.

## 6. Findings and Blockers

### F2-REG-001 — Outdated Tracking Hook Test Fixtures

Initial result: 2 passed, 9 failed.

Cause:
Test fixtures used outdated role and trustedStationId properties rather than accountType and stationId.

Resolution:
Corrected two authentication fixtures in test/incident-tracking-hook.test.mjs.

Verification:
11 passed, 0 failed.

Status: RESOLVED LOCALLY.
Commit: 7943dc8.

### F2-FIND-002 — Laptop Tracking Eligibility

The reviewed incident-tracking hook checks authentication, station account identity, verified assignment, and browser geolocation availability.

No explicit mobile-only restriction was identified in the reviewed tracking path.

Status: POTENTIAL IMPLEMENTATION GAP.
Live laptop-publishing failure has not been demonstrated.

### F2-BLOCK-003 — Deployed GPS Test Gate

IncidentTrackingStatus.tsx requires development mode and NEXT_PUBLIC_ENABLE_INCIDENT_TRACKING=true.

The deployed staging build displays:
"Incident GPS inactive (test gate off)"

Status: BLOCKED for deployed GPS field tests.
Production safety restrictions must not be removed without approval.

### F2-FIND-004 — Hydrant Occupancy Indicator

HYD-001 and its checking session were successfully created.

The inspected checking data model records checkedByUid and checkedByName but does not establish a distinct live "Occupied by" feature.

Status: POTENTIAL FEATURE GAP.
Live E2-07 occupancy and GPS accuracy checks remain pending.

## 7. Firebase and Map Usage

Before-test observations:
- Firestore staging usage dashboard screenshots captured.
- Early last-24-hour reads displayed 0, with peak listeners 2 and peak active connections 2; reporting may lag.
- Initial Mapbox account dashboard showed 0 web map loads and 0 Directions requests for the viewed period.
- Application displayed a MapLibre fallback when Mapbox was unavailable.

After-test observations:
- PENDING — capture matching Firebase usage reporting periods.
- PENDING — capture Mapbox web map loads and Directions requests.
- PENDING — calculate before/after changes using comparable time windows.

Do not report unmeasured differences as zero.

## 8. Remaining Work

- Obtain an approved staging-only method for field GPS testing.
- Perform E2-01 through E2-05 and E2-07 field checks.
- Confirm actual marker-expiration timing.
- Verify device behavior during physical screen lock.
- Confirm whether hydrant "Occupied by" is an implemented requirement.
- Capture live GPS accuracy where permitted.
- Collect after-test Firestore and Mapbox metrics.
- Submit confirmed bugs with reproduction steps and evidence.
- Finalize the field regression sign-off.

## 9. Overall Assessment

Automated testing: 64 PASS, 0 FAIL across five selected suites.
Anonymous public-map privacy: PASS within tested scope.
Full E2 field regression: NOT COMPLETE.

Production must remain untouched.
