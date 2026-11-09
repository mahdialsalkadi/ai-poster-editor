export const API_ROUTES = {
  health: '/api/health',
  designValidate: '/api/design/validate',
  designSerialize: '/api/design/serialize',
  designMerge: '/api/design/merge',
  aiGenerate: '/api/ai/generate',
  aiEdit: '/api/ai/edit',
  assets: '/api/assets',
  export: '/api/export',
  authLogin: '/api/auth/login',
  authLogout: '/api/auth/logout',
  authMe: '/api/auth/me',
} as const;

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];

export const API_ERROR_STATUS: Readonly<Record<string, number>> = {
  SECURITY_VIOLATION: 400,
  INVALID_DOC: 422,
  LIMIT_EXCEEDED: 413,
  UNSUPPORTED_FEATURE: 422,
  DUPLICATE_ID: 422,
  ASSET_UNRESOLVED: 422,
  EXPORT_FAILED: 500,
  AI_INVALID_OUTPUT: 502,
  SPEND_CAP_EXCEEDED: 402,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
} as const;
