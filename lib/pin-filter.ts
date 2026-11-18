// Hydrant pin filter chains as data.
//
// Pins used to carry their outline / AOR ring / shadow as a chain of CSS
// `drop-shadow()` filters. Browsers re-run every pass of that chain for every
// pin on every frame while the map pans or zooms (each marker moves in its own
// composited layer), and the AOR ring alone added four blurred passes per pin,
// which made the station-user map noticeably slower than the admin map.
//
// The chains are described here once. hydrantIcon.ts turns them into the same
// CSS strings as before (used until a pin is baked, and by small UI icons),
// and HydrantPinImage.tsx replays them once on a <canvas> per pin variant so
// map pins render as plain bitmaps with no per-frame filter work.
//
// Pure and import-free so Node can unit-test it directly.

export type ShadowStep = { kind: 'shadow'; dx: number; dy: number; blur: number; color: string };
export type ColorOp =
  | { fn: 'hue-rotate'; deg: number }
  | { fn: 'saturate'; amount: number }
  | { fn: 'brightness'; amount: number }
  | { fn: 'opacity'; amount: number };
export type ColorStep = { kind: 'color'; ops: ColorOp[] };
export type FilterStep = ShadowStep | ColorStep;

/** How a pin relates to the signed-in station's AOR. */
export type PinTone = 'plain' | 'own' | 'other';

const shadow = (dx: number, dy: number, blur: number, color: string): ShadowStep =>
  ({ kind: 'shadow', dx, dy, blur, color });

// Black outline + drop shadow so pins stand out against any map background.
const BLACK_OUTLINE: ShadowStep[] = [
  shadow(1, 0, 0, 'black'), shadow(-1, 0, 0, 'black'),
  shadow(0, 1, 0, 'black'), shadow(0, -1, 0, 'black'),
];
const PIN_SHADOW = shadow(0, 3, 4, 'rgba(0,0,0,0.5)');

// A soft colored outline outside the black one: preserves status colors while
// marking the AOR for station users. It goes before the shadow so the shadow
// itself is not outlined.
const aorOutline = (color: string): ShadowStep[] => [
  shadow(1.2, 0, 0.4, color), shadow(-1.2, 0, 0.4, color),
  shadow(0, 1.2, 0.4, color), shadow(0, -1.2, 0.4, color),
];

export const AOR_TONE_COLOR: Record<Exclude<PinTone, 'plain'>, string> = {
  own: 'rgba(59,130,246,0.75)',    // blue
  other: 'rgba(139,92,246,0.75)',  // violet
};

export function pinShadowSteps(tone: PinTone): ShadowStep[] {
  return tone === 'plain'
    ? [...BLACK_OUTLINE, PIN_SHADOW]
    : [...BLACK_OUTLINE, ...aorOutline(AOR_TONE_COLOR[tone]), PIN_SHADOW];
}

/** Soft halo around pins near the OTW route or inside a pinned fire's radius. */
export const PIN_GLOW_BLUR = 5;
export const glowStep = (color: string): ShadowStep => shadow(0, 0, PIN_GLOW_BLUR, color);

const px = (n: number) => (n === 0 ? '0' : `${n}px`);

export function filterCss(steps: FilterStep[]): string {
  return steps.map(step => step.kind === 'shadow'
    ? `drop-shadow(${px(step.dx)} ${px(step.dy)} ${px(step.blur)} ${step.color})`
    : step.ops.map(colorOpCss).join(' ')).join(' ');
}

function colorOpCss(op: ColorOp): string {
  return op.fn === 'hue-rotate' ? `hue-rotate(${op.deg}deg)` : `${op.fn}(${op.amount})`;
}

const ANGLE_UNIT_DEG: Record<string, number> = { deg: 1, rad: 180 / Math.PI, turn: 360, grad: 0.9 };

/**
 * Parse the subset of CSS filter functions a status `iconFilter` uses
 * (hue-rotate, saturate, brightness, opacity). Returns null for anything else,
 * so the caller keeps the CSS filter instead of baking something different.
 */
