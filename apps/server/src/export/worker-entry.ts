import { DesignError, type ErrorCode } from '@poster/core';
import { closeRendererBrowser, renderHtml, type BrowserRenderJob } from './renderer-core.js';

type RenderMessage = { type: 'render'; id: number; job: BrowserRenderJob };
type WorkerError = { code: ErrorCode; message: string; path?: string };

type WorkerReply =
  | {
      type: 'result';
      id: number;
      result: { bytes: Buffer; width: number; height: number; contentType: string };
    }
  | { type: 'error'; id: number; error: WorkerError };

const FORMATS = new Set(['png', 'jpeg', 'pdf']);

function isRenderMessage(value: unknown): value is RenderMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RenderMessage>;
  if (message.type !== 'render' || typeof message.id !== 'number') return false;
  const job = message.job as Partial<BrowserRenderJob> | undefined;
  if (typeof job !== 'object' || job === null) return false;
  return (
    typeof job.html === 'string' &&
    typeof job.width === 'number' &&
    Number.isInteger(job.width) &&
    typeof job.height === 'number' &&
    Number.isInteger(job.height) &&
    typeof job.format === 'string' &&
    FORMATS.has(job.format) &&
    (job.scale === 1 || job.scale === 2 || job.scale === 3) &&
    typeof job.quality === 'number' &&
    typeof job.sandbox === 'boolean'
  );
}

function failure(cause: unknown): WorkerError {
  if (cause instanceof DesignError) {
    return {
      code: cause.code,
      message: cause.message,
      ...(cause.path ? { path: cause.path } : {}),
    };
  }
  return { code: 'EXPORT_FAILED', message: 'The export worker failed' };
}

function send(reply: WorkerReply): void {
  process.send?.(reply);
}

let queue: Promise<void> = Promise.resolve();

process.on('message', (message: unknown) => {
  if (!isRenderMessage(message)) return;
  const { id, job } = message;
  queue = queue.then(async () => {
    try {
      const result = await renderHtml(job);
      send({ type: 'result', id, result });
    } catch (cause) {
      send({ type: 'error', id, error: failure(cause) });
    }
  });
});

async function shutdown(): Promise<void> {
  await closeRendererBrowser().catch(() => undefined);
  process.exit(0);
}

process.on('disconnect', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
