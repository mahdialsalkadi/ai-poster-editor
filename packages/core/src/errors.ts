export type ErrorCode =
  | 'SECURITY_VIOLATION'
  | 'INVALID_DOC'
  | 'LIMIT_EXCEEDED'
  | 'UNSUPPORTED_FEATURE'
  | 'DUPLICATE_ID'
  | 'ASSET_UNRESOLVED'
  | 'EXPORT_FAILED'
  | 'AI_INVALID_OUTPUT'
  | 'SPEND_CAP_EXCEEDED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class DesignError extends Error {
  override readonly name: string = 'DesignError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly path?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class SecurityViolationError extends DesignError {
  override readonly name = 'SecurityViolationError';

  constructor(message: string, path?: string, details?: unknown) {
    super('SECURITY_VIOLATION', message, path, details);
  }
}

export class LimitExceededError extends DesignError {
  override readonly name = 'LimitExceededError';

  constructor(message: string, path?: string, details?: unknown) {
    super('LIMIT_EXCEEDED', message, path, details);
  }
}

export function isDesignError(value: unknown): value is DesignError {
  return value instanceof DesignError;
}
