import {
  DesignError,
  LIMITS,
  mergeScopedEdit,
  parseDesignHtml,
  serializeDesignDoc,
  validateDesignDoc,
  type DesignDoc,
  type Warning,
} from '@poster/core';
import type {
  AiUsage,
  EditDesignRequest,
  EditDesignResponse,
  GenerateDesignRequest,
  GeneratedDesignResponse,
} from '@poster/contracts';
import {
  buildEditMessages,
  buildGenerateMessages,
  estimatePromptTokens,
  extractDesignHtml,
  withRetryNote,
} from './prompt.js';
import {
  createProvider,
  providerConfigFromEnv,
  type AiMessage,
  type AiProvider,
  type ProviderReply,
} from './provider.js';
import {
  DailySpendLedger,
  estimateCost,
  FileSpendStore,
  type LedgerLogger,
  type Prices,
} from './spend.js';
import { SlidingWindowLimiter } from './rate-limit.js';

export type AiRequestContext = { ip: string; sessionId: string; projectId: string };

export type AiServiceOptions = {
  provider: AiProvider;
  prices: Prices;
  ledger: DailySpendLedger;
  maxOutputTokens: number;
  timeoutMs: number;
  generateLimiter?: SlidingWindowLimiter | undefined;
  editLimiter?: SlidingWindowLimiter | undefined;
  sessionLimiter?: SlidingWindowLimiter | undefined;
};

type UsageAccumulator = {
  input: number;
  output: number;
  cost: number;
  latency: number;
  model: string;
};

type Attempt<T> = { value: T; warnings: Warning[] };

function toInvalidOutput(cause: unknown): DesignError {
  if (cause instanceof DesignError && cause.code === 'AI_INVALID_OUTPUT') return cause;
  if (cause instanceof DesignError) {
    return new DesignError(
      'AI_INVALID_OUTPUT',
      `The AI output failed validation: ${cause.message}`,
      'ai',
    );
  }
  return new DesignError('AI_INVALID_OUTPUT', 'The AI output failed validation', 'ai');
}

