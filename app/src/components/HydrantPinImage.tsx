'use client';

// A hydrant map pin whose outline / AOR ring / shadow / glow are pre-rendered.
//
// The pin's look is a chain of up to 10 `drop-shadow()` passes. As a live CSS
// `filter`, the browser re-runs every pass for every pin on every frame while
// the map moves; on station accounts (AOR ring = 4 extra blurred passes per
// pin) that made panning and zooming visibly slow. Here each variant
// (status × AOR tone × glow) is drawn once on a <canvas> with the same chain —
// canvas shadows have drop-shadow semantics — and every pin of that variant
// shares the resulting bitmap. Until a variant is ready (a few ms after first
// use) the pin renders with the equivalent CSS filter, so nothing pops in.

import { memo, useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { STATUS_META, type HydrantStatus } from '../data/hydrants';
import { HYDRANT_ICON_HEIGHT, HYDRANT_ICON_WIDTH } from './hydrantIcon';
import {
  filterCss, glowStep, parseColorOps, pinShadowSteps, renderFilterChain,
  type FilterStep, type PinTone,
} from '@/lib/pin-filter';

const W = HYDRANT_ICON_WIDTH;
const H = HYDRANT_ICON_HEIGHT;

type Baked = { src: string; pad: number };

function variantSteps(status: HydrantStatus, tone: PinTone, glow: boolean): FilterStep[] | null {
  const meta = STATUS_META[status];
  const colorOps = parseColorOps(meta.iconFilter);
  if (!colorOps) return null; // a filter we can't reproduce exactly: keep CSS
  const steps: FilterStep[] = [...pinShadowSteps(tone)];
  if (colorOps.length) steps.push({ kind: 'color', ops: colorOps });
  if (glow) steps.push(glowStep(meta.color));
  return steps;
}

// ── Module-level bake cache, shared by every pin and both map providers ──────
const baked = new Map<string, Baked>();
const started = new Set<string>();
const listeners = new Set<() => void>();
const imageLoads = new Map<string, Promise<HTMLImageElement>>();

const variantKey = (status: HydrantStatus, tone: PinTone, glow: boolean) => `${status}|${tone}|${glow ? 1 : 0}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  let load = imageLoads.get(url);
  if (!load) {
    load = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${url}`));
      img.src = url;
    });
    imageLoads.set(url, load);
  }
  return load;
}

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve) => {
    if (!canvas.toBlob) { resolve(canvas.toDataURL('image/png')); return; }
    canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png')), 'image/png');
  });
}

async function bakeVariant(status: HydrantStatus, steps: FilterStep[]): Promise<Baked> {
  const img = await loadImage(STATUS_META[status].iconUrl);
  // Render at device resolution (at least 2×) so the bitmap stays crisp.
  const scale = Math.min(4, Math.max(2, Math.ceil(window.devicePixelRatio || 1)));
  const { canvas, pad } = renderFilterChain(img, steps, W, H, scale, (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  });
  return { src: await canvasToUrl(canvas), pad };
}

function requestBake(status: HydrantStatus, tone: PinTone, glow: boolean) {
  const key = variantKey(status, tone, glow);
  if (started.has(key)) return;
  started.add(key);
  const steps = variantSteps(status, tone, glow);
  if (!steps) return;
  bakeVariant(status, steps).then((result) => {
    baked.set(key, result);
    listeners.forEach(listener => listener());
  }).catch((error) => {
    // Keep the CSS-filter pin; it looks the same, just costs more per frame.
    console.warn('[HydrantPinImage] bake failed, using CSS filter:', error);
  });
}

function useBakedPin(status: HydrantStatus, tone: PinTone, glow: boolean): Baked | undefined {
  const key = variantKey(status, tone, glow);
  const result = useSyncExternalStore(subscribe, () => baked.get(key), () => undefined);
  useEffect(() => { if (!result) requestBake(status, tone, glow); }, [result, status, tone, glow]);
  return result;
}

// ── Rendering ────────────────────────────────────────────────────────────────

const bakedImgStyle = (pad: number): CSSProperties => ({
  position: 'absolute',
  left: -pad,
  top: -pad,
  width: W + 2 * pad,
  height: H + 2 * pad,
  maxWidth: 'none',        // Tailwind preflight caps <img> at 100% of the box
  pointerEvents: 'none',   // the W×H box stays the hit target, as before
  userSelect: 'none',
});

function PinBitmap({ status, tone, glow, alt, decorative = false }: {
  status: HydrantStatus; tone: PinTone; glow: boolean; alt: string; decorative?: boolean;
}) {
  const result = useBakedPin(status, tone, glow);
  if (result) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={result.src} alt={decorative ? '' : alt} aria-hidden={decorative || undefined} draggable={false}
        width={W + 2 * result.pad} height={H + 2 * result.pad} style={bakedImgStyle(result.pad)} />
    );
  }
  // Not baked yet (or the bake failed): the original live CSS filter.
  const meta = STATUS_META[status];
  const filter = [
    filterCss(pinShadowSteps(tone)),
    meta.iconFilter ?? '',
    glow ? filterCss([glowStep(meta.color)]) : '',
  ].join(' ');
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={meta.iconUrl} alt={decorative ? '' : alt} aria-hidden={decorative || undefined} draggable={false}
      width={W} height={H}
      style={{ position: 'absolute', inset: 0, width: W, height: H, objectFit: 'contain', pointerEvents: 'none', filter }} />
  );
}

interface HydrantPinImageProps {
  status: HydrantStatus;
  tone: PinTone;
  /** Halo in the status color (near the OTW route / inside a fire radius). */
  glow?: boolean;
  /** Accessible name and hover tooltip. */
  label: string;
}

/**
 * The W×H hydrant pin (filters baked in). Out-of-service pins are the sliced
 * variant; their glow, if any, is applied by the caller around the slice.
 */
const HydrantPinImage = memo(function HydrantPinImage({ status, tone, glow = false, label }: HydrantPinImageProps) {
  if (status === 'out') {
    return (
      <div className="hydrant-slice" title={label} style={{ width: W, height: H }}>
        <div className="half top"><PinBitmap status={status} tone={tone} glow={false} alt={label} /></div>
        <div className="half bot"><PinBitmap status={status} tone={tone} glow={false} alt={label} decorative /></div>
        <span className="cut" />
      </div>
    );
  }
  return (
    <div title={label} style={{ position: 'relative', display: 'block', width: W, height: H }}>
      <PinBitmap status={status} tone={tone} glow={glow} alt={label} />
    </div>
  );
});

export default HydrantPinImage;
