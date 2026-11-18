import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyColorOps, containRect, filterCss, filterPadding, glowStep, parseColorOps, pinShadowSteps,
} from '../lib/pin-filter.ts';

const BLACK = 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)';
const SHADOW = 'drop-shadow(0 3px 4px rgba(0,0,0,0.5))';
const ring = (c) => `drop-shadow(1.2px 0 0.4px ${c}) drop-shadow(-1.2px 0 0.4px ${c}) drop-shadow(0 1.2px 0.4px ${c}) drop-shadow(0 -1.2px 0.4px ${c})`;

test('pin chains reproduce the original CSS filters', () => {
  assert.equal(filterCss(pinShadowSteps('plain')), `${BLACK} ${SHADOW}`);
  assert.equal(filterCss(pinShadowSteps('own')), `${BLACK} ${ring('rgba(59,130,246,0.75)')} ${SHADOW}`);
  assert.equal(filterCss(pinShadowSteps('other')), `${BLACK} ${ring('rgba(139,92,246,0.75)')} ${SHADOW}`);
  assert.equal(filterCss([glowStep('#2fbf4f')]), 'drop-shadow(0 0 5px #2fbf4f)');
});

test('the AOR ring is what made station pins costlier', () => {
  assert.equal(pinShadowSteps('plain').length, 5);
  assert.equal(pinShadowSteps('own').length, 9);
});

test('parses the reference-status icon filter and rejects unknown functions', () => {
  assert.deepEqual(parseColorOps('hue-rotate(100deg) saturate(0.45) brightness(0.82) opacity(0.78)'), [
    { fn: 'hue-rotate', deg: 100 }, { fn: 'saturate', amount: 0.45 },
    { fn: 'brightness', amount: 0.82 }, { fn: 'opacity', amount: 0.78 },
  ]);
  assert.deepEqual(parseColorOps(undefined), []);
  assert.deepEqual(parseColorOps('saturate(50%) hue-rotate(0.5turn)'), [
    { fn: 'saturate', amount: 0.5 }, { fn: 'hue-rotate', deg: 180 },
  ]);
  assert.equal(parseColorOps('blur(2px)'), null);
  assert.equal(parseColorOps('hue-rotate(90)'), null);
  assert.equal(parseColorOps('saturate(1) garbage'), null);
});

test('color ops follow the Filter Effects matrices', () => {
  const px = new Uint8ClampedArray([255, 0, 0, 255, 10, 20, 30, 0]);
  applyColorOps(px, [{ fn: 'saturate', amount: 0 }, { fn: 'opacity', amount: 0.5 }]);
  // Fully desaturated red is its luminance weight (0.213) as gray.
  assert.deepEqual([...px.slice(0, 4)], [54, 54, 54, 128]);
  // Fully transparent pixels are left alone.
  assert.deepEqual([...px.slice(4)], [10, 20, 30, 0]);

  const identity = new Uint8ClampedArray([12, 200, 99, 255]);
  applyColorOps(identity, [{ fn: 'hue-rotate', deg: 0 }, { fn: 'brightness', amount: 1 }]);
  assert.deepEqual([...identity], [12, 200, 99, 255]);
});

test('padding covers the farthest shadow', () => {
  // Shadow alone: 3 px offset + 3σ (σ = 4 px) of blur.
  assert.ok(filterPadding(pinShadowSteps('plain')) >= 15);
  assert.ok(filterPadding(pinShadowSteps('own')) > filterPadding(pinShadowSteps('plain')));
  assert.ok(filterPadding([...pinShadowSteps('own'), glowStep('#fff')]) > filterPadding(pinShadowSteps('own')));
});

test('contain placement matches object-fit: contain', () => {
  const r = containRect(106, 147, 34, 44);
  assert.equal(r.h, 44);
  assert.ok(Math.abs(r.w - 44 * 106 / 147) < 1e-9);
  assert.ok(Math.abs(r.x - (34 - r.w) / 2) < 1e-9);
  assert.equal(r.y, 0);
});
