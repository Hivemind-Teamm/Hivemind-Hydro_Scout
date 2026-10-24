<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Production guardrails (read before touching auth, server routes, dependencies or Firebase config)

These rules apply to every contributor and every AI agent (Claude, Codex, Copilot, Cursor, Gemini, ...).
They exist because of a real outage: [docs/incidents/2026-10-25-login-outage.md](docs/incidents/2026-10-25-login-outage.md).

1. **Never make auth "work" by trusting unverified data.** `/api/auth/session` and every server route must verify tokens/cookies with Firebase Admin (`verifyIdToken`, `createSessionCookie`, `verifySessionCookie`). Do not decode JWTs yourself, add a fallback, or return success when Firebase Admin fails. A server fault returns **503**; a bad token returns **401**.
2. **Diagnose production failures from the real error first.** Read the Vercel runtime log (Project → Logs) or `GET /api/health` before changing credentials, env vars or code. Do not guess.
3. **Vercel's runtime cannot `require()` ES modules, even on Node 24.** Server dependencies must load without it. `firebase-admin` is held at 13.x because 14.x pulls in ESM-only `jose` 6 through `jwks-rsa` 4 and fails on Vercel with `ERR_REQUIRE_ESM` (it works locally, so local testing proves nothing). Node.js is pinned by `package.json` `"engines.node"`. Do not upgrade `firebase-admin`/`next` or change `engines.node` unless `scripts/check-server-runtime.mjs` passes and `/api/health` returns ok on the Vercel preview deployment.
3. **Node.js is pinned** by `package.json` `"engines.node"` (Vercel uses it). `firebase-admin` 14 needs Node ≥ 22 and loads ESM-only packages with `require()`. Do not change `engines.node`, or upgrade `firebase-admin`/`next`, without building on that Node version and checking `/api/health` on the Vercel preview deployment.
4. **Keep the checks green; never weaken them to get a build through:** `scripts/check-server-runtime.mjs` (runs before `dev`/`build`), `test/production-guardrails.test.mjs`, and `.github/workflows/ci.yml`.
5. **Firestore rules and indexes are not deployed by Vercel.** `.github/workflows/firebase-deploy.yml` deploys them on push to `main`. A change that needs new rules or indexes must change `firestore.rules`/`firestore.indexes.json` in the same commit. Check for drift with `npm run check:firebase`.
6. **After any change in these areas**, confirm on the Vercel preview: `GET /api/health` returns `{"ok":true}` and a real login reaches the dashboard.
