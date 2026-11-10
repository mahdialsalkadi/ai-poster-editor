import { DesignError, LIMITS } from '@poster/core';

export type AiMessage = { role: 'system' | 'user'; content: string };

export type ProviderReply = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type AiProvider = {
  readonly name: string;
  readonly model: string;
  complete(
    messages: readonly AiMessage[],
    options: { maxOutputTokens: number; timeoutMs: number },
  ): Promise<ProviderReply>;
};

export type ProviderConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  maxOutputTokens: number;
  timeoutMs: number;
};

const SUPPORTED_PROVIDERS = new Set(['openai', 'openai-compatible', 'anthropic']);

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads the provider settings from the environment. A missing provider, model
 * or key disables AI entirely instead of failing at request time; the key is
 * only ever held here and never logged or returned.
 */
export function providerConfigFromEnv(env: NodeJS.ProcessEnv): ProviderConfig | null {
  const provider = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  const model = (env.AI_MODEL ?? '').trim();
  const apiKey = (env.AI_API_KEY ?? '').trim();
  if (!provider || provider === 'none' || !model || !apiKey) return null;
  if (!SUPPORTED_PROVIDERS.has(provider)) return null;

  const defaultBaseUrl =
    provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
  const baseUrl = (env.AI_BASE_URL?.trim() || defaultBaseUrl).replace(/\/+$/, '');
  return {
    provider,
    model,
    apiKey,
    baseUrl,
    maxOutputTokens: Math.min(
      positiveInt(env.AI_MAX_OUTPUT_TOKENS, LIMITS.ai.maxOutputTokens),
      LIMITS.ai.maxOutputTokens,
    ),
    timeoutMs: Math.min(positiveInt(env.AI_TIMEOUT_MS, LIMITS.ai.timeoutMs), LIMITS.ai.timeoutMs),
  };
}

function completionText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === 'string' && content.trim().length > 0 ? content : null;
}

function tokenUsage(payload: unknown): { input: number; output: number } {
  if (typeof payload !== 'object' || payload === null) return { input: 0, output: 0 };
  const usage = (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } })
    .usage;
  const input = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const output = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;
  return { input, output };
}

function anthropicCompletionText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('');
  return text.trim().length > 0 ? text : null;
}

function anthropicTokenUsage(payload: unknown): { input: number; output: number } {
  if (typeof payload !== 'object' || payload === null) return { input: 0, output: 0 };
  const usage = (payload as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
  const input = typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0;
  const output = typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0;
  return { input, output };
}

/** Anthropic accepts a system prompt separately and requires no system role in messages. */
function anthropicRequest(
  config: ProviderConfig,
  messages: readonly AiMessage[],
  maxOutputTokens: number,
): Record<string, unknown> {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  return {
    model: config.model,
    max_tokens: maxOutputTokens,
    temperature: 0.8,
    ...(system ? { system } : {}),
    messages: messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content })),
  };
}

function anthropicEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/v1$/i, '')}/v1/messages`;
}

/** Selected transport; the only outbound network call in this module. */
export function createProvider(config: ProviderConfig): AiProvider {
  const anthropic = config.provider === 'anthropic';
  return {
    name: config.provider,
    model: config.model,
    async complete(messages, options) {
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetch(
          anthropic ? anthropicEndpoint(config.baseUrl) : `${config.baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: anthropic
              ? {
                  'content-type': 'application/json',
                  'x-api-key': config.apiKey,
                  'anthropic-version': '2023-06-01',
                }
              : {
                  'content-type': 'application/json',
                  authorization: `Bearer ${config.apiKey}`,
                },
            body: JSON.stringify(
              anthropic
                ? anthropicRequest(config, messages, options.maxOutputTokens)
                : {
                    model: config.model,
                    messages,
                    max_tokens: options.maxOutputTokens,
                    temperature: 0.8,
                  },
            ),
            signal: AbortSignal.timeout(options.timeoutMs),
          },
        );
      } catch (cause) {
        const reason =
          cause instanceof Error && cause.name === 'TimeoutError' ? 'timed out' : 'failed';
        throw new DesignError('INTERNAL_ERROR', `AI provider request ${reason}`, 'ai');
      }

      if (!response.ok) {
        throw new DesignError(
          'INTERNAL_ERROR',
          `AI provider responded with HTTP ${response.status}`,
          'ai',
        );
      }

      const payload: unknown = await response.json().catch(() => null);
      const text = anthropic ? anthropicCompletionText(payload) : completionText(payload);
      if (text === null) {
        throw new DesignError('AI_INVALID_OUTPUT', 'AI provider returned no text', 'ai');
      }
      const usage = anthropic ? anthropicTokenUsage(payload) : tokenUsage(payload);
      return {
        text,
        model: config.model,
        inputTokens: usage.input,
        outputTokens: usage.output,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}
