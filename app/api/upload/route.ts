// app/api/upload/route.ts
//
// Receives a hydrant photo from the browser (multipart form: `file` +
// `hydrantId`), uploads it to Cloudinary under hydrants/<hydrantId>/, and
// returns the secure URL. The Cloudinary API secret stays server-side.
//
// Only authorized / head / admin users may upload — enforced by verifying the
// signed `session` cookie set in app/api/auth/session/route.ts, then re-reading
// the caller's role from Firestore (the cookie carries no role of its own, so
// it can't be forged into a privileged one).

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { UploadApiResponse } from "cloudinary";
import cloudinary from "@/lib/cloudinary";
import { adminApp } from "@/lib/firebase-admin";

// The Cloudinary SDK relies on Node APIs, so this route must run on Node.
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["authorized", "head", "admin"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Keep the Cloudinary folder path safe — hydrant ids are Firestore doc ids,
// but strip anything that isn't alphanumeric / dash / underscore just in case.
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export async function POST(req: NextRequest) {
  // ── Authorize ──
  // Verify the signed session cookie, then read the role straight from
  // Firestore — never trust a role value supplied by the client.
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  let role: string | null = null;
  if (session) {
    try {
      const app = adminApp();
      const decoded = await getAuth(app).verifySessionCookie(session, true);
      const userDoc = await getFirestore(app)
        .collection("users")
        .doc(decoded.uid)
        .get();
      role = userDoc.exists ? userDoc.data()?.role ?? null : null;
    } catch {
      /* invalid/expired/revoked cookie → treated as unauthenticated below */
    }
  }
  if (!role || !ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Not authorized to upload." }, { status: 403 });
  }

  // ── Validate ──
  const formData = await req.formData();
  const file = formData.get("file");
  const rawId = formData.get("hydrantId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (typeof rawId !== "string" || !sanitizeId(rawId)) {
    return NextResponse.json({ error: "Missing or invalid hydrantId." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image exceeds the 10 MB limit." }, { status: 400 });
  }

  const hydrantId = sanitizeId(rawId);
  const bytes = Buffer.from(await file.arrayBuffer());

  // ── Upload ──
  try {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { folder: `hydrants/${hydrantId}`, resource_type: "image" },
          (err, res) => {
            if (err || !res) reject(err ?? new Error("Upload failed"));
            else resolve(res);
          },
        )
        .end(bytes);
    });

    return NextResponse.json({ url: result.secure_url, publicId: result.public_id });
  } catch (err) {
    console.error("Cloudinary upload failed:", err);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
