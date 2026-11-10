import { describe, expect, it } from 'vitest';
import type { Layer, ShapeLayer } from '@poster/core';
import { equalSpacingBadges } from './gaps.js';

function shape(id: string, left: number, top: number, width: number, height: number): ShapeLayer {
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
    hidden: false,
    locked: false,
    style: { fill: { kind: 'solid', color: '#ffffff' }, radius: 0 },
  };
}

const moving = { left: 300, top: 100, width: 100, height: 100 };

describe('equalSpacingBadges', () => {
  it('reports both horizontal gaps when they match', () => {
    const layers: Layer[] = [shape('left', 100, 100, 100, 100), shape('right', 500, 100, 100, 100)];
    const badges = equalSpacingBadges(layers, moving, ['moving'], 6);
    expect(badges.filter((badge) => badge.axis === 'x')).toEqual([
      { axis: 'x', value: 100, left: 200, top: 150, width: 100, height: 0 },
      { axis: 'x', value: 100, left: 400, top: 150, width: 100, height: 0 },
    ]);
  });

  it('stays silent when the gaps differ by more than the threshold', () => {
    const layers: Layer[] = [shape('left', 100, 100, 100, 100), shape('right', 540, 100, 100, 100)];
    expect(equalSpacingBadges(layers, moving, ['moving'], 6)).toEqual([]);
  });

  it('ignores neighbours that do not overlap the moving box', () => {
    const layers: Layer[] = [shape('left', 100, 400, 100, 100), shape('right', 500, 100, 100, 100)];
    expect(equalSpacingBadges(layers, moving, ['moving'], 6)).toEqual([]);
  });

  it('ignores hidden layers and the moving selection', () => {
    const hidden = { ...shape('hidden', 100, 100, 100, 100), hidden: true };
    const layers: Layer[] = [hidden, shape('right', 500, 100, 100, 100)];
    expect(equalSpacingBadges(layers, moving, ['moving'], 6)).toEqual([]);
    const visible: Layer[] = [
      shape('left', 100, 100, 100, 100),
      shape('right', 500, 100, 100, 100),
    ];
    expect(equalSpacingBadges(visible, moving, ['moving', 'right'], 6)).toEqual([]);
  });

  it('reports vertical gaps on the perpendicular axis', () => {
    const layers: Layer[] = [shape('top', 300, 0, 100, 50), shape('bottom', 300, 250, 100, 50)];
    const badges = equalSpacingBadges(layers, moving, ['moving'], 6);
    expect(badges.filter((badge) => badge.axis === 'y')).toEqual([
      { axis: 'y', value: 50, left: 350, top: 50, width: 0, height: 50 },
      { axis: 'y', value: 50, left: 350, top: 200, width: 0, height: 50 },
    ]);
  });
});
