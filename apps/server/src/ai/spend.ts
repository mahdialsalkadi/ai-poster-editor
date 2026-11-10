import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DesignError } from '@poster/core';

export type Prices = { inputPerMTok: number; outputPerMTok: number };

export function estimateCost(tokens: { input: number; output: number }, prices: Prices): number {
  return (
    (tokens.input / 1_000_000) * prices.inputPerMTok +
    (tokens.output / 1_000_000) * prices.outputPerMTok
  );
}

export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export type SpendState = { day: string; spentUsd: number; byPrincipal?: Record<string, number> };
const MAX_PRINCIPALS = 10_000;

function principalKey(principal: string): string {
  return createHash('sha256').update(principal).digest('hex');
}

export type SettlementInfo = {
  day: string;
  reservedUsd: number;
  actualUsd: number;
  spentUsd: number;
  capUsd: number;
  model?: string;
};

export type LedgerLogger = {
  info: (data: Record<string, unknown>, message: string) => void;
  warn: (data: Record<string, unknown>, message: string) => void;
};

export interface SpendStore {
  load(): SpendState | null;
  save(state: SpendState): void;
}

/**
 * Atomically replaces a small JSON file. The rename is atomic on the same
 * filesystem; a crash can lose the newest settlement but cannot leave a
 * half-written ledger. Use one path per API process/replica.
 */
export class FileSpendStore implements SpendStore {
  constructor(private readonly file: string) {}

  load(): SpendState | null {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `Spend ledger ${this.file} is not valid JSON; refusing to reset it implicitly`,
      );
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Spend ledger ${this.file} has an invalid shape`);
    }
    const state = parsed as { day?: unknown; spentUsd?: unknown; byPrincipal?: unknown };
    if (
      typeof state.day !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.day) ||
      typeof state.spentUsd !== 'number' ||
      !Number.isFinite(state.spentUsd) ||
      state.spentUsd < 0
    ) {
      throw new Error(`Spend ledger ${this.file} has invalid values`);
    }
    if (state.byPrincipal !== undefined) {
      if (
        typeof state.byPrincipal !== 'object' ||
        state.byPrincipal === null ||
        Array.isArray(state.byPrincipal)
      ) {
        throw new Error(`Spend ledger ${this.file} has invalid principal totals`);
      }
      const entries = Object.entries(state.byPrincipal);
      if (
        entries.length > MAX_PRINCIPALS ||
        entries.some(
          ([key, value]) =>
            !/^[a-f0-9]{64}$/.test(key) ||
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0,
        )
      )
        throw new Error(`Spend ledger ${this.file} has invalid principal totals`);
      const totals = Object.fromEntries(entries) as Record<string, number>;
      const sum = Object.values(totals).reduce((total, value) => total + value, 0);
      if (sum > state.spentUsd + 1e-8)
        throw new Error(`Spend ledger ${this.file} has inconsistent principal totals`);
      return { day: state.day, spentUsd: state.spentUsd, byPrincipal: totals };
    }
    return { day: state.day, spentUsd: state.spentUsd };
  }

  save(state: SpendState): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    renameSync(temporary, this.file);
  }
}

export type DailySpendLedgerOptions = {
  capUsd: number;
  userCapUsd?: number;
  store?: SpendStore;
  now?: () => number;
  onSettle?: (info: SettlementInfo) => void;
};

/**
 * Per-UTC-day accounting. Reservations are synchronous and released per provider
 * attempt, so a retry must reserve its own worst-case cost. The optional file
 * store makes the spent total survive restarts; reservations remain in memory.
 */
export class DailySpendLedger {
  private readonly capUsd: number;
  private readonly userCapUsd: number;
  private readonly store: SpendStore | undefined;
  private readonly now: () => number;
  private readonly onSettle: ((info: SettlementInfo) => void) | undefined;
  private day = '';
  private spent = 0;
  private reserved = 0;
  private readonly byPrincipal = new Map<string, number>();
  private readonly reservedByPrincipal = new Map<string, number>();
  private readonly knownPrincipals = new Set<string>();
  private legacySpend = 0;
  private storageFailed = false;

  constructor(options: DailySpendLedgerOptions);
  constructor(capUsd: number, now?: () => number);
  constructor(options: DailySpendLedgerOptions | number, now: () => number = Date.now) {
    if (typeof options === 'number') {
      this.capUsd = options;
      this.userCapUsd = options;
      this.now = now;
      this.store = undefined;
      this.onSettle = undefined;
    } else {
      this.capUsd = options.capUsd;
      this.userCapUsd = options.userCapUsd ?? options.capUsd;
      this.now = options.now ?? Date.now;
      this.store = options.store;
      this.onSettle = options.onSettle;
    }
    const loaded = this.store?.load() ?? null;
    if (loaded) {
      this.day = loaded.day;
      this.spent = loaded.spentUsd;
      for (const [key, amount] of Object.entries(loaded.byPrincipal ?? {})) {
        this.byPrincipal.set(key, amount);
        this.knownPrincipals.add(key);
      }
      this.legacySpend = Math.max(
        0,
        this.spent - [...this.byPrincipal.values()].reduce((a, b) => a + b, 0),
      );
    }
  }

  private roll(): void {
    const today = utcDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
      this.byPrincipal.clear();
      this.knownPrincipals.clear();
      for (const key of this.reservedByPrincipal.keys()) this.knownPrincipals.add(key);
      this.legacySpend = 0;
      this.persist();
    }
  }

  private persist(): void {
    if (!this.store) return;
    try {
      this.store.save({
        day: this.day,
        spentUsd: this.spent,
        byPrincipal: Object.fromEntries(this.byPrincipal),
      });
    } catch (cause) {
      this.storageFailed = true;
      throw new DesignError(
        'INTERNAL_ERROR',
        'Spend accounting storage failed; AI is disabled until it is repaired',
        'ai',
        { reason: cause instanceof Error ? cause.message : 'unknown' },
      );
    }
  }

  reserve(estimateUsd: number, principal = 'anonymous'): number {
    this.roll();
    if (this.storageFailed) {
      throw new DesignError(
        'INTERNAL_ERROR',
        'Spend accounting storage failed; AI is disabled until it is repaired',
        'ai',
      );
    }
    const amount = Math.max(0, estimateUsd);
    const key = principalKey(principal);
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
    const userSpent = this.legacySpend + (this.byPrincipal.get(key) ?? 0);
    const userReserved = this.reservedByPrincipal.get(key) ?? 0;
    if (userSpent + userReserved + amount > this.userCapUsd + 1e-9) {
      throw new DesignError(
        'SPEND_CAP_EXCEEDED',
        'The per-user daily AI spend cap would be exceeded',
        'ai',
        {
          capUsd: this.userCapUsd,
          spentUsd: Math.round(userSpent * 1e6) / 1e6,
          reservedUsd: Math.round(userReserved * 1e6) / 1e6,
        },
      );
    }
    if (!this.knownPrincipals.has(key) && this.knownPrincipals.size >= MAX_PRINCIPALS) {
      throw new DesignError(
        'SPEND_CAP_EXCEEDED',
        'The daily AI principal limit has been reached',
        'ai',
      );
    }
    this.knownPrincipals.add(key);
    if (!this.byPrincipal.has(key)) this.byPrincipal.set(key, 0);
    this.reserved += amount;
    this.reservedByPrincipal.set(key, userReserved + amount);
    return amount;
  }

  settle(reservedUsd: number, actualUsd: number, model?: string, principal = 'anonymous'): void {
    this.roll();
    const key = principalKey(principal);
    this.reserved = Math.max(0, this.reserved - Math.max(0, reservedUsd));
    const remaining = Math.max(
      0,
      (this.reservedByPrincipal.get(key) ?? 0) - Math.max(0, reservedUsd),
    );
    if (remaining === 0) this.reservedByPrincipal.delete(key);
    else this.reservedByPrincipal.set(key, remaining);
    const actual = Math.max(0, actualUsd);
    this.spent += actual;
    if (actual > 0) this.byPrincipal.set(key, (this.byPrincipal.get(key) ?? 0) + actual);
    let persistenceError: DesignError | undefined;
    try {
      this.persist();
    } catch (cause) {
      persistenceError = cause as DesignError;
    }
    this.onSettle?.({
      day: this.day,
      reservedUsd: Math.round(reservedUsd * 1e6) / 1e6,
      actualUsd: Math.round(actual * 1e6) / 1e6,
      spentUsd: Math.round(this.spent * 1e6) / 1e6,
      capUsd: this.capUsd,
      ...(model ? { model } : {}),
    });
    if (persistenceError) throw persistenceError;
  }

  get spentToday(): number {
    this.roll();
    return this.spent;
  }

  get reservedNow(): number {
    this.roll();
    return this.reserved;
  }
}
