# Station account profiles

Personal profiles remain at `users/{uid}`. A station login's profile is stored
at `stations/{stationId}/accounts/{uid}` so a station can have multiple
accounts without placing login data on its public directory document.

`stationAccountIndex/{uid}` contains only the station ID. The client and
Firestore rules use it to find the station profile by authenticated UID. Only
the account owner and authorized administrators can read the index; only
administrators can write it. A station profile contains the station name,
email, station assignment, and an empty AOR list; it has no personal role.
Station logins receive fixed station-operations access, without system-admin
access. Their password is set by the administrator and may be changed in
Account Center.

To inspect existing station profiles before migrating:

```powershell
node scripts/migrate-station-accounts.mjs --project hydro-scout
```

After reviewing the dry run and deploying the application and Firestore rules
that understand this structure, copy and verify the profiles while retaining
the original `users/{uid}` documents:

```powershell
node scripts/migrate-station-accounts.mjs --project hydro-scout --apply
```

Only after confirming the new application and rules are in use, the source
profiles may be removed with the separate destructive option. The script
re-verifies each destination and checks that its source has not changed before
deleting that source:

```powershell
node scripts/migrate-station-accounts.mjs --project hydro-scout --apply --delete-source
```

Do not run the destructive option until the new application and rules have
been deployed and the migrated account paths have been checked.
