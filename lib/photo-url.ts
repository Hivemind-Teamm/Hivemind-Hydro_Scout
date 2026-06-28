// lib/photo-url.ts
//
// Rewrites a Cloudinary delivery URL into a same-origin proxy URL
// (/api/photo) so the raw res.cloudinary.com link is never exposed in the
// DOM and the image can only be loaded from within the site itself — the
// proxy rejects direct navigation / hotlinking (see app/api/photo/route.ts).
//
// Non-Cloudinary values (e.g. local blob: previews, relative asset paths) are
// returned unchanged so upload previews keep working before they're saved.

const CLOUDINARY_RE = /res\.cloudinary\.com\/[^/]+\/(.+)$/;

export function proxiedPhotoUrl(url: string | undefined | null): string {
  if (!url) return '';
  const match = url.match(CLOUDINARY_RE);
  if (!match) return url; // not a Cloudinary URL — leave as-is
  return `/api/photo?p=${encodeURIComponent(match[1])}`;
}
