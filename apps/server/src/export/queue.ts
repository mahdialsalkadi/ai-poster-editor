import { DesignError, LIMITS } from '@poster/core';
import { checkExportDeadline, exportTimeout } from './deadline.js';

export type QueueMetrics = {
  active: number;
  waiting: number;
  concurrency: number;
  maxWaiting: number;
  rejectedTotal: number;
};

/**
 * Bounds concurrent renders and rejects instead of growing without limit, so a
 * burst cannot exhaust the browser (contract §12.1: queue 20, concurrency 2).
 */
export class RenderQueue {
  private active = 0;
  private rejectedTotal = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly concurrency: number = LIMITS.export.concurrency,
    private readonly maxWaiting: number = LIMITS.export.queueMax,
    private readonly onChange?: (metrics: QueueMetrics) => void,
  ) {}

  get metrics(): QueueMetrics {
    return {
      active: this.active,
      waiting: this.waiting.length,
      concurrency: this.concurrency,
      maxWaiting: this.maxWaiting,
      rejectedTotal: this.rejectedTotal,
    };
  }

  private report(): void {
    // Monitoring must never prevent admission or strand a queue slot.
    try {
      this.onChange?.(this.metrics);
    } catch {
      // An unavailable log destination must not change export behavior.
    }
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal) checkExportDeadline(signal);
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxWaiting) {
        this.rejectedTotal += 1;
        this.report();
        throw new DesignError('RATE_LIMITED', 'The export queue is full', 'export');
      }
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = this.waiting.indexOf(resume);
          if (index >= 0) this.waiting.splice(index, 1);
          this.report();
          reject(exportTimeout());
        };
        this.waiting.push(resume);
        signal?.addEventListener('abort', onAbort, { once: true });
        this.report();
      });
    } else {
      this.active += 1;
      this.report();
    }
    try {
      if (signal) checkExportDeadline(signal);
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
      this.report();
    }
  }
}
