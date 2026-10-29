// Station Areas of Responsibility (AOR).
//
// stations/{stationId}.aorBarangays is the source of truth; admins edit it in
// the Admin Dashboard. The presets below are the BFP Quezon City AOR sheet for
// the first four stations, offered to admins as a one-click starting point.
// Names must match lib/qc-barangays.json exactly (test/station-aor.test.mjs).

export interface AorPreset { key: string; label: string; match: RegExp; barangays: string[] }

export const STATION_AOR_PRESETS: AorPreset[] = [
  {
    key: 'paligsahan', label: 'Paligsahan Fire Station', match: /paligsahan/i,
    barangays: ['Kalusugan', 'Kristong Hari', 'Paligsahan', 'Roxas'],
  },
  {
    key: 'central', label: 'Central Fire Station', match: /\bcentral\b/i,
    barangays: ['Central', 'Old Capitol Site', "Teachers' Village West"],
  },
  {
    key: 'krus-na-ligas', label: 'Krus na Ligas Fire Station', match: /krus\s*na\s*ligas/i,
    barangays: ['Krus na Ligas', 'U.P. Campus', 'U.P. Village', 'Botocan', 'San Vicente', "Teachers' Village East"],
  },
  {
    key: 'laging-handa', label: 'Laging Handa Fire Station', match: /laging\s*handa/i,
    barangays: ['Kamuning', 'Laging Handa', 'Obrero', 'Sacred Heart', 'South Triangle'],
  },
];

export function aorPresetFor(stationName: string): AorPreset | null {
  return STATION_AOR_PRESETS.find(preset => preset.match.test(stationName)) ?? null;
}

const STATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Mirrors firestore.rules aorStationId(): own station, or approved membership. */
export function aorStationIdForProfile(profile: {
  accountType?: unknown; stationId?: unknown; stationMembershipStatus?: unknown;
} | null | undefined): string | null {
  const stationId = profile?.stationId;
  if (typeof stationId !== 'string' || !STATION_ID.test(stationId)) return null;
  return profile?.accountType === 'station' || profile?.stationMembershipStatus === 'approved' ? stationId : null;
}

export function readAorBarangays(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** UI mirror of the rules: admins anywhere, everyone else inside their station AOR. */
export function canWriteInAor(role: string | null, aorBarangays: string[], barangay: string | null | undefined) {
  if (role === 'admin') return true;
  return (role === 'authorized' || role === 'head') && !!barangay && aorBarangays.includes(barangay);
}
