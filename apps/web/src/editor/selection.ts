import type { DesignDoc } from '@poster/core';
import { estimatedLayerHeight } from './layers.js';

export type SelectionRect = { left: number; top: number; width: number; height: number };

export function selectionRect(x1: number, y1: number, x2: number, y2: number): SelectionRect {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** Intersect the marquee with each visible, unlocked layer's rotated bounds. */
export function layersInMarquee(
  doc: DesignDoc,
  rect: SelectionRect,
  textHeights: Record<string, number> = {},
): string[] {
  return doc.layers
    .filter((layer) => {
      if (layer.hidden || layer.locked || rect.width === 0 || rect.height === 0) return false;
      const h = textHeights[layer.id] ?? estimatedLayerHeight(layer);
      const angle = (layer.rotation * Math.PI) / 180;
      const width = Math.abs(layer.width * Math.cos(angle)) + Math.abs(h * Math.sin(angle));
      const height = Math.abs(layer.width * Math.sin(angle)) + Math.abs(h * Math.cos(angle));
      const left = layer.left + (layer.width - width) / 2;
      const top = layer.top + (h - height) / 2;
      return (
        left <= rect.left + rect.width &&
        left + width >= rect.left &&
        top <= rect.top + rect.height &&
        top + height >= rect.top
      );
    })
    .map((layer) => layer.id);
}
