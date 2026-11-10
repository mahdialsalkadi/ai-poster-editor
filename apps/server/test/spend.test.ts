import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiServiceFromEnv, type AiServiceOptions } from '../src/ai/service.js';
import { estimatePromptTokens, buildGenerateMessages } from '../src/ai/prompt.js';
import {
  DailySpendLedger,
  estimateCost,
  FileSpendStore,
  type SettlementInfo,
} from '../src/ai/spend.js';
import { parseDesignHtml } from '@poster/core';
import { AiService } from '../src/ai/service.js';
import type { AiMessage, AiProvider } from '../src/ai/provider.js';

const prices = { inputPerMTok: 0.15, outputPerMTok: 0.6 };
const cleanups: string[] = [];

function tempLedger(): string {
  const directory = mkdtempSync(join(tmpdir(), 'poster-spend-'));
  cleanups.push(directory);
  return join(directory, 'ledger.json');
}

afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true });
});

function providerEnv(path: string): NodeJS.ProcessEnv {
  return {
    AI_PROVIDER: 'openai',
    AI_MODEL: 'test-model',
    AI_API_KEY: 'test-key',
    AI_INPUT_USD_PER_MTOK: '0.15',
    AI_OUTPUT_USD_PER_MTOK: '0.6',
    AI_SPEND_LEDGER_PATH: path,
  };
}

const generated = `<div class="artboard" data-width="600px" data-height="800px"><div data-id="title" data-layer="Title" data-type="text" dir="rtl" style="position:absolute;left:0px;top:0px;width:500px;font-family:Cairo;font-size:32px">مرحبا</div></div>`;

