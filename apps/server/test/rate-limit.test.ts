import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../src/ai/rate-limit.js';

describe('bounded sliding-window limiter', () => {
  it('evicts the oldest active key when 10,000 distinct keys are present', () => {
    const limiter = new SlidingWindowLimiter(1, 60_000, () => 100);
    for (let index = 0; index < 10_000; index += 1) expect(limiter.take(`key-${index}`)).toBe(true);
    expect(limiter.size).toBe(10_000);
    expect(limiter.take('key-0')).toBe(false);
    expect(limiter.take('new-key')).toBe(true);
    expect(limiter.size).toBe(10_000);
    expect(limiter.take('key-1')).toBe(false);
    expect(limiter.take('key-0')).toBe(true);
    expect(limiter.size).toBe(10_000);
  });

  it('prunes expired entries before evicting active ones', () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(1, 100, () => now);
    for (let index = 0; index < 5000; index += 1) limiter.take(`old-${index}`);
    now = 50;
    for (let index = 0; index < 5000; index += 1) limiter.take(`live-${index}`);
    now = 100;
    expect(limiter.take('new-key')).toBe(true);
    expect(limiter.size).toBe(5001);
    expect(limiter.take('live-0')).toBe(false);
  });
});
