// Shared display dimensions for the hydrant pin images, used by both the
// Mapbox and MapLibre markers so the two providers match.

import { filterCss, glowStep, pinShadowSteps } from '@/lib/pin-filter';

export const HYDRANT_ICON_WIDTH = 34;
export const HYDRANT_ICON_HEIGHT = 44;

// The filter chains live in lib/pin-filter.ts. Map pins bake them into a
// bitmap once (HydrantPinImage.tsx); these CSS strings are the fallback until
// that finishes, and are still used by the Leaflet map and small UI icons.

/** Black outline + drop shadow so pins stand out against any map background. */
export const HYDRANT_PIN_FILTER = filterCss(pinShadowSteps('plain'));

/** Plus a blue outline: hydrant inside the station's own AOR. */
export const OWN_AOR_PIN_FILTER = filterCss(pinShadowSteps('own'));

/** Plus a violet outline: hydrant in another station's AOR. */
export const OTHER_AOR_PIN_FILTER = filterCss(pinShadowSteps('other'));

/** Halo around pins near the OTW route or inside a pinned fire's radius. */
export const pinGlowFilter = (color: string) => filterCss([glowStep(color)]);
