import { DesignError, type ErrorCode } from '@poster/core';
import { closeRendererBrowser, renderHtml } from './renderer-core.js';
import { renderMessageSchema } from './worker-protocol.js';
type WorkerError = { code: ErrorCode; message: string; path?: string };

type WorkerReply =
  | {
      type: 'result';
      id: number;
      result: { bytes: Buffer; width: number; height: number; contentType: string };
    }
  | { type: 'error'; id: number; error: WorkerError };

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
  const parsed = renderMessageSchema.safeParse(message);
  if (!parsed.success) return;
  const { id, job } = parsed.data;
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
