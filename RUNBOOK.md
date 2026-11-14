# Thesis timing runbook (T1 / T2)

How to produce the T1 and T2 timings for the thesis on this machine (Windows 11, PowerShell).
The runner is `scripts/perf-runs.mjs`; it drives the app at `http://localhost:3000/dashboard`
(its default) and records the times the app itself measures.

**Rules for the whole session**

- Branch `perf/t1-t2`. Do not push or deploy anything.
- No passwords go in any file or command. You sign in by hand in step 2.
- Do not edit, round or delete anything in `results/`. Failed runs stay in the CSV.
- Each run reloads the dashboard and reads the hydrant collection from Firestore (free plan: 50k reads a day).
  Run each step once, and only repeat a step if it failed.
- During runs, don't touch the Chrome window the script opens. Keep the laptop on mains power and close other heavy apps.

You need two PowerShell terminals:

- **Terminal A** runs the app server.
- **Terminal B** runs the timing script.

In both, start in the project folder:

```powershell
cd "C:\Users\markb\OneDrive\Desktop\Hivemind-Hydro_Scout"
```

---

## 0. Check the source tree is clean (Terminal B)

The real runs refuse to start when there are uncommitted changes, because `results/run_meta.json`
must name the exact commit that was timed.

```powershell
git switch perf/t1-t2
git status --short
```

`git status --short` must print nothing. If it lists files, commit them (do not push), then check again.

## 1. Build and start the app in production mode (Terminal A)

```powershell
npm run build
npm start -- --port 3000
```

`npm run build` first runs the server-runtime check, then builds. It must end without errors.
Wait until `npm start` prints `Ready`. Leave Terminal A open; the server runs until step 6.

Check the server from **Terminal B**:

```powershell
(Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing).Content
```

The output must contain `"ok":true`. If it shows `"ok":false` or fails to connect, stop and fix that first.

## 2. Sign in once with the script's login mode (Terminal B)

```powershell
node scripts/perf-runs.mjs --login
```

A Chrome window opens on the login page.

1. Sign in by hand with an **authorized** account (not head/admin, not a station account) that is not responding to an incident.
2. If a location privacy notice appears, choose **Allow**.
3. Wait for the dashboard map to show.
4. Press **Enter** in Terminal B.

Expected: `Signed-in session saved in .perf-profile/.` The session stays in `.perf-profile/`, which git ignores.

## 3. Trial runs: 2 per measure (Terminal B)

```powershell
node scripts/perf-runs.mjs --trial
node scripts/perf-summary.mjs --trial
```

This does 2 T1 runs and 2 T2 runs, marked `trial` in `results/t1_t2_runs.csv`. Real-run counts and the
real summary ignore them. All four rows should show `OK`. Read any note printed next to a run
(for example "Isochrone API unavailable" or "MapLibre fallback renderer") before going on.

## 4. The real runs: 30 T1 + 30 T2 = 60 (Terminal B)

First run a speed test by hand (for example at speedtest.net in your normal browser) and note download, upload and ping.
Then, filling in your own values:

```powershell
node scripts/perf-runs.mjs --network "Wi-Fi" --speedtest "48 Mbps down / 21 Mbps up, 12 ms"
```

It does all 30 valid T1 runs, then all 30 valid T2 runs, 2 s apart, cycling through start points SP1 to SP6.
A failed run is recorded and redone under the same run number.

If it stops early (for example after 10 failed runs, or a sign-in problem), it prints why. Fix the cause and
run the same command again: it resumes after the valid runs already in the CSV and does not repeat them.

## 5. Summary (Terminal B)

```powershell
node scripts/perf-summary.mjs
```

Prints n, failed runs, mean, SD (sample, n - 1), median, min and max in ms for T1, its parts T1a and T1b, and T2.
Every valid real run is included.

The raw data are in:

- `results/t1_t2_runs.csv`: one row per run, failed runs included
- `results/run_meta.json`: commit, browser, machine, network, definitions and notes for each session

## 6. Stop the server (Terminal A)

Press **Ctrl+C** in Terminal A.
