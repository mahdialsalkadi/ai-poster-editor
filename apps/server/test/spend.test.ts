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
    expect(stored).toEqual({ day: '2027-01-15', spentUsd: 1.25 });
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
    expect(stored).toEqual({ day: '2026-11-10', spentUsd: 0 });
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
});

describe('AI configuration and retry reservations', () => {
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
