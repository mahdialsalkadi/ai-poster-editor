import { LIMITS, clamp, quantize, type Fill, type GradientStop } from '@poster/core';

export type LinearFill = Extract<Fill, { kind: 'linear' }>;

/**
 * The canonical document clamps and sorts gradient stops; the editor does the
 * same on every edit so the canvas, autosave and export agree. Out-of-order
 * stops are not merely cosmetic: CSS clamps them at paint time, which changes
 * the rendered gradient.
 */
export function normalizeStops(stops: readonly GradientStop[]): GradientStop[] {
  return stops
    .slice(0, LIMITS.gradient.maxStops)
    .map((stop) => ({ color: stop.color, pos: quantize(clamp(stop.pos, 0, 100)) }))
    .sort((a, b) => a.pos - b.pos);
}

/** Inserts a stop in the widest gap so the new colour is visible immediately. */
export function insertStop(stops: readonly GradientStop[]): GradientStop[] {
  const sorted = normalizeStops(stops);
  let index = 0;
  let widest = -1;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (!start || !end) continue;
    const gap = end.pos - start.pos;
    if (gap > widest) {
      widest = gap;
      index = i;
    }
  }

  const start = sorted[index] ?? { color: '#ffffff', pos: 0 };
  const end = sorted[index + 1] ?? { color: start.color, pos: 100 };
  return normalizeStops([
    ...sorted,
    { color: end.color, pos: quantize((start.pos + end.pos) / 2) },
  ]);
}

/** Reverses the colour order by mirroring every stop position. */
export function reverseGradient(fill: LinearFill): LinearFill {
  return {
    ...fill,
    stops: normalizeStops(fill.stops.map((stop) => ({ ...stop, pos: 100 - stop.pos }))),
  };
}
