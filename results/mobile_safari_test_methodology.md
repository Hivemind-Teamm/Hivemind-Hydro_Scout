# Mobile test methodology

## Environment

- **Target:** `hydro-scout-staging-2026` local staging build.
- **Access path:** local server exposed through a Cloudflare Tunnel URL, then opened as `.../dashboard?perf=1`.
- **Device:** physical Apple iPhone 13, iOS 27.2.1.
- **Browser:** Safari.
- **Network:** Wi-Fi.
- **Time zone for observations:** Philippine Time (PHT).

## Collection method

These are manual physical-device observations, not emulator output or automatically captured browser telemetry. The tester completed three runs per applicable test, recorded the three map-load timings, and documented pass/fail observations for responsive layout and search behavior.

`TC-088` has no valid raw timing because the tester was outside the Diliman area of responsibility. It remains `N/A` rather than estimating a result.

## Files

- `mobile_safari_raw_observations.csv` is the row-level observation log used to support the mobile test results.
- The Google Sheet is the summarized test matrix. This CSV preserves the individual run records behind that summary.
