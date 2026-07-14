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

export function proxiedPhotoUrl(url: string | undefined | null, width?: number): string {
  if (!url) return '';
  const match = url.match(CLOUDINARY_RE);
  if (!match) return url; // not a Cloudinary URL — leave as-is
  let path = match[1];
  // When a display width is known, chain a Cloudinary transformation for a
  // width-capped (never upscaled), auto-quality/auto-format rendition. The raw
  // field photos are multi-megabyte camera images; decoding those on the main
  // thread visibly stalls phones, and a sized rendition is visually identical
  // at display size for a fraction of the bytes. Pass ~2× the CSS width for
  // retina screens.
  if (width) {
    path = path.replace(
      /^(image\/(?:upload|fetch)\/)/,
      `$1c_limit,w_${width},q_auto,f_auto/`,
    );
  }
  return `/api/photo?p=${encodeURIComponent(path)}`;
}
