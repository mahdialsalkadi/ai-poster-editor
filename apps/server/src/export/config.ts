import { LIMITS } from '@poster/core';

function boundedInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  const result = Number(raw);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return result;
}

/** Overrides may tighten, but cannot enlarge, the compiled resource ceilings. */
export function exportQueueConfig(env: NodeJS.ProcessEnv): {
  concurrency: number;
  maxWaiting: number;
} {
  return {
    concurrency: boundedInteger(
      env.EXPORT_CONCURRENCY,
      'EXPORT_CONCURRENCY',
      LIMITS.export.concurrency,
      1,
      LIMITS.export.concurrency,
    ),
    maxWaiting: boundedInteger(
      env.EXPORT_QUEUE_MAX,
      'EXPORT_QUEUE_MAX',
      LIMITS.export.queueMax,
      0,
      LIMITS.export.queueMax,
    ),
  };
}
