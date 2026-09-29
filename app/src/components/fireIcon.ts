// Shared visuals for the fire pin and its supply line, used by both the Mapbox
// (JSX markers) and MapLibre (DOM markers) providers so the two match. Marker
// styling lives in globals.css under "Fire pin".

// Material "local_fire_department" flame (Apache 2.0), 24×24 viewBox.
export const FLAME_PATH =
  'M12 12.9l-2.13 2.09c-.56.56-.87 1.29-.87 2.07C9 18.68 10.35 20 12 20s3-1.32 3-2.94c0-.78-.31-1.52-.87-2.07L12 12.9z' +
  'M16 6l-.44.55C14.38 8.02 12 7.19 12 5.3V2S4 6 4 13c0 2.92 1.56 5.47 3.89 6.86-.56-.79-.89-1.76-.89-2.8 0-1.32.52-2.56 1.47-3.5L12 10.1l3.53 3.47c.95.93 1.47 2.17 1.47 3.5 0 1.02-.31 1.96-.85 2.75 1.89-1.15 3.29-3.06 3.71-5.3.66-3.55-1.07-6.9-3.86-8.52z';

export const FIRE_COLOR = '#f97316';
export const SUPPLY_LINE_COLOR = '#0ea5e9';

// Map-layer paint for the search radius and the hydrant → fire supply line.
export const FIRE_RADIUS_FILL_OPACITY = 0.1;
export const FIRE_RADIUS_LINE_DASH = [2, 1.5];
export const SUPPLY_LINE_DASH = [1.5, 1.2];

/** DOM version of the fire pin, for MapLibre's `Marker({ element })`. */
export function createFirePinElement(): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'fire-pin';
  root.title = 'Fire location — drag to adjust';
  root.innerHTML =
    '<span class="fire-pin-pulse"></span>' +
    '<span class="fire-pin-pulse fire-pin-pulse-late"></span>' +
    '<span class="fire-pin-core">' +
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${FLAME_PATH}"/></svg>` +
    '</span>';
  return root;
}

/** DOM version of the supply-line distance pill. */
export function createSupplyLabelElement(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'fire-supply-label';
  el.textContent = text;
  return el;
}
