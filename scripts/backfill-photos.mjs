// backfill-photos.mjs
// One-time importer: links the field photos already uploaded to Cloudinary to
// their hydrant docs in Firestore.
//
// The seed (seed-hydrants.mjs) stored each hydrant's original HEIC filenames in
// `photoFilename` (the main shot) and `additionalPhotos[]`. This script resolves
// those filenames to the matching Cloudinary assets and writes ORDERED delivery
// URLs into the hydrant's `photos` array:
//
//   photos[0] = main photo      → shown on the bottom-left info card
//   photos[1] = additional photo → shown on the full-details card
//
// All field assets are HEIC (browsers can't render that), so the stored URLs use
// Cloudinary's f_auto,q_auto so they're delivered as webp/jpg.
//
// Credentials are read from .env.local (CLOUDINARY_* + FIREBASE_SERVICE_ACCOUNT_KEY).
//
// Run:  node scripts/backfill-photos.mjs            (live write)
//       node scripts/backfill-photos.mjs --dry-run  (report only, no writes)
//
// Safe to re-run: it SETs photos to the resolved array with { merge: true }, and
// skips any hydrant that resolved to zero photos (so it never wipes a doc that
// already has photos — e.g. one added later via the live Edit panel).

import { readFile } from "node:fs/promises";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";

const DRY_RUN = process.argv.includes("--dry-run");
const COLLECTION = "hydrants";

// ── env (.env.local) ──
const env = {};
for (const line of (await readFile("./.env.local", "utf8")).split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY missing from .env.local");
}
initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
const db = getFirestore();

// ── 1. Pull every Cloudinary image, map base filename → public_id ──
let cursor;
const byBase = new Map(); // "IMG_8788" → public_id
do {
  const res = await cloudinary.api.resources({
    resource_type: "image",
    type: "upload",
    max_results: 500,
    next_cursor: cursor,
  });
  for (const r of res.resources) {
    const last = r.public_id.split("/").pop();        // IMG_8788_fht2nh
    const base = last.replace(/_[a-z0-9]{6}$/i, "");  // IMG_8788
    if (/^IMG_\d+$/i.test(base) && !byBase.has(base)) byBase.set(base, r.public_id);
  }
  cursor = res.next_cursor;
} while (cursor);
console.log(`Cloudinary: indexed ${byBase.size} IMG_* assets`);

// HEIC → browser-friendly delivery URL
const deliveryUrl = (publicId) =>
  cloudinary.url(publicId, { secure: true, fetch_format: "auto", quality: "auto" });

// ── 2. For each hydrant, resolve [main, ...additional] in order ──
const records = JSON.parse(await readFile("./scripts/hydrant-data.json", "utf8"));

const skipped = [];
let written = 0,
  photosLinked = 0;

for (const r of records) {
  const filenames = [r.photoFilename, ...(r.additionalPhotos || [])].filter(Boolean);
  const urls = [];
  const missing = [];
  for (const fn of filenames) {
    const base = fn.replace(/\.HEIC$/i, "");
    const pid = byBase.get(base);
    if (pid) urls.push(deliveryUrl(pid));
    else missing.push(base);
  }

  if (missing.length) skipped.push(`${r.hydrantId} (missing ${missing.join(", ")})`);

  if (urls.length === 0) continue; // never wipe a doc to empty

  photosLinked += urls.length;
  if (DRY_RUN) {
    console.log(`${r.hydrantId}: ${urls.length} photo(s)  [main→info card, 2nd→details]`);
  } else {
    await db.collection(COLLECTION).doc(r.hydrantId).set({ photos: urls }, { merge: true });
    written++;
  }
}

console.log(
  `\n${DRY_RUN ? "[dry-run] " : ""}Linked ${photosLinked} photos across ${
    DRY_RUN ? records.filter((r) => byBase.has((r.photoFilename || "").replace(/\.HEIC$/i, ""))).length : written
  } hydrants.`,
);
if (skipped.length) {
  console.log(`\nHydrants with unresolved filenames (left untouched):`);
  for (const s of skipped) console.log("  - " + s);
}
process.exit(0);