describe('durable spend accounting', () => {
  it('persists the spent total and reloads it in a new ledger', () => {
    const path = tempLedger();
    const store = new FileSpendStore(path);
    const first = new DailySpendLedger({ capUsd: 10, store, now: () => 1_800_000_000_000 });
    const reserved = first.reserve(2);
    expect(reserved).toBe(2);
    first.settle(reserved, 1.25);
    expect(first.spentToday).toBeCloseTo(1.25, 6);

    const second = new DailySpendLedger({
      capUsd: 10,
      store: new FileSpendStore(path),
      now: () => 1_800_000_000_000,
    });
    expect(second.spentToday).toBeCloseTo(1.25, 6);

    const stored = JSON.parse(readFileSync(path, 'utf8')) as { day: string; spentUsd: number };
    expect(stored).toMatchObject({ day: '2027-01-15', spentUsd: 1.25 });
  });

  it('resets and persists at the UTC day boundary', () => {
    const path = tempLedger();
    writeFileSync(path, `${JSON.stringify({ day: '2026-11-09', spentUsd: 4 })}\n`);
    const ledger = new DailySpendLedger({
      capUsd: 10,
      store: new FileSpendStore(path),
      now: () => Date.UTC(2026, 10, 10, 1, 0, 0),
    });
    expect(ledger.spentToday).toBe(0);
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { day: string; spentUsd: number };
    expect(stored).toMatchObject({ day: '2026-11-10', spentUsd: 0 });
  });

  it('fails closed when the ledger file is corrupt', () => {
    const path = tempLedger();
    writeFileSync(path, '{not json');
    expect(() => new DailySpendLedger({ capUsd: 10, store: new FileSpendStore(path) })).toThrow(
      /refusing to reset/,
    );
  });

  it('settles reservations per attempt and reports each settlement', () => {
    const info: SettlementInfo[] = [];
    const ledger = new DailySpendLedger({
      capUsd: 10,
      onSettle: (value) => info.push(value),
      now: () => 1_800_000_000_000,
    });
    const first = ledger.reserve(1);
    ledger.settle(first, 0.4, 'model-a');
    const second = ledger.reserve(1);
    ledger.settle(second, 0.2, 'model-a');

    expect(ledger.reservedNow).toBe(0);
    expect(ledger.spentToday).toBeCloseTo(0.6, 6);
    expect(info).toHaveLength(2);
    expect(info[0]).toMatchObject({ reservedUsd: 1, actualUsd: 0.4, model: 'model-a' });
    expect(info[1]?.spentUsd).toBeCloseTo(0.6, 6);
  });

  it('enforces independent principal reservations and persists their settled totals', () => {
    const path = tempLedger();
    const make = () =>
      new DailySpendLedger({
        capUsd: 10,
        userCapUsd: 2,
        store: new FileSpendStore(path),
        now: () => 1_800_000_000_000,
      });
    const ledger = make();
    const alice = ledger.reserve(1.5, 'alice');
    expect(() => ledger.reserve(0.6, 'alice')).toThrow(/per-user/);
    const bob = ledger.reserve(1.5, 'bob');
    ledger.settle(alice, 1.25, 'model', 'alice');
    ledger.settle(bob, 0.5, 'model', 'bob');
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('alice');
    expect(raw).not.toContain('bob');
    const restored = make();
    expect(() => restored.reserve(0.8, 'alice')).toThrow(/per-user/);
    expect(restored.reserve(1.4, 'bob')).toBe(1.4);
  });

  it('conservatively applies legacy unassigned spend to each user until rollover', () => {
    const path = tempLedger();
    writeFileSync(path, JSON.stringify({ day: '2026-11-10', spentUsd: 1.5 }));
    let now = Date.UTC(2026, 10, 10, 1);
    const make = () =>
      new DailySpendLedger({
        capUsd: 10,
        userCapUsd: 2,
        store: new FileSpendStore(path),
        now: () => now,
      });
    const ledger = make();
    expect(() => ledger.reserve(0.6, 'alice')).toThrow(/per-user/);
    const reservation = ledger.reserve(0.4, 'bob');
    ledger.settle(reservation, 0.3, undefined, 'bob');
    const restored = make();
    expect(() => restored.reserve(0.3, 'bob')).toThrow(/per-user/);
    expect(restored.reserve(0.4, 'alice')).toBe(0.4);
    now += 24 * 60 * 60 * 1000;
    expect(restored.reserve(1.5, 'charlie')).toBe(1.5);
  });

  it('keeps in-flight reservations across midnight and attributes settlement to the new day', () => {
    let now = Date.UTC(2026, 10, 10, 23, 59, 59);
    const ledger = new DailySpendLedger({ capUsd: 2, userCapUsd: 2, now: () => now });
    const reserved = ledger.reserve(1.5, 'alice');
    now += 2_000;
    expect(() => ledger.reserve(0.6, 'alice')).toThrow(/spend cap/);
    ledger.settle(reserved, 1.2, undefined, 'alice');
    expect(ledger.spentToday).toBe(1.2);
    expect(() => ledger.reserve(0.9, 'alice')).toThrow(/spend cap/);
    expect(ledger.reservedNow).toBe(0);
  });

  it('refuses malformed or inconsistent per-principal ledger records', () => {
    const path = tempLedger();
    writeFileSync(
      path,
      JSON.stringify({ day: '2026-11-10', spentUsd: 1, byPrincipal: { invalid: 1 } }),
    );
    expect(() => new FileSpendStore(path).load()).toThrow(/principal totals/);
    writeFileSync(
      path,
      JSON.stringify({ day: '2026-11-10', spentUsd: 1, byPrincipal: { ['a'.repeat(64)]: 2 } }),
    );
    expect(() => new FileSpendStore(path).load()).toThrow(/inconsistent/);
  });
});

