import { DesignError, LIMITS } from '@poster/core';

/**
 * Bounds concurrent renders and rejects instead of growing without limit, so a
 * burst cannot exhaust the browser (contract §12.1: queue 20, concurrency 2).
 */
export class RenderQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly concurrency: number = LIMITS.export.concurrency,
    private readonly maxWaiting: number = LIMITS.export.queueMax,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxWaiting) {
        throw new DesignError('RATE_LIMITED', 'The export queue is full', 'export');
      }
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    } else this.active += 1;
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
