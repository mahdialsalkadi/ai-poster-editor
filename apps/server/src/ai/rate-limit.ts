/** Fixed-window counters held in memory: the API is a single process. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

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
    recent.push(at);
    this.hits.set(key, recent);
    if (this.hits.size > 5_000) this.prune(at);
    return true;
  }

  private prune(at: number): void {
    this.hits.forEach((timestamps, key) => {
      if (timestamps.every((timestamp) => at - timestamp >= this.windowMs)) this.hits.delete(key);
    });
  }
}