describe('AI configuration and retry reservations', () => {
  it('enforces per-user caps before provider calls across concurrent users', async () => {
    const ledger = new DailySpendLedger({ capUsd: 300, userCapUsd: 100 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const provider: AiProvider = {
      name: 'fake',
      model: 'fake',
      async complete() {
        calls += 1;
        await gate;
        return { text: generated, model: 'fake', inputTokens: 0, outputTokens: 100, latencyMs: 1 };
      },
    };
    const service = new AiService({
      provider,
      prices: { inputPerMTok: 0, outputPerMTok: 1_000_000 },
      ledger,
      maxOutputTokens: 100,
      timeoutMs: 2000,
    });
    const prompt = { prompt: 'A poster', width: 600, height: 800, language: 'ar' as const };
    const context = (sessionId: string, ip: string) => ({ sessionId, ip, projectId: sessionId });
    const alice = service.generate(prompt, context('alice', '1'));
    const blocked = service.generate(prompt, context('alice', '2'));
    const bob = service.generate(prompt, context('bob', '3'));
    try {
      await expect(blocked).rejects.toMatchObject({ code: 'SPEND_CAP_EXCEEDED' });
      expect(calls).toBe(2);
    } finally {
      release();
      await Promise.all([alice, bob]);
    }
  });

  it('does not let concurrent generation reserve past the daily cap', async () => {
    const ledger = new DailySpendLedger({ capUsd: 100 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const provider: AiProvider = {
      name: 'fake',
      model: 'concurrent',
      async complete() {
        calls++;
        await gate;
        return {
          text: generated,
          model: 'concurrent',
          inputTokens: 0,
          outputTokens: 100,
          latencyMs: 1,
        };
      },
    };
    const service = new AiService({
      provider,
      prices: { inputPerMTok: 0, outputPerMTok: 1_000_000 },
      ledger,
      maxOutputTokens: 100,
      timeoutMs: 2000,
    });
    const pending = Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        service.generate(
          { prompt: 'A gallery poster', width: 600, height: 800, language: 'ar' },
          { ip: `203.0.113.${i + 1}`, sessionId: `session${i}`, projectId: 'p' },
        ),
      ),
    );
    expect(calls).toBe(1);
    expect(ledger.reservedNow).toBe(100);
    release();
    const results = await pending;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'SPEND_CAP_EXCEEDED' });
    expect(ledger.spentToday).toBe(100);
    expect(ledger.reservedNow).toBe(0);
  });
  it('honours the AI_DISABLED kill switch', () => {
    const path = tempLedger();
    expect(createAiServiceFromEnv({ ...providerEnv(path), AI_DISABLED: 'true' })).toBeNull();
  });

  it('refuses to start with a provider but missing prices', () => {
    const path = tempLedger();
    const env = providerEnv(path);
    delete env.AI_INPUT_USD_PER_MTOK;
    expect(() => createAiServiceFromEnv(env)).toThrow(/AI_INPUT_USD_PER_MTOK/);
  });

  it('refuses an invalid per-user cap at startup', () => {
    expect(() =>
      createAiServiceFromEnv({
        ...providerEnv(tempLedger()),
        AI_USER_DAILY_SPEND_CAP_USD: 'not-a-number',
      }),
    ).toThrow(/AI_USER_DAILY_SPEND_CAP_USD/);
  });

  it('builds a configured service with a file-backed ledger', () => {
    const service = createAiServiceFromEnv(providerEnv(tempLedger()));
    expect(service).not.toBeNull();
  });

  it('reserves budget for the retry instead of spending past the cap', async () => {
    const messages = buildGenerateMessages({
      prompt: 'ملصق معرض فني في الرياض',
      width: 600,
      height: 800,
      language: 'ar',
    });
    const estimate = estimateCost(
      { input: estimatePromptTokens(messages), output: 16_000 },
      prices,
    );
    const actualPerAttempt = estimateCost({ input: 1_000, output: 500 }, prices);
    const ledger = new DailySpendLedger({ capUsd: estimate + actualPerAttempt / 2 });
    const calls: AiMessage[][] = [];
    const provider: AiProvider = {
      name: 'fake',
      model: 'fake-model-1',
      async complete(sent) {
        calls.push([...sent]);
        return calls.length === 1
          ? {
              text: '<div class="artboard"><script>alert(1)</script></div>',
              model: 'fake-model-1',
              inputTokens: 1_000,
              outputTokens: 500,
              latencyMs: 1,
            }
          : {
              text: generated,
              model: 'fake-model-1',
              inputTokens: 1_000,
              outputTokens: 500,
              latencyMs: 1,
            };
      },
    };
    const options: AiServiceOptions = {
      provider,
      prices,
      ledger,
      maxOutputTokens: 16_000,
      timeoutMs: 2_000,
    };
    const service = new AiService(options);

    await expect(
      service.generate(
        { prompt: 'ملصق معرض فني في الرياض', width: 600, height: 800, language: 'ar' },
        { ip: '203.0.113.9', sessionId: 's', projectId: 'p' },
      ),
    ).rejects.toMatchObject({ code: 'SPEND_CAP_EXCEEDED' });
    expect(calls).toHaveLength(1);
    expect(parseDesignHtml(generated).warnings).toEqual([]);
    expect(ledger.spentToday).toBeCloseTo(actualPerAttempt, 9);
    expect(ledger.reservedNow).toBe(0);
  });
});
