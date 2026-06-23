
export const DILIMAN_CENTER = {
  lat: 14.6530,
  lng: 121.0680,
};

export const DEFAULT_ZOOM = 15;

// Diliman AOR boundary traced from the Google Maps district outline.
// Follows: Central Ave (north), C-5/Katipunan (east), E. Rodriguez (south),
// EDSA/North-Triangle diagonal (west). Coordinates in [lng, lat], CCW winding.
export const DILIMAN_AOR: [number, number][] = [
  // NW — Central Ave × EDSA/North-Triangle area
  [121.0280, 14.6555],
  // Northern boundary: along Central Ave going east
  [121.0350, 14.6560],
  [121.0430, 14.6563],
  [121.0510, 14.6565],
  [121.0590, 14.6563],
  [121.0670, 14.6560],
  // NE — Central Ave × C-5/Katipunan
  [121.0758, 14.6558],
  // Eastern boundary: south along C-5/Katipunan
  [121.0762, 14.6480],
  [121.0762, 14.6390],
  [121.0762, 14.6300],
  [121.0762, 14.6210],
  // SE — C-5/Katipunan × E. Rodriguez Sr.
  [121.0760, 14.6172],
  // Southern boundary: west along E. Rodriguez Sr.
  [121.0670, 14.6170],
  [121.0570, 14.6172],
  [121.0470, 14.6178],
  [121.0380, 14.6188],
  [121.0300, 14.6202],
  // SW — E. Rodriguez × western diagonal
  [121.0230, 14.6215],
  // Western boundary: NE diagonal back along EDSA/North-Triangle road
  [121.0235, 14.6310],
  [121.0248, 14.6420],
  [121.0262, 14.6510],
  // close
  [121.0280, 14.6555],
];