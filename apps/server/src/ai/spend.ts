import { DesignError } from '@poster/core';

export type Prices = { inputPerMTok: number; outputPerMTok: number };

export function estimateCost(
  tokens: { input: number; output: number },
  prices: Prices,
): number {
  return (
    (tokens.input / 1_000_000) * prices.inputPerMTok +
    (tokens.output / 1_000_000) * prices.outputPerMTok
  );
}

export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Spend is accounted per server per UTC day. A request reserves its worst-case
 * cost before the provider is called, so concurrent requests cannot race past
 * the cap; the reservation is then settled to the actual cost.
 */
export class DailySpendLedger {
  private day = '';
  private spent = 0;
  private reserved = 0;

  constructor(
    private readonly capUsd: number,
    private readonly now: () => number = Date.now,
  ) {}

  private roll(): void {
    const today = utcDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
      this.reserved = 0;
    }
  }

  reserve(estimateUsd: number): number {
    this.roll();
    const amount = Math.max(0, estimateUsd);
    if (this.spent + this.reserved + amount > this.capUsd + 1e-9) {
      throw new DesignError(
        'SPEND_CAP_EXCEEDED',
        `The daily AI spend cap of $${this.capUsd.toFixed(2)} would be exceeded`,
        'ai',
        {
          capUsd: this.capUsd,
          spentUsd: Math.round(this.spent * 1e6) / 1e6,
          reservedUsd: Math.round(this.reserved * 1e6) / 1e6,
        },
      );
    }
    this.reserved += amount;
    return amount;
  }

  settle(reservedUsd: number, actualUsd: number): void {
    this.reserved = Math.max(0, this.reserved - Math.max(0, reservedUsd));
    this.spent += Math.max(0, actualUsd);
  }

  get spentToday(): number {
    this.roll();
    return this.spent;
  }
}
