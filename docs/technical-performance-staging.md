# Technical performance staging setup

Use `hydro-scout-staging-2026` for technical-performance tests. It is a separate Firebase project, so test data and P4/P5 writes do not affect Hydro-Scout production. Its Firestore rules and indexes match Hydro-Scout.

## What is needed

Create these files on the computer that will run the tests. Do not send or commit your own files.

1. Sign in with your school account, which already has access to **Hydro-Scout Staging**. This gives access only to the staging Firebase project, not production.
2. Download the dedicated staging-only service-account key from the technical-performance sheet shared for this work. Save it locally as `scripts/stagingServiceAccountKey.json`. Git ignores this file. Do not add the key to a public or finalized sheet.
3. Create `.env.production.local` and add the staging web API key:

```env
NEXT_PUBLIC_STAGING_FIREBASE_API_KEY=replace-with-the-staging-web-api-key
```

The API key identifies the staging web app. The JSON key lets the local server verify logins. Neither file belongs in Git.

## Start the local staging build

Open a new PowerShell terminal at the repository root. Run the following before each test session:

```powershell
$env:FIREBASE_TARGET = 'staging'
$env:NEXT_PUBLIC_FIREBASE_TARGET = 'staging'
$env:FIREBASE_SERVICE_ACCOUNT_KEY = Get-Content 'scripts/stagingServiceAccountKey.json' -Raw
$env:GCLOUD_PROJECT = 'hydro-scout-staging-2026'
$env:GOOGLE_CLOUD_PROJECT = 'hydro-scout-staging-2026'
$env:LOCAL_FIREBASE_EMULATORS = '0'
$env:NEXT_PUBLIC_LOCAL_FIREBASE_EMULATORS = '0'
$env:FIREBASE_AUTH_EMULATOR_HOST = ''
$env:FIRESTORE_EMULATOR_HOST = ''
npm run build
npm start -- -p 3100
```

Then open `http://localhost:3100/api/health`. It should return `{"ok":true}`. The local app is now connected to staging, not production or the emulators.

## Accounts and test data

- `node scripts/seed-staging-test-accounts.mjs` creates or resets staging-only QA accounts and test fixtures. It asks for passwords in the terminal and refuses the wrong Firebase project.
- `node scripts/login-perf-profile.mjs http://localhost:3100/dashboard` opens Chrome and saves a local signed-in test profile. It asks for the account email and password; it does not save them in the repository.

## P4 and P5

Build the P4/P5 runners on this staging target. Save the raw results outside Git and link them in the shared test sheet. Never run concurrent-write tests against production.
