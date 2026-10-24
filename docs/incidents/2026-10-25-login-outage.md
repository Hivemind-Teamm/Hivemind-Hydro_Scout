# Incident: nobody could log in to production (October 2026)

**Status:** Firestore rules and index deployed 2026-10-25. Login fix (firebase-admin 13.10.0) ready on branch `Mark-Barican-patch-3`; resolved once merged to `main`.
**Times:** Philippine time (UTC+8) unless marked.

## What users saw

The login page accepted the email and password, then showed *"Unable to verify your session. Please try again."* (or *"Check your credentials"*). Saved passwords were correct: Firebase recorded the sign-ins. The failure happened afterwards, on the server.

## Root cause

`POST /api/auth/session` could not load Firebase Admin on Vercel:

```
[session] Firebase Admin verification failed: Error: Failed to load external module
firebase-admin-…/auth: Error [ERR_REQUIRE_ESM]: require() of ES Module
/var/task/node_modules/jose/dist/webapi/…
```

- `firebase-admin@14` (added 2026-06-23) depends on `jwks-rsa@4` → `jose@6`, which is ESM-only and is loaded with `require()`.
  Node.js can only do that through "require(esm)" support.
- **Vercel's function runtime does not provide require(esm), even on Node 24.** Locally (Node 24) the same code worked, so nobody could
  reproduce it. It reproduces exactly with `node --no-experimental-require-module`.
- The first fix (PR #19, pin Node 24.x) was based on reproducing the error on Node 20. Production then ran Node 24.21 and still failed
  with the same error; the full Vercel stack trace showed the runtime, not the Node version, was the limit.
- Final fix: `firebase-admin@13.10.0`, whose chain (`jwks-rsa@3` → `jose@4`) ships CommonJS and needs no require(esm).

Every server route that uses Firebase Admin was affected, not just login: photo upload, incidents and notifications.

## Why it surfaced only now (timeline)

| Date | Event |
|---|---|
| 2026-06-23 | `firebase-admin@14` added. Firebase Admin is broken on Vercel from this point on. |
| 2026-06-30 21:14 | Commit `7507c77` guesses at the cause (private-key newlines). It does not fix it. |
| 2026-06-30 21:52 | Commit `51915f1` adds a fallback: if Firebase Admin fails, **decode the JWT without verifying it** and log the user in anyway. The failure is now invisible. |
| 2026-10-23 19:25 | PR #18 (`9006096`) correctly removes that insecure fallback. The hidden failure becomes a hard 401 for every login once deployed. |
| 2026-10-24 03:21 | Firestore rules from `94e0f90` deployed (last rules deploy). |
| 2026-10-24 03:48 | `8c91b45` changes rules and adds an index; neither is deployed. Production app runs `8c91b45`. |
| 2026-10-25 | Reported; diagnosed from the Vercel runtime log. PR #19 (Node pin, 503/401 split, health check, guardrails) merged; production on Node 24.21 still fails with `ERR_REQUIRE_ESM`. |
| 2026-10-25 02:01 | Current Firestore rules published and `reports` index created. |
| 2026-10-25 | Root cause confirmed (no require(esm) on Vercel); firebase-admin pinned to 13.10.0. |

Both June commits were AI-assisted and both changed code before anyone looked at the real error message.

## Second problem found: Firestore rules/index drift

Vercel deploys app code automatically; Firestore rules and indexes are only deployed when someone runs `firebase deploy`.
The live rules matched `94e0f90`, not `8c91b45`, and the live project had **no** composite indexes. Effects:

- **Hydrant status updates by station-linked users fail**: `updateHydrantStatus` writes a `hydrant-updated` activity entry in the same transaction, and the live rules reject that type.
- The personal notifications query (`reports` by `reporterUid` + `createdAt`) needs the missing index.
- Live rules are broader than intended: `stationAccessIds` members can read full station notifications, and report `reporterUid` ownership is not enforced.

## Fix

| Change | Purpose |
|---|---|
| `firebase-admin` `^13.10.0` (was `^14.0.0`) | Root-cause fix: no ESM-only dependency loaded with `require()`. |
| `package.json` `"engines": { "node": "24.x" }` | Same Node major locally, in CI and on Vercel (overrides the dashboard setting). |
| `scripts/check-server-runtime.mjs` (runs before `dev` and `build`) | Fails the build if Node is wrong, Firebase Admin cannot load **with require(esm) disabled** (as on Vercel), or the production service-account key is missing or belongs to another project. A broken build never goes live. |
| `/api/auth/session`: 503 for server faults, 401 for bad tokens | A broken server can no longer look like a wrong password. |
| Login page messages | 503 shows "temporarily unavailable on the server… your password is fine". |
| `GET /api/health` | Public pass/fail check that Firebase Admin loads and its credential works. |
| `npm run check:firebase` | Read-only comparison of live rules and indexes with the repo. |
| `.github/workflows/firebase-deploy.yml` | Deploys rules and indexes on every push to `main` that changes them. |
| `.github/workflows/ci.yml` + `test/production-guardrails.test.mjs` | Every PR checks the Node pin, Firebase Admin loading, the absence of unverified-JWT code, the 503/401 split and the rules deploy workflow. |
| `AGENTS.md` "Production guardrails" | Rules that Claude, Codex, Copilot, Cursor and other agents read before editing. |

## Lessons

1. Read the production error before changing anything. The fix took minutes once the Vercel log line was available.
2. A fallback that hides a failure is worse than the failure. It also opened a security hole (unverified tokens).
3. Reproduce under production's constraints, not just its version. Matching Node 24 was not enough; Vercel's runtime also lacks require(esm). Read the full stack trace (open the log entry), not the truncated list view.
4. Deploy everything that production depends on (app, rules, indexes) from the same commit, automatically.
