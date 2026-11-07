import type { Warning } from '@poster/core';

/**
 * Thin client for the local API. The web app deliberately talks to the same
 * HTTP contract the future Canva-style backend will expose, so the editor does
 * not depend on server internals.
 */

export type ApiWarning = Pick<Warning, 'code' | 'message' | 'path' | 'severity'> & {
  layerId?: string;
};

export type ApiFailure = {
  status: number;
  code: string;
  message: string;
  path?: string;
  requestId?: string;
};

export type ApiResult<T> =
  | { ok: true; data: T; warnings: ApiWarning[]; requestId: string }
  | { ok: false; error: ApiFailure };

type Envelope<T> = {
  data: T;
  warnings?: ApiWarning[];
  requestId?: string;
};

type ErrorBody = {
  error?: {
    code?: string;
    message?: string;
    path?: string;
    requestId?: string;
  };
};

const ROUTES = {
  generate: '/api/ai/generate',
  edit: '/api/ai/edit',
  health: '/api/health',
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      return {
        ok: false,
        error: { status: 0, code: 'ABORTED', message: 'تم إلغاء الطلب' },
      };
    }
    return {
      ok: false,
      error: {
        status: 0,
        code: 'NETWORK',
        message: 'تعذر الاتصال بالخادم. تأكد من تشغيل واجهة API.',
      },
    };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const bodyValue = isObject(payload) ? (payload as ErrorBody) : {};
    const error = bodyValue.error ?? {};
    return {
      ok: false,
      error: {
        status: response.status,
        code: typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR',
        message:
          typeof error.message === 'string'
            ? error.message
            : `فشل الطلب (${response.status})`,
        ...(typeof error.path === 'string' ? { path: error.path } : {}),
        ...(typeof error.requestId === 'string' ? { requestId: error.requestId } : {}),
      },
    };
  }

  if (!isObject(payload) || !('data' in payload)) {
    return {
      ok: false,
      error: {
        status: response.status,
        code: 'INTERNAL_ERROR',
        message: 'استجابة الخادم غير صالحة',
      },
    };
  }

  const envelope = payload as Envelope<T>;
  return {
    ok: true,
    data: envelope.data,
    warnings: envelope.warnings ?? [],
    requestId: envelope.requestId ?? '',
  };
}

export type AiUsage = {
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type GeneratedDesign = {
  designHtml: string;
  warnings: ApiWarning[];
  usage: AiUsage;
};

export type GenerateDesignInput = {
  prompt: string;
  width: number;
  height: number;
  language: 'auto' | 'ar' | 'en';
  style?: string;
};

export function generateDesign(
  input: GenerateDesignInput,
  signal?: AbortSignal,
): Promise<ApiResult<GeneratedDesign>> {
  return postJson<GeneratedDesign>(ROUTES.generate, input, signal);
}

export type EditDesignInput = {
  designHtml: string;
  instruction: string;
  selectedLayerIds: string[];
  allowNewLayers: boolean;
};

export function editDesign(
  input: EditDesignInput,
  signal?: AbortSignal,
): Promise<ApiResult<GeneratedDesign>> {
  return postJson<GeneratedDesign>(ROUTES.edit, input, signal);
}

export type Health = {
  status: string;
  version: string;
  milestone: string;
};

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(ROUTES.health, { headers: { accept: 'application/json' } });
    return response.ok;
  } catch {
    return false;
  }
}
