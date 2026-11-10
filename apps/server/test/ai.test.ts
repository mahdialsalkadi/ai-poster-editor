import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  DesignError,
  parseDesignHtml,
  serializeDesignDoc,
  validateDesignDoc,
  type DesignDoc,
} from '@poster/core';
import { AiService, type AiServiceOptions } from '../src/ai/service.js';
import { DailySpendLedger } from '../src/ai/spend.js';
import { SlidingWindowLimiter } from '../src/ai/rate-limit.js';
import {
  createProvider,
  providerConfigFromEnv,
  type AiMessage,
  type AiProvider,
  type ProviderConfig,
} from '../src/ai/provider.js';
import { extractDesignHtml, systemPrompt } from '../src/ai/prompt.js';
import { buildServer } from '../src/app.js';

const context = { ip: '203.0.113.9', sessionId: 'session-1', projectId: 'project-1' };

function designHtml(
  options: { width?: number; height?: number; color?: string; extra?: string } = {},
): string {
  const { width = 600, height = 800, color = '#ffffff', extra = '' } = options;
  return (
    `<div class="artboard" data-width="${width}px" data-height="${height}px" style="background:#0f172a">` +
    `<div data-id="title" data-layer="Title" data-type="text" dir="rtl" style="position:absolute;left:40px;top:40px;width:520px;font-family:Cairo;font-size:64px;color:${color};text-align:center">مرحبا</div>` +
    extra +
    '</div>'
  );
}

const baseHtml = designHtml({
  extra:
    '<div data-id="card" data-layer="Card" data-type="shape" style="position:absolute;left:40px;top:200px;width:520px;height:200px;background:#1e293b;border-radius:24px"></div>',
});

const generateInput = {
  prompt: 'ملصق معرض فني في الرياض',
  width: 600,
  height: 800,
  language: 'ar' as const,
};

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const cannedOutput = fixture('ai-canned-output.html');
const rejectedOutput = fixture('ai-rejected-output.html');
const canonicalOutput = fixture('ai-canonical-output.html').trim();

const editBaseHtml = fixture('ai-edit-base.html');
const editPatchHtml = fixture('ai-edit-patch.html');
const editMergedHtml = fixture('ai-edit-merged.html').trim();

const editInput = {
  designHtml: baseHtml,
  instruction: 'اجعل لون العنوان أزرق',
  selectedLayerIds: ['title'],
  allowNewLayers: false,
};

function textColor(doc: DesignDoc, id: string): string | undefined {
  const layer = doc.layers.find((item) => item.id === id);
  return layer?.type === 'text' ? layer.style.color : undefined;
}

function serviceWith(replies: string[], options: Partial<AiServiceOptions> = {}) {
  const calls: AiMessage[][] = [];
  const provider: AiProvider = {
    name: 'fake',
    model: 'fake-model-1',
    async complete(messages) {
      calls.push(messages.map((message) => ({ ...message })));
      const text = replies[Math.min(calls.length - 1, replies.length - 1)] ?? '';
      return { text, model: 'fake-model-1', inputTokens: 1_000, outputTokens: 500, latencyMs: 7 };
    },
  };
  const service = new AiService({
    provider,
    prices: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
    ledger: new DailySpendLedger(5),
    maxOutputTokens: 16_000,
    timeoutMs: 2_000,
    ...options,
  });
  return { service, calls };
}