export function parseColorOps(css: string | undefined): ColorOp[] | null {
  const source = (css ?? '').trim();
  if (!source) return [];
  const ops: ColorOp[] = [];
  const pattern = /([a-z-]+)\(\s*([-+]?[\d.]+)\s*(deg|rad|turn|grad|%)?\s*\)\s*/gy;
  let consumed = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    consumed = pattern.lastIndex;
    const [, fn, raw, unit] = match;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (fn === 'hue-rotate') {
      // CSS allows a bare number only for zero.
      const perUnit = unit ? ANGLE_UNIT_DEG[unit] : value === 0 ? 1 : undefined;
      if (perUnit === undefined) return null;
      ops.push({ fn, deg: value * perUnit });
    } else if (fn === 'saturate' || fn === 'brightness' || fn === 'opacity') {
      if (unit && unit !== '%') return null;
      ops.push({ fn, amount: unit === '%' ? value / 100 : value });
    } else {
      return null;
    }
  }
  return consumed === source.length ? ops : null;
}

/** Largest distance (CSS px) the chain can paint outside the source box. */
export function filterPadding(steps: FilterStep[]): number {
  // Offsets accumulate along the chain; a drop-shadow's blur length is the
  // Gaussian's σ, which is invisible past 3σ.
  const reach = steps.reduce((sum, step) => step.kind === 'shadow'
    ? sum + Math.max(Math.abs(step.dx), Math.abs(step.dy)) + step.blur * 3
    : sum, 0);
  return Math.ceil(reach) + 1;
}

/** Feature-equivalent 3×3 sRGB matrices from the Filter Effects spec. */
function hueRotateMatrix(deg: number): number[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

function saturateMatrix(v: number): number[] {
  return [
    0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
    0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
    0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v,
  ];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Apply color ops in place to unpremultiplied RGBA bytes (ImageData.data),
 * one op at a time with clamping in between, as the browser does.
 */
export function applyColorOps(data: Uint8ClampedArray, ops: ColorOp[]): void {
  if (!ops.length) return;
  const matrices = ops.map(op => op.fn === 'hue-rotate' ? hueRotateMatrix(op.deg)
    : op.fn === 'saturate' ? saturateMatrix(op.amount) : null);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    let a = data[i + 3] / 255;
    for (let k = 0; k < ops.length; k++) {
      const op = ops[k];
      const m = matrices[k];
      if (m) {
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = clamp01(nr); g = clamp01(ng); b = clamp01(nb);
      } else if (op.fn === 'brightness') {
        r = clamp01(r * op.amount); g = clamp01(g * op.amount); b = clamp01(b * op.amount);
      } else if (op.fn === 'opacity') {
        a = clamp01(a * op.amount);
      }
    }
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
    data[i + 3] = Math.round(a * 255);
  }
}

/** object-fit: contain placement of a natural-size image inside a box. */
export function containRect(naturalW: number, naturalH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  const w = naturalW * scale;
  const h = naturalH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/**
 * Replay a filter chain on a canvas: the pin drawn object-fit: contain in a
 * boxW × boxH box, padded so no shadow is clipped, at `scale` device px per
 * CSS px. Each shadow step is one drop-shadow pass (the previous result plus
 * its shadow underneath, which is exactly what canvas shadows do).
 */
export function renderFilterChain(
  image: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
  steps: FilterStep[],
  boxW: number,
  boxH: number,
  scale: number,
  createCanvas: (width: number, height: number) => HTMLCanvasElement,
): { canvas: HTMLCanvasElement; pad: number } {
  const pad = filterPadding(steps);
  const width = Math.ceil((boxW + 2 * pad) * scale);
  const height = Math.ceil((boxH + 2 * pad) * scale);
  const make = () => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    return { canvas, ctx };
  };
  let cur = make();
  let next = make();

  const fit = containRect(image.naturalWidth, image.naturalHeight, boxW, boxH);
  cur.ctx.imageSmoothingQuality = 'high';
  cur.ctx.drawImage(image, (pad + fit.x) * scale, (pad + fit.y) * scale, fit.w * scale, fit.h * scale);

  for (const step of steps) {
    if (step.kind === 'color') {
      const data = cur.ctx.getImageData(0, 0, width, height);
      applyColorOps(data.data, step.ops);
      cur.ctx.putImageData(data, 0, 0);
      continue;
    }
    // Canvas shadow offsets and blur ignore the transform, so scale by hand.
    // CSS drop-shadow's blur length is the Gaussian σ, while canvas
    // shadowBlur is 2σ (verified pixel-for-pixel against Chromium).
    next.ctx.clearRect(0, 0, width, height);
    next.ctx.shadowOffsetX = step.dx * scale;
    next.ctx.shadowOffsetY = step.dy * scale;
    next.ctx.shadowBlur = step.blur * 2 * scale;
    next.ctx.shadowColor = step.color;
    next.ctx.drawImage(cur.canvas, 0, 0);
    [cur, next] = [next, cur];
  }
  return { canvas: cur.canvas, pad };
}
