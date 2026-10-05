// Shared display dimensions for the hydrant pin images, used by both the
// Mapbox and MapLibre markers so the two providers match.

export const HYDRANT_ICON_WIDTH = 34;
export const HYDRANT_ICON_HEIGHT = 44;

// Black outline + drop shadow so pins stand out against any map background.
export const HYDRANT_PIN_FILTER =
  'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) ' +
  'drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black) ' +
  'drop-shadow(0 3px 4px rgba(0,0,0,0.5))';

// Preserve status colors while adding an outer AOR cue for station users.
export const OWN_AOR_PIN_FILTER =
  HYDRANT_PIN_FILTER + ' drop-shadow(0 0 4px #14b8a6)';

export const OTHER_AOR_PIN_FILTER =
  HYDRANT_PIN_FILTER + ' drop-shadow(0 0 4px #8b5cf6)';
