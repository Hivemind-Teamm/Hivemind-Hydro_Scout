This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

For live station reporting and stale-icon checks, see the
[station location testing guide](docs/station-location-testing/README.md).

For consent setup, withdrawal and browser background-reporting limits, see
[location consent instructions](docs/location-consent.md).

Admins can open **Admin Dashboard > Build Version Log** to view the
running version and record a frozen production build with optional notes. Each
record retains the build ID, source commit, source working-tree status, build
time, server-confirmed freeze time (displayed in Philippine time), and admin UID.
New records also include a deployment link and release summary. The deployment link defaults
to the current site; use a permanent deployment URL when available. Older
records display missing details as "Not recorded" and remain unchanged.
Records are shared through the existing Firestore database and cannot be edited
or deleted through the app. A freeze records a baseline; it does not archive
the deployment or snapshot live data. Build details are admin attestations,
not cryptographic verification of the deployed artifact.

Deploy the updated `firestore.rules` with the application before using this
feature. A production build requires the Git checkout or
`VERCEL_GIT_COMMIT_SHA` to identify its source; development previews cannot
record freezes. The first entry is created when an admin selects
**Record frozen build**; no historical freeze date is assumed.

### How to record a frozen build

1. Finish the changes your team wants to include. If this is a new release,
   run `npm.cmd version patch --no-git-tag-version` to increase the version
   (for example, `0.1.1` to `0.1.2`). This updates both package files.
2. Commit and push the changes, including `package.json` and
   `package-lock.json` if the version changed. Wait for the production
   deployment to finish.
3. Open the deployed app, sign in as an **Admin**, and open
   **Admin Dashboard > Build Version Log**. Check the running version and commit.
4. Review the deployment link (use the permanent URL for that deployment when
   available), enter a release summary, and optionally add freeze notes.
5. Click **Record frozen build**. Wait for the success message and confirm
   the entry appears in the history table with its freeze date and time.

Each build can be recorded once. Records are permanent and visible to all
admins. Keep the recorded deployment available and use it for the relevant
evaluation sessions. Recording a freeze does not create an app or database
backup. The button is disabled when running `npm run dev`.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