describe('AI service', () => {
  it('keeps canonical units and hex-only colors explicit in both prompts', () => {
    for (const kind of ['generate', 'edit'] as const) {
      const prompt = systemPrompt(kind);
      expect(prompt).toContain('data-width="1080px"');
      expect(prompt).toContain('#rrggbb');
      expect(prompt).toContain('#rrggbbaa');
    }
  });
  it('retries unsupported colors and accepts named CSS colors without retry', async () => {
    const { service, calls } = serviceWith([
      designHtml({ color: 'not-a-color' }),
      designHtml({ color: 'orange' }),
    ]);
    const result = await service.generate(generateInput, context);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.at(-1)?.content).toContain('Unsupported color');
    expect(textColor(parseDesignHtml(result.designHtml).doc, 'title')).toBe('#ffa500');
  });

  it('rejects unsupported colors after one retry for generation and edits', async () => {
    for (const kind of ['generate', 'edit'] as const) {
      const { service, calls } = serviceWith([designHtml({ color: 'not-a-color' })]);
      await expect(
        kind === 'generate'
          ? service.generate(generateInput, context)
          : service.edit(editInput, context),
      ).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
      expect(calls).toHaveLength(2);
    }
  });

  it('generates canonical Design HTML with usage', async () => {
    const { service } = serviceWith([designHtml()]);
    const result = await service.generate(generateInput, context);

    expect(result.designHtml.startsWith('<div class="artboard"')).toBe(true);
    expect(parseDesignHtml(result.designHtml).doc.layers).toHaveLength(1);
    expect(result.usage.model).toBe('fake-model-1');
    expect(result.usage.inputTokens).toBe(1_000);
    expect(result.usage.costUsd).toBeCloseTo(0.00045, 6);
  });

  it('turns a canned model response into the golden canonical document', async () => {
    const { service, calls } = serviceWith([cannedOutput]);
    const result = await service.generate(
      { prompt: 'ملصق معرض فني في الرياض', width: 1080, height: 1350, language: 'ar' },
      context,
    );

    expect(calls).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(result.designHtml).toBe(canonicalOutput);

    // The accepted output is a fixpoint: parsing and canonicalizing it again
    // cannot change a byte.
    const reparsed = parseDesignHtml(result.designHtml);
    expect(reparsed.warnings).toEqual([]);
    expect(serializeDesignDoc(validateDesignDoc(reparsed.doc))).toBe(canonicalOutput);
  });

  it('retries the canned rejected output with the validator note', async () => {
    const { service, calls } = serviceWith([rejectedOutput, cannedOutput]);
    const result = await service.generate(
      { prompt: 'ملصق معرض فني في الرياض', width: 1080, height: 1350, language: 'ar' },
      context,
    );

    expect(calls).toHaveLength(2);
    const retryNote = calls[1]?.at(-1)?.content ?? '';
    expect(retryNote).toContain('Your previous attempt was rejected by the validator:');
    expect(retryNote).toContain('Forbidden HTML tag: script');
    expect(retryNote).toContain('Return only valid Design HTML.');
    expect(result.designHtml).toBe(canonicalOutput);
  });

  it('retries once with the validator error and recovers', async () => {
    const { service, calls } = serviceWith([
      '<div class="artboard" data-width="600px" data-height="800px"><script>alert(1)</script></div>',
      designHtml(),
    ]);
    const result = await service.generate(generateInput, context);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.at(-1)?.content).toContain('rejected by the validator');
    expect(parseDesignHtml(result.designHtml).doc.layers).toHaveLength(1);
  });

  it('fails with AI_INVALID_OUTPUT when the artboard size is ignored', async () => {
    const { service, calls } = serviceWith([designHtml({ width: 1080, height: 1350 })]);

    await expect(service.generate(generateInput, context)).rejects.toMatchObject({
      code: 'AI_INVALID_OUTPUT',
    });
    expect(calls).toHaveLength(2);
  });

  it('rate limits generation per address', async () => {
    const { service } = serviceWith([designHtml()], {
      generateLimiter: new SlidingWindowLimiter(1, 60_000),
    });

    await service.generate(generateInput, context);
    await expect(service.generate(generateInput, context)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('refuses before calling the provider when the daily cap is spent', async () => {
    const { service, calls } = serviceWith([designHtml()], {
      ledger: new DailySpendLedger(0.00001),
    });

    await expect(service.generate(generateInput, context)).rejects.toMatchObject({
      code: 'SPEND_CAP_EXCEEDED',
    });
    expect(calls).toHaveLength(0);
  });

  it('applies a canned patch into the golden merged document', async () => {
    const { service, calls } = serviceWith([editPatchHtml]);
    const result = await service.edit(
      {
        designHtml: editBaseHtml,
        instruction: 'اجعل العنوان أقصر وباللون البرتقالي',
        selectedLayerIds: ['title'],
        allowNewLayers: false,
      },
      context,
    );

    expect(calls).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(result.designHtml).toBe(editMergedHtml);

    // The merged document is a fixpoint, and the unselected layer survives
    // exactly as it was in the base document.
    const reparsed = parseDesignHtml(result.designHtml);
    expect(reparsed.warnings).toEqual([]);
    expect(serializeDesignDoc(validateDesignDoc(reparsed.doc))).toBe(editMergedHtml);
    expect(reparsed.doc.layers.map((layer) => layer.id)).toEqual(['title', 'card']);
    expect(textColor(reparsed.doc, 'title')).toBe('#fb923c');
    expect(textColor(reparsed.doc, 'card')).toBeUndefined();
  });

  it('applies a scoped edit without changing unselected layers', async () => {
    const { service } = serviceWith([designHtml({ color: '#38bdf8' })]);
    const result = await service.edit(editInput, context);

    const doc = parseDesignHtml(result.designHtml).doc;
    expect(textColor(doc, 'title')).toBe('#38bdf8');
    expect(textColor(doc, 'card')).toBeUndefined();
    expect(doc.layers.some((layer) => layer.id === 'card')).toBe(true);
    expect(doc.width).toBe(600);
    expect(doc.height).toBe(800);
  });

  it('rejects new layers when the request does not allow them', async () => {
    const withExtra = designHtml({
      color: '#ffffff',
      extra:
        '<div data-id="extra" data-layer="Extra" data-type="shape" style="position:absolute;left:40px;top:500px;width:100px;height:100px;background:#334155"></div>',
    });
    const { service, calls } = serviceWith([withExtra]);

    await expect(service.edit(editInput, context)).rejects.toMatchObject({
      code: 'AI_INVALID_OUTPUT',
    });
    expect(calls).toHaveLength(2);
  });

  it('keeps the document inside the untrusted-data block', async () => {
    const { service, calls } = serviceWith([designHtml({ color: '#38bdf8' })]);
    await service.edit(editInput, context);

    const user = calls[0]?.find((message) => message.role === 'user')?.content ?? '';
    const system = calls[0]?.find((message) => message.role === 'system')?.content ?? '';
    expect(user).toContain('<untrusted_design_data>');
    expect(user).toContain('</untrusted_design_data>');
    expect(user.indexOf('</untrusted_design_data>')).toBeLessThan(user.indexOf('اجعل لون العنوان'));
    expect(system).toContain('selection-scoped');
  });

  it('never puts the provider key in an error', async () => {
    const provider: AiProvider = {
      name: 'fake',
      model: 'fake-model-1',
      async complete() {
        throw new DesignError('INTERNAL_ERROR', 'AI provider responded with HTTP 401', 'ai');
      },
    };
    const service = new AiService({
      provider,
      prices: { inputPerMTok: 0.15, outputPerMTok: 0.6 },
      ledger: new DailySpendLedger(5),
      maxOutputTokens: 16_000,
      timeoutMs: 2_000,
    });

    const error = await service.generate(generateInput, context).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DesignError);
    expect((error as Error).message).toBe('AI provider responded with HTTP 401');
    expect((error as Error).message).not.toContain('sk-secret');
  });

  it('reads provider configuration from the environment', () => {
    expect(providerConfigFromEnv({})).toBeNull();
    expect(providerConfigFromEnv({ AI_PROVIDER: 'openai' })).toBeNull();
    expect(
      providerConfigFromEnv({ AI_PROVIDER: 'unknown', AI_MODEL: 'm', AI_API_KEY: 'k' }),
    ).toBeNull();
    const config = providerConfigFromEnv({
      AI_PROVIDER: 'openai-compatible',
      AI_MODEL: 'm',
      AI_API_KEY: 'sk-secret',
      AI_MAX_OUTPUT_TOKENS: '999999',
    });
    expect(config?.model).toBe('m');
    expect(config?.maxOutputTokens).toBe(16_000);
    expect(config?.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('extracts Design HTML from fenced output', () => {
    expect(extractDesignHtml('```html\n<div class="artboard"></div>\n```')).toBe(
      '<div class="artboard"></div>',
    );
  });
});

describe('AI provider transports', () => {
  const anthropicConfig: ProviderConfig = {
    provider: 'anthropic',
    model: 'claude-sonnet-test',
    apiKey: 'sk-ant-secret',
    baseUrl: 'https://api.anthropic.com/v1',
    maxOutputTokens: 4_000,
    timeoutMs: 2_000,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults the Anthropic base URL separately from OpenAI', () => {
    const config = providerConfigFromEnv({
      AI_PROVIDER: 'anthropic',
      AI_MODEL: 'claude-sonnet-test',
      AI_API_KEY: 'sk-ant-secret',
    });
    expect(config).toMatchObject({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
    });
    expect(
      providerConfigFromEnv({
        AI_PROVIDER: 'openai',
        AI_MODEL: 'm',
        AI_API_KEY: 'k',
      })?.baseUrl,
    ).toBe('https://api.openai.com/v1');
  });

  it('sends the Anthropic messages request and maps its usage', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            content: [
              { type: 'text', text: '<div class="artboard"></div>' },
              { type: 'tool_use', id: 'ignored' },
              { type: 'text', text: ' ' },
            ],
            usage: { input_tokens: 11, output_tokens: 7 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reply = await createProvider(anthropicConfig).complete(
      [
        { role: 'system', content: 'system one' },
        { role: 'system', content: 'system two' },
        { role: 'user', content: 'make a poster' },
      ],
      { maxOutputTokens: 321, timeoutMs: 1_500 },
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-secret',
      'anthropic-version': '2023-06-01',
    });
    expect(init?.headers).not.toHaveProperty('authorization');
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      system: string;
      messages: { role: string; content: string }[];
      max_tokens: number;
    };
    expect(body).toEqual({
      model: 'claude-sonnet-test',
      max_tokens: 321,
      temperature: 0.8,
      system: 'system one\n\nsystem two',
      messages: [{ role: 'user', content: 'make a poster' }],
    });
    expect(reply).toMatchObject({
      text: '<div class="artboard"></div> ',
      model: 'claude-sonnet-test',
      inputTokens: 11,
      outputTokens: 7,
    });
    expect(reply.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('sanitizes Anthropic HTTP failures without leaking the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response('provider details', { status: 429 }),
      ),
    );

    const error = await createProvider(anthropicConfig)
      .complete([{ role: 'user', content: 'hello' }], {
        maxOutputTokens: 100,
        timeoutMs: 1_000,
      })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DesignError);
    expect((error as DesignError).code).toBe('INTERNAL_ERROR');
    expect((error as Error).message).toBe('AI provider responded with HTTP 429');
    expect((error as Error).message).not.toContain('sk-ant-secret');
  });

  it('rejects Anthropic responses with no text block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(JSON.stringify({ content: [{ type: 'tool_use' }] }), { status: 200 }),
      ),
    );

    await expect(
      createProvider(anthropicConfig).complete([{ role: 'user', content: 'hello' }], {
        maxOutputTokens: 100,
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });

  it('keeps the OpenAI-compatible bearer transport unchanged', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'openai text' } }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reply = await createProvider({
      ...anthropicConfig,
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example/v1',
    }).complete([{ role: 'user', content: 'hello' }], {
      maxOutputTokens: 200,
      timeoutMs: 1_000,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer sk-ant-secret' });
    expect(init?.headers).not.toHaveProperty('x-api-key');
    expect(reply).toMatchObject({ text: 'openai text', inputTokens: 5, outputTokens: 3 });
  });
});

describe('AI routes', () => {
  let app: FastifyInstance;
  let service: AiService;

  beforeAll(async () => {
    service = serviceWith([designHtml(), designHtml({ color: '#38bdf8' })]).service;
    app = await buildServer({ logger: false, ai: service });
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates through the API and reports the model', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/generate',
      payload: generateInput,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.usage.model).toBe('fake-model-1');
  });

  it('edits through the API and returns only the merged design', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/edit',
      payload: editInput,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).not.toHaveProperty('snapshotId');
    expect(response.json().data.designHtml).toContain('data-id="title"');
  });

  it('answers SPEND_CAP_EXCEEDED with 402 before calling the provider', async () => {
    const capped = serviceWith([designHtml()], {
      ledger: new DailySpendLedger(0.00001),
    });
    const cappedApp = await buildServer({ logger: false, ai: capped.service });
    const response = await cappedApp.inject({
      method: 'POST',
      url: '/api/ai/generate',
      payload: generateInput,
    });
    expect(response.statusCode).toBe(402);
    expect(response.json().error.code).toBe('SPEND_CAP_EXCEEDED');
    expect(capped.calls).toHaveLength(0);
    await cappedApp.close();
  });
});
