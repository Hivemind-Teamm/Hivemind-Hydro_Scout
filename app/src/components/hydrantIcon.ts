// Shared display dimensions for the hydrant pin images, used by both the
// Mapbox markers and the Leaflet markers so the two providers match.

export const HYDRANT_ICON_WIDTH = 34;
export const HYDRANT_ICON_HEIGHT = 44;

// Black outline + drop shadow so pins stand out against any map background.
export const HYDRANT_PIN_FILTER =
  'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) ' +
  'drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black) ' +
  'drop-shadow(0 3px 4px rgba(0,0,0,0.5))';
