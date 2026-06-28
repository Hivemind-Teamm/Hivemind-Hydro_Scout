// app/api/photo/route.ts
//
// Same-origin image proxy for hydrant photos. The browser requests
// /api/photo?p=<cloudinary-path>; this route streams the bytes from Cloudinary
// without ever exposing the res.cloudinary.com URL to the client.
//
// Access is restricted so the photo can only be viewed *embedded in the site*:
//   • Subresource loads from our own pages send Sec-Fetch-Site: same-origin → allowed.
//   • Opening the link directly in a new tab sends Sec-Fetch-Site: none → blocked.
//   • Hotlinking from another site sends Sec-Fetch-Site: cross-site → blocked.
// For older browsers that omit Sec-Fetch-Site we fall back to a Referer host check.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Only allow standard Cloudinary public image delivery paths, and never let the
// caller traverse outside them.
function isSafePath(p: string): boolean {
  if (p.includes("..")) return false;
  return /^image\/(upload|fetch)\//.test(p);
}

function isSameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";

  // Fallback for browsers that don't send Sec-Fetch-Site.
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  if (!referer || !host) return false;
  try {
    return new URL(referer).host === host;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const path = req.nextUrl.searchParams.get("p");
  if (!path || !isSafePath(path)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud) {
    return new NextResponse("Image delivery not configured", { status: 500 });
  }

  const target = `https://res.cloudinary.com/${cloud}/${path}`;

  try {
    const upstream = await fetch(target);
    if (!upstream.ok || !upstream.body) {
      return new NextResponse("Image not found", { status: upstream.status === 404 ? 404 : 502 });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        // Private so the same-origin gate isn't bypassed via a shared CDN cache.
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[api/photo] proxy fetch failed:", err);
    return new NextResponse("Upstream error", { status: 502 });
  }
}
