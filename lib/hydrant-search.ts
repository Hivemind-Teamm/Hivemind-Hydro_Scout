// Hydrant ID lookup for the map search bar. IDs look like "HYD-010" (field
// hydrants) or "BFP-010" (imported BFP reference inventory), and the same
// number can exist under both. People type them loosely: "HYD-010", "hyd010",
// "h10", "010", "10". The query and each ID are reduced to letters + digits
// and compared by number, so the separator and zero-padding never matter.

export interface HydrantIdMatch<T> {
  hydrant: T;
  /** Same number as the query, and the same prefix if one was typed. */
  exact: boolean;
}

// Longer leading words ("Kalayaan 10") are place searches, not ID prefixes.
const MAX_PREFIX_LETTERS = 4;

// A bare number matching both sets lists field hydrants before BFP reference
// records; other prefixes come after.
const PREFIX_ORDER = ['HYD', 'BFP'];

// Lower is better. Number matches rank above partial ones.
const RANK_EXACT = 0;           // HYD-010, hyd10, h010 → HYD-010
const RANK_SAME_NUMBER = 1;     // 010, 10 → HYD-010
const RANK_OTHER_PREFIX = 2;    // BFP-010 → HYD-010
const RANK_PARTIAL_NUMBER = 3;  // HYD-01 → HYD-010…HYD-019
const RANK_PREFIX_ONLY = 4;     // HYD → HYD-001, HYD-002, …

interface IdParts {
  letters: string;
  digits: string;
}

const normalize = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

const prefixOrder = (letters = '') => {
  const i = PREFIX_ORDER.indexOf(letters);
  return i === -1 ? PREFIX_ORDER.length : i;
};

function splitId(raw: string): IdParts | null {
  const match = /^([A-Z]*)(\d*)$/.exec(normalize(raw));
  return match ? { letters: match[1], digits: match[2] } : null;
}

function parseQuery(query: string): IdParts | null {
  const parts = splitId(query);
  if (!parts) return null;
  // "hydrant 10" means HYD-010; any other word this long is a place.
  if (parts.letters === 'HYDRANT') parts.letters = 'HYD';
  if (parts.letters.length > MAX_PREFIX_LETTERS) return null;
  if (!parts.digits && parts.letters.length < 2) return null;
  return parts;
}

function rankId(id: IdParts, q: IdParts): number | null {
  const samePrefix = id.letters.startsWith(q.letters);
  if (!q.digits) return q.letters && samePrefix ? RANK_PREFIX_ONLY : null;
  if (id.digits && Number(id.digits) === Number(q.digits)) {
    if (!q.letters) return RANK_SAME_NUMBER;
    return samePrefix ? RANK_EXACT : RANK_OTHER_PREFIX;
  }
  if (samePrefix && (id.digits.startsWith(q.digits) || String(Number(id.digits)).startsWith(q.digits))) {
    return RANK_PARTIAL_NUMBER;
  }
  return null;
}

// IDs that aren't letters + digits (e.g. Firestore auto IDs) only match by
// their normalized text.
function rankRawId(id: string, query: string): number | null {
  const n = normalize(id);
  const q = normalize(query);
  if (q.length < 2) return null;
  if (n === q) return RANK_EXACT;
  return n.startsWith(q) ? RANK_PARTIAL_NUMBER : null;
}

/** Hydrants whose ID matches the query, best match first. */
export function searchHydrantsById<T extends { id: string }>(
  hydrants: readonly T[],
  query: string,
  limit = 5,
): HydrantIdMatch<T>[] {
  const q = parseQuery(query);

  const ranked: { hydrant: T; rank: number; num: number; prefix: number }[] = [];
  for (const hydrant of hydrants) {
    const id = splitId(hydrant.id);
    const rank = !id ? rankRawId(hydrant.id, query) : q ? rankId(id, q) : null;
    if (rank !== null) {
      ranked.push({ hydrant, rank, num: id?.digits ? Number(id.digits) : Infinity, prefix: prefixOrder(id?.letters) });
    }
  }
  ranked.sort((a, b) =>
    a.rank - b.rank || a.num - b.num || a.prefix - b.prefix || a.hydrant.id.localeCompare(b.hydrant.id));
  // BFP-010 typed while only HYD-010 exists is still listed, just not tagged.
  return ranked.slice(0, limit).map(({ hydrant, rank }) => ({ hydrant, exact: rank <= RANK_SAME_NUMBER }));
}
