import {
  LIMITS,
  clamp,
  quantize,
  type DesignDoc,
  type Fill,
  type GradientStop,
} from '@poster/core';

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

export type DocumentColor = { color: string; count: number };

/** Uppercases and trims a hex colour so comparisons never miss `#FfF`. */
export function normalizeColor(color: string): string {
  return color.trim().toUpperCase();
}

function addFillColor(counts: Map<string, number>, fill: Fill): void {
  if (fill.kind === 'solid') {
    const key = normalizeColor(fill.color);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return;
  }
  for (const stop of fill.stops) {
    const key = normalizeColor(stop.color);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}

/** Every colour used by the document, most-used first. */
export function extractDocumentColors(doc: DesignDoc): DocumentColor[] {
  const counts = new Map<string, number>();
  addFillColor(counts, doc.background);

  for (const layer of doc.layers) {
    if (layer.type === 'text') {
      const key = normalizeColor(layer.style.color);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (layer.style.shadow) {
        const shadow = normalizeColor(layer.style.shadow.color);
        counts.set(shadow, (counts.get(shadow) ?? 0) + 1);
      }
    } else if (layer.type === 'shape') {
      addFillColor(counts, layer.style.fill);
      if (layer.style.border) {
        const border = normalizeColor(layer.style.border.color);
        counts.set(border, (counts.get(border) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
}

/**
 * Replaces one colour everywhere it can appear: artboard background (solid and
 * every gradient stop), text colour and text shadow, shape fill stops and
 * borders. Unrelated layers keep their identity so history stays diff-friendly.
 */
export function replaceColorAcrossDoc(doc: DesignDoc, from: string, to: string): DesignDoc {
  const target = normalizeColor(from);
  const replacement = normalizeColor(to);
  if (target === replacement) return doc;

  let changed = false;
  const swap = (color: string): string => {
    if (normalizeColor(color) !== target) return color;
    changed = true;
    return replacement;
  };
  const swapFill = (fill: Fill): Fill =>
    fill.kind === 'solid'
      ? { ...fill, color: swap(fill.color) }
      : { ...fill, stops: fill.stops.map((stop) => ({ ...stop, color: swap(stop.color) })) };

  const background = swapFill(doc.background);
  const layers = doc.layers.map((layer) => {
    if (layer.type === 'text') {
      const color = swap(layer.style.color);
      const shadow = layer.style.shadow
        ? { ...layer.style.shadow, color: swap(layer.style.shadow.color) }
        : undefined;
      return { ...layer, style: { ...layer.style, color, ...(shadow ? { shadow } : {}) } };
    }
    if (layer.type === 'shape') {
      return {
        ...layer,
        style: {
          ...layer.style,
          fill: swapFill(layer.style.fill),
          ...(layer.style.border
            ? { border: { ...layer.style.border, color: swap(layer.style.border.color) } }
            : {}),
        },
      };
    }
    return layer;
  });

  return changed ? { ...doc, background, layers } : doc;
}

/** Applies 0..1 alpha to a hex colour, keeping it an editable 8-digit hex. */
export function withAlpha(color: string, alpha: number): string {
  const base = normalizeColor(color).replace('#', '').slice(0, 6).padEnd(6, 'F');
  const value = clamp(Math.round(alpha * 255), 0, 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `#${base}${value}`;
}

export function colorAlpha(color: string): number {
  const hex = normalizeColor(color).replace('#', '');
  if (hex.length !== 8) return 1;
  return Number.parseInt(hex.slice(6), 16) / 255;
}
