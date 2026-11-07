import { describe, expect, it } from 'vitest';
import type { DesignDoc, Layer, ShapeLayer, TextLayer } from '@poster/core';
import { collectSnapTargets, snapBounds, snapEdge } from './snap.js';

const WIDTH = 1000;
const HEIGHT = 800;

function docWith(layers: Layer[]): DesignDoc {
  return {
    schemaVersion: 1,
    width: WIDTH,
    height: HEIGHT,
    background: { kind: 'solid', color: '#ffffff' },
    layers,
  };
}

function shape(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  hidden = false,
): ShapeLayer {
  return {
    id,
    name: id,
    type: 'shape',
    left,
    top,
    width,
    height,
    rotation: 0,
    opacity: 1,
    hidden,
    locked: false,
    style: { fill: { kind: 'solid', color: '#ffffff' }, radius: 0 },
  };
}

function text(id: string, left: number, top: number, width: number): TextLayer {
  return {
    id,
    name: id,
    type: 'text',
    left,
    top,
    width,
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
    dir: 'rtl',
    content: [{ kind: 'text', text: 'عنوان' }],
    style: {
      fontFamily: 'Cairo',
      fontSize: 48,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: '#ffffff',
      align: 'right',
      lineHeight: 1.3,
      letterSpacing: 0,
      textTransform: 'none',
    },
  };
}

describe('collectSnapTargets', () => {
  it('always offers the artboard edges and middle', () => {
    const targets = collectSnapTargets(docWith([]), []);
    expect(targets.xs).toEqual([0, 500, 1000]);
    expect(targets.ys).toEqual([0, 400, 800]);
  });

  it('adds left/center/right and top/center/bottom for every visible layer', () => {
    const targets = collectSnapTargets(docWith([shape('a', 100, 200, 300, 100)]), []);
    expect(targets.xs).toEqual([0, 500, 1000, 100, 250, 400]);
    expect(targets.ys).toEqual([0, 400, 800, 200, 250, 300]);
  });

  it('ignores hidden layers', () => {
    const targets = collectSnapTargets(docWith([shape('hidden', 10, 10, 50, 50, true)]), []);
    expect(targets.xs).toEqual([0, 500, 1000]);
    expect(targets.ys).toEqual([0, 400, 800]);
  });

  it('ignores the ids being dragged but keeps the rest', () => {
    const doc = docWith([shape('moving', 100, 100, 100, 100), shape('still', 600, 600, 100, 100)]);
    const targets = collectSnapTargets(doc, ['moving']);
    expect(targets.xs).toEqual([0, 500, 1000, 600, 650, 700]);
    expect(targets.ys).toEqual([0, 400, 800, 600, 650, 700]);
  });

  it('treats text layers as having no measurable height', () => {
    const targets = collectSnapTargets(docWith([text('title', 10, 20, 200)]), []);
    expect(targets.xs).toEqual([0, 500, 1000, 10, 110, 210]);
    expect(targets.ys).toEqual([0, 400, 800, 20]);
  });
});

describe('snapBounds', () => {
  const artboard = { xs: [0, 500, 1000], ys: [0, 400, 800] };

  it('snaps the nearest edge on each axis and reports the guide', () => {
    const result = snapBounds({ left: 497, top: 190, width: 100, height: 20 }, artboard, 6);
    expect(result.dx).toBe(3);
    expect(result.dy).toBe(0);
    expect(result.guides).toEqual([{ axis: 'x', position: 500 }]);
  });

  it('snaps the closest edge rather than the first one in range', () => {
    // Edges are 494, 500 and 506; only the exact centre wins with delta 0.
    const result = snapBounds({ left: 494, top: 300, width: 12, height: 10 }, { xs: [500], ys: [] }, 6);
    expect(result.dx).toBe(0);
    expect(result.guides).toEqual([{ axis: 'x', position: 500 }]);
  });

  it('snaps the right edge backwards', () => {
    const result = snapBounds({ left: 810, top: 300, width: 186, height: 10 }, artboard, 6);
    expect(result.dx).toBe(4);
    expect(result.guides).toEqual([{ axis: 'x', position: 1000 }]);
  });

  it('returns no movement beyond the threshold', () => {
    const result = snapBounds({ left: 100, top: 100, width: 50, height: 50 }, artboard, 6);
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('treats a distance exactly equal to the threshold as a snap', () => {
    const result = snapBounds({ left: 6, top: 300, width: 10, height: 10 }, artboard, 6);
    expect(result.dx).toBe(-6);
    expect(result.guides).toEqual([{ axis: 'x', position: 0 }]);
  });

  it('snaps both axes independently and lists x before y', () => {
    // The centres (502 and 402) are closer to 500 and 400 than the top-left corner.
    const result = snapBounds({ left: 497, top: 397, width: 10, height: 10 }, artboard, 6);
    expect(result.dx).toBe(-2);
    expect(result.dy).toBe(-2);
    expect(result.guides).toEqual([
      { axis: 'x', position: 500 },
      { axis: 'y', position: 400 },
    ]);
  });

  it('handles a zero-size box by snapping its single point', () => {
    const result = snapBounds({ left: 996, top: 402, width: 0, height: 0 }, artboard, 6);
    expect(result.dx).toBe(4);
    expect(result.dy).toBe(-2);
    expect(result.guides).toHaveLength(2);
  });
});

describe('snapEdge', () => {
  it('returns the matching target', () => {
    expect(snapEdge([0, 500, 1000], 498, 6)).toBe(500);
  });

  it('returns null when every target is out of range', () => {
    expect(snapEdge([0, 500, 1000], 120, 6)).toBeNull();
  });

  it('returns the closest of several targets in range', () => {
    expect(snapEdge([100, 104], 103, 6)).toBe(104);
  });
});
