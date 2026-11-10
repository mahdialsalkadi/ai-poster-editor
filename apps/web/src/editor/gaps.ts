import type { Layer } from '@poster/core';

export type GapBadge = {
  axis: 'x' | 'y';
  /** Gap size in document units. */
  value: number;
  /** Document-space rectangle spanning the gap, used to draw the badge. */
  left: number;
  top: number;
  width: number;
  height: number;
};

type Box = { left: number; top: number; width: number; height: number };

function boxOf(layer: Layer): Box {
  return {
    left: layer.left,
    top: layer.top,
    width: layer.width,
    height: 'height' in layer ? layer.height : 0,
  };
}

function spans(from: number, to: number, otherFrom: number, otherTo: number): boolean {
  return from < otherTo && to > otherFrom;
}

/**
 * Reports the two gaps around a dragged layer when they are equidistant, which
 * is what makes a Canva-style "equal spacing" hint trustworthy: the badge is
 * only drawn while both neighbours exist and the gaps differ by at most
 * `threshold`. Neighbours are restricted to layers that overlap the moving box
 * on the perpendicular axis, so unrelated layers elsewhere on the artboard
 * cannot produce a misleading measurement.
 */
export function equalSpacingBadges(
  layers: readonly Layer[],
  moving: Box,
  excludeIds: readonly string[],
  threshold: number,
): GapBadge[] {
  const excluded = new Set(excludeIds);
  const others = layers
    .filter((layer) => !layer.hidden && !excluded.has(layer.id))
    .map((layer) => boxOf(layer));
  const badges: GapBadge[] = [];
  const middleX = moving.left + moving.width / 2;
  const middleY = moving.top + moving.height / 2;

  if (moving.height > 0) {
    let leftEdge = Number.NEGATIVE_INFINITY;
    let rightEdge = Number.POSITIVE_INFINITY;
    for (const box of others) {
      if (!spans(box.top, box.top + box.height, moving.top, moving.top + moving.height)) continue;
      const right = box.left + box.width;
      if (right <= moving.left) leftEdge = Math.max(leftEdge, right);
      if (box.left >= moving.left + moving.width) rightEdge = Math.min(rightEdge, box.left);
    }
    const gapLeft = moving.left - leftEdge;
    const gapRight = rightEdge - (moving.left + moving.width);
    if (
      Number.isFinite(gapLeft) &&
      Number.isFinite(gapRight) &&
      gapLeft > 0 &&
      gapRight > 0 &&
      Math.abs(gapLeft - gapRight) <= threshold
    ) {
      badges.push(
        {
          axis: 'x',
          value: Math.round(gapLeft),
          left: leftEdge,
          top: middleY,
          width: gapLeft,
          height: 0,
        },
        {
          axis: 'x',
          value: Math.round(gapRight),
          left: moving.left + moving.width,
          top: middleY,
          width: gapRight,
          height: 0,
        },
      );
    }
  }

  if (moving.width > 0) {
    let topEdge = Number.NEGATIVE_INFINITY;
    let bottomEdge = Number.POSITIVE_INFINITY;
    for (const box of others) {
      if (!spans(box.left, box.left + box.width, moving.left, moving.left + moving.width)) continue;
      const bottom = box.top + box.height;
      if (bottom <= moving.top) topEdge = Math.max(topEdge, bottom);
      if (box.top >= moving.top + moving.height) bottomEdge = Math.min(bottomEdge, box.top);
    }
    const gapTop = moving.top - topEdge;
    const gapBottom = bottomEdge - (moving.top + moving.height);
    if (
      Number.isFinite(gapTop) &&
      Number.isFinite(gapBottom) &&
      gapTop > 0 &&
      gapBottom > 0 &&
      Math.abs(gapTop - gapBottom) <= threshold
    ) {
      badges.push(
        {
          axis: 'y',
          value: Math.round(gapTop),
          left: middleX,
          top: topEdge,
          width: 0,
          height: gapTop,
        },
        {
          axis: 'y',
          value: Math.round(gapBottom),
          left: middleX,
          top: moving.top + moving.height,
          width: 0,
          height: gapBottom,
        },
      );
    }
  }

  return badges;
}
