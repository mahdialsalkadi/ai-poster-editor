/** Sliding-window counters held in memory: the API is a single process. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxKeys = 10_000;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const at = this.now();
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => at - timestamp < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    if (recent.length === 0) {
      this.hits.delete(key);
      if (this.hits.size >= this.maxKeys) {
        this.prune(at);
        if (this.hits.size >= this.maxKeys) {
          const oldest = this.hits.keys().next().value;
          if (oldest !== undefined) this.hits.delete(oldest);
        }
      }
    }
    recent.push(at);
    this.hits.set(key, recent);
    return true;
  }

  get size(): number {
    return this.hits.size;
  }

  private prune(at: number): void {
    this.hits.forEach((timestamps, key) => {
      if (timestamps.every((timestamp) => at - timestamp >= this.windowMs)) this.hits.delete(key);
    });
  }
}