function roundCost(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export class AiService {
  private readonly provider: AiProvider;
  private readonly prices: Prices;
  private readonly ledger: DailySpendLedger;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;
  private readonly generateLimiter: SlidingWindowLimiter;
  private readonly editLimiter: SlidingWindowLimiter;
  private readonly sessionLimiter: SlidingWindowLimiter;

  constructor(options: AiServiceOptions) {
    this.provider = options.provider;
    this.prices = options.prices;
    this.ledger = options.ledger;
    this.maxOutputTokens = options.maxOutputTokens;
    this.timeoutMs = options.timeoutMs;
    this.generateLimiter =
      options.generateLimiter ??
      new SlidingWindowLimiter(LIMITS.rateLimit.aiGeneratePerMinutePerIp, 60_000);
    this.editLimiter =
      options.editLimiter ??
      new SlidingWindowLimiter(LIMITS.rateLimit.aiEditPerMinutePerIp, 60_000);
    this.sessionLimiter =
      options.sessionLimiter ??
      new SlidingWindowLimiter(LIMITS.rateLimit.aiGeneratePerHourPerSession, 3_600_000);
  }

  async generate(
    input: GenerateDesignRequest,
    context: AiRequestContext,
  ): Promise<GeneratedDesignResponse> {
    this.take(this.generateLimiter, context.ip, 'generate');
    this.take(this.sessionLimiter, context.sessionId, 'generate');

    const messages = buildGenerateMessages({
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      language: input.language,
      style: input.style,
    });

    const result = await this.attempt(messages, (html) => {
      const parsed = parseDesignHtml(html);
      if (parsed.doc.layers.length > LIMITS.ai.maxLayers) {
        throw new DesignError(
          'AI_INVALID_OUTPUT',
          `The AI design has more than ${LIMITS.ai.maxLayers} layers`,
          'ai',
        );
      }
      if (parsed.doc.width !== input.width || parsed.doc.height !== input.height) {
        throw new DesignError(
          'AI_INVALID_OUTPUT',
          'The AI design does not match the requested artboard size',
          'ai',
        );
      }
      const doc = validateDesignDoc(parsed.doc);
      return { value: serializeDesignDoc(doc), warnings: parsed.warnings };
    });

    return { designHtml: result.value, warnings: result.warnings, usage: result.usage };
  }

  async edit(input: EditDesignRequest, context: AiRequestContext): Promise<EditDesignResponse> {
    const base = parseDesignHtml(input.designHtml).doc;
    const baseIds = new Set(base.layers.map((layer) => layer.id));
    const selected = input.selectedLayerIds.filter((id) => baseIds.has(id));
    if (selected.length === 0) {
      throw new DesignError(
        'INVALID_DOC',
        'None of the selected layers exist in the document',
        'selectedLayerIds',
      );
    }

    this.take(this.editLimiter, context.ip, 'edit');

    const messages = buildEditMessages({
      designHtml: serializeDesignDoc(base),
      instruction: input.instruction,
      selectedLayerIds: selected,
      allowNewLayers: input.allowNewLayers,
    });

    const result = await this.attempt(messages, (html) => {
      const patch = parseDesignHtml(html).doc;
      if (!input.allowNewLayers) {
        const unknown = patch.layers
          .filter((layer) => !baseIds.has(layer.id))
          .map((layer) => layer.id);
        if (unknown.length > 0) {
          throw new DesignError(
            'AI_INVALID_OUTPUT',
            `The edit introduced layers that were not allowed: ${unknown.slice(0, 3).join(', ')}`,
            'ai',
          );
        }
      }

      const merged = mergeScopedEdit(base, html, selected);
      if (merged.doc.layers.length > LIMITS.document.maxLayers) {
        throw new DesignError('AI_INVALID_OUTPUT', 'The edit exceeds the layer limit', 'ai');
      }

      return {
        value: { designHtml: serializeDesignDoc(merged.doc) },
        warnings: merged.warnings,
      };
    });

    return {
      designHtml: result.value.designHtml,
      warnings: result.warnings,
      usage: result.usage,
    };
  }

  private take(limiter: SlidingWindowLimiter, key: string, kind: string): void {
    if (!limiter.take(key)) {
      throw new DesignError(
        'RATE_LIMITED',
        `Too many AI ${kind} requests; slow down and try again`,
        'ai',
      );
    }
  }

  private startUsage(): UsageAccumulator {
    return { input: 0, output: 0, cost: 0, latency: 0, model: this.provider.model };
  }

  private accumulate(usage: UsageAccumulator, reply: ProviderReply): void {
    usage.input += reply.inputTokens;
    usage.output += reply.outputTokens;
    usage.latency += reply.latencyMs;
    usage.cost += estimateCost(
      { input: reply.inputTokens, output: reply.outputTokens },
      this.prices,
    );
    usage.model = reply.model;
  }

  private finishUsage(usage: UsageAccumulator): AiUsage {
    return {
      model: usage.model,
      latencyMs: usage.latency,
      inputTokens: usage.input,
      outputTokens: usage.output,
      costUsd: roundCost(usage.cost),
    };
  }

  /**
   * Reserves and settles the worst-case cost of each provider attempt before it
   * starts. A validation retry therefore reserves its own budget and cannot spend
   * beyond the cap. Interpreted output is only applied after a successful parse.
   */
  private async attempt<T>(
    messages: AiMessage[],
    interpret: (html: string) => Attempt<T>,
  ): Promise<Attempt<T> & { usage: AiUsage }> {
    const usage = this.startUsage();
    let lastError: DesignError | null = null;

    for (let index = 0; index <= LIMITS.ai.retries; index += 1) {
      const outgoing = withRetryNote(messages, lastError?.message);
      const estimate = estimateCost(
        { input: estimatePromptTokens(outgoing), output: this.maxOutputTokens },
        this.prices,
      );
      const reserved = this.ledger.reserve(estimate);
      let reply: ProviderReply;
      try {
        reply = await this.provider.complete(outgoing, {
          maxOutputTokens: this.maxOutputTokens,
          timeoutMs: this.timeoutMs,
        });
      } catch (error) {
        this.ledger.settle(reserved, 0);
        throw error;
      }

      this.accumulate(usage, reply);
      this.ledger.settle(
        reserved,
        estimateCost({ input: reply.inputTokens, output: reply.outputTokens }, this.prices),
        reply.model,
      );

      const html = extractDesignHtml(reply.text);
      if (Buffer.byteLength(html, 'utf8') > LIMITS.ai.maxOutputBytes) {
        lastError = new DesignError('AI_INVALID_OUTPUT', 'The AI response is too large', 'ai');
        continue;
      }

      try {
        const result = interpret(html);
        if (result.warnings.some((item) => item.code === 'UNSUPPORTED_COLOR')) {
          throw new DesignError(
            'AI_INVALID_OUTPUT',
            'Unsupported color in AI output; use only #rrggbb or #rrggbbaa colors',
            'ai',
          );
        }
        return { ...result, usage: this.finishUsage(usage) };
      } catch (cause) {
        lastError = toInvalidOutput(cause);
      }
    }
    throw lastError ?? new DesignError('AI_INVALID_OUTPUT', 'The AI response was invalid', 'ai');
  }
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function requiredPrice(env: NodeJS.ProcessEnv, key: string): number {
  const raw = env[key]?.trim();
  if (!raw) {
    throw new Error(
      `${key} is required when AI_PROVIDER is configured; no default price is assumed`,
    );
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative number`);
  }
  return value;
}

/**
 * Builds the configured service, or null when the deployment has no provider or
 * `AI_DISABLED=true`. Prices are mandatory because a default could silently
 * under- or over-state real provider billing.
 */
export function createAiServiceFromEnv(
  env: NodeJS.ProcessEnv,
  logger?: LedgerLogger,
): AiService | null {
  if (env.AI_DISABLED?.trim() === 'true') return null;
  const config = providerConfigFromEnv(env);
  if (!config) return null;

  const cap = positiveNumber(env.AI_DAILY_SPEND_CAP_USD ?? env.AI_DAILY_BUDGET_USD, 5);
  const ledgerPath = env.AI_SPEND_LEDGER_PATH?.trim() || '.data/ai-spend.json';
  const ledger = new DailySpendLedger({
    capUsd: cap > 0 ? cap : 5,
    store: new FileSpendStore(ledgerPath),
    ...(logger
      ? {
          onSettle: (info) =>
            logger.info(
              {
                event: 'ai.spend.settlement',
                day: info.day,
                reservedUsd: info.reservedUsd,
                actualUsd: info.actualUsd,
                spentUsd: info.spentUsd,
                capUsd: info.capUsd,
                ...(info.model ? { model: info.model } : {}),
              },
              'AI spend settled',
            ),
        }
      : {}),
  });

  return new AiService({
    provider: createProvider(config),
    prices: {
      inputPerMTok: requiredPrice(env, 'AI_INPUT_USD_PER_MTOK'),
      outputPerMTok: requiredPrice(env, 'AI_OUTPUT_USD_PER_MTOK'),
    },
    ledger,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
  });
}

export type { DesignDoc };
