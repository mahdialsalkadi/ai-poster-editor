import type { DesignDoc } from '@poster/core';

export type SnapAxis = 'x' | 'y';

export type SnapLine = { axis: SnapAxis; position: number };

export type SnapTargets = { xs: number[]; ys: number[] };

export type Bounds = { left: number; top: number; width: number; height: number };

export type SnapResult = { dx: number; dy: number; guides: SnapLine[] };

function layerHeight(layer: DesignDoc['layers'][number]): number {
  return 'height' in layer ? layer.height : 0;
}

/**
 * Edges and centers that a dragged layer can align to: the artboard's own
 * edges and middle, plus every other visible layer. Hidden layers never attract
 * a drag, and the moving selection is excluded so a layer cannot snap to itself.
 */
export function collectSnapTargets(doc: DesignDoc, excludeIds: readonly string[]): SnapTargets {
  const excluded = new Set(excludeIds);
  const xs = [0, doc.width / 2, doc.width];
  const ys = [0, doc.height / 2, doc.height];

  for (const layer of doc.layers) {
    if (layer.hidden || excluded.has(layer.id)) continue;
    xs.push(layer.left, layer.left + layer.width / 2, layer.left + layer.width);
    const height = layerHeight(layer);
    ys.push(layer.top);
    if (height > 0) ys.push(layer.top + height / 2, layer.top + height);
  }

  return { xs, ys };
}

function nearest(targets: readonly number[], value: number, threshold: number): number | null {
  let best: number | null = null;
  let bestDistance = threshold + 1;
  for (const target of targets) {
    const distance = Math.abs(target - value);
    if (distance <= threshold && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

/** Snaps one edge or center to the closest target within `threshold`. */
export function snapEdge(
  targets: readonly number[],
  value: number,
  threshold: number,
): number | null {
  return nearest(targets, value, threshold);
}

/**
 * Finds the smallest translation that aligns any of the bounds' three x edges
 * and three y edges with a target. Each axis snaps independently and reports
 * the guide line that was matched.
 */
export function snapBounds(bounds: Bounds, targets: SnapTargets, threshold: number): SnapResult {
  const guides: SnapLine[] = [];
  let dx = 0;
  let dy = 0;

  const xEdges = [bounds.left, bounds.left + bounds.width / 2, bounds.left + bounds.width];
  let bestX: { delta: number; line: number } | null = null;
  for (const edge of xEdges) {
    const line = nearest(targets.xs, edge, threshold);
    if (line === null) continue;
    const delta = line - edge;
    if (!bestX || Math.abs(delta) < Math.abs(bestX.delta)) bestX = { delta, line };
  }
  if (bestX) {
    dx = bestX.delta;
    guides.push({ axis: 'x', position: bestX.line });
  }

  const yEdges = [bounds.top, bounds.top + bounds.height / 2, bounds.top + bounds.height];
  let bestY: { delta: number; line: number } | null = null;
  for (const edge of yEdges) {
    const line = nearest(targets.ys, edge, threshold);
    if (line === null) continue;
    const delta = line - edge;
    if (!bestY || Math.abs(delta) < Math.abs(bestY.delta)) bestY = { delta, line };
  }
  if (bestY) {
    dy = bestY.delta;
    guides.push({ axis: 'y', position: bestY.line });
  }

  return { dx, dy, guides };
}
