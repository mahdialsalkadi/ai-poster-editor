import type { AuthUser } from '@poster/contracts';
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
  authLogin: '/api/auth/login',
  authLogout: '/api/auth/logout',
  authMe: '/api/auth/me',
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function sendJson<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'include', ...init });
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
          typeof error.message === 'string' ? error.message : `فشل الطلب (${response.status})`,
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

function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  return sendJson<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

function getJson<T>(path: string): Promise<ApiResult<T>> {
  return sendJson<T>(path, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
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

export type EditedDesign = GeneratedDesign;

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
  return postJson<EditedDesign>(ROUTES.edit, input, signal);
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

export type AuthSessionUser = AuthUser;

export function currentUser(): Promise<ApiResult<{ user: AuthUser }>> {
  return getJson<{ user: AuthUser }>(ROUTES.authMe);
}

export function login(email: string, password: string): Promise<ApiResult<{ user: AuthUser }>> {
  return postJson<{ user: AuthUser }>(ROUTES.authLogin, { email, password });
}

export function logout(): Promise<ApiResult<{ ok: boolean; method: string }>> {
  return postJson<{ ok: boolean; method: string }>(ROUTES.authLogout, {});
}
