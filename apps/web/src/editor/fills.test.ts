import { LIMITS } from '@poster/core';
import { describe, expect, it } from 'vitest';
import { insertStop, normalizeStops, reverseGradient } from './fills.js';

describe('gradient helpers', () => {
  it('clamps and sorts stops into canonical order', () => {
    expect(
      normalizeStops([
        { color: '#000000', pos: 80 },
        { color: '#ffffff', pos: -20 },
        { color: '#ff0000', pos: 140 },
      ]),
    ).toEqual([
      { color: '#ffffff', pos: 0 },
      { color: '#000000', pos: 80 },
      { color: '#ff0000', pos: 100 },
    ]);
  });

  it('caps the number of stops', () => {
    const many = Array.from({ length: LIMITS.gradient.maxStops + 3 }, (_, index) => ({
      color: '#000000',
      pos: index * 10,
    }));
    expect(normalizeStops(many)).toHaveLength(LIMITS.gradient.maxStops);
  });

  it('inserts a stop inside the widest gap', () => {
    const stops = normalizeStops([
      { color: '#000000', pos: 0 },
      { color: '#ffffff', pos: 100 },
      { color: '#ff0000', pos: 25 },
    ]);
    const next = insertStop(stops);
    expect(next).toHaveLength(4);
    expect(next.map((stop) => stop.pos)).toContain(62.5);
    expect(next.map((stop) => stop.pos)).toEqual(
      [...next.map((stop) => stop.pos)].sort((a, b) => a - b),
    );
  });

  it('reverses a gradient and keeps it sorted', () => {
    const reversed = reverseGradient({
      kind: 'linear',
      angle: 45,
      stops: [
        { color: '#000000', pos: 10 },
        { color: '#ffffff', pos: 90 },
      ],
    });

    expect(reversed.angle).toBe(45);
    expect(reversed.stops).toEqual([
      { color: '#ffffff', pos: 10 },
      { color: '#000000', pos: 90 },
    ]);
  });
});
