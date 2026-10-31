// Shared display dimensions for the hydrant pin images, used by both the
// Mapbox and MapLibre markers so the two providers match.

export const HYDRANT_ICON_WIDTH = 34;
export const HYDRANT_ICON_HEIGHT = 44;

// Black outline + drop shadow so pins stand out against any map background.
const BLACK_OUTLINE =
  'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) ' +
  'drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black) ';
const PIN_SHADOW = 'drop-shadow(0 3px 4px rgba(0,0,0,0.5))';

export const HYDRANT_PIN_FILTER = BLACK_OUTLINE + PIN_SHADOW;

// A soft colored outline outside the black one: preserves status colors while
// marking the AOR for station users. It goes before the shadow so the shadow
// itself is not outlined.
const aorOutline = (color: string) =>
  `drop-shadow(1.2px 0 0.4px ${color}) drop-shadow(-1.2px 0 0.4px ${color}) ` +
  `drop-shadow(0 1.2px 0.4px ${color}) drop-shadow(0 -1.2px 0.4px ${color}) `;

export const OWN_AOR_PIN_FILTER =
  BLACK_OUTLINE + aorOutline('rgba(59,130,246,0.75)') + PIN_SHADOW;   // blue

export const OTHER_AOR_PIN_FILTER =
  BLACK_OUTLINE + aorOutline('rgba(139,92,246,0.75)') + PIN_SHADOW;  // violet
