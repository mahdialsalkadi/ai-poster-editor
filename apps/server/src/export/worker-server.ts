import { createHash, timingSafeEqual } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { API_ERROR_STATUS } from '@poster/contracts';
import { DesignError, LIMITS } from '@poster/core';
import { RenderQueue } from './queue.js';
import { renderHtml } from './renderer-core.js';
import { remoteRenderJobSchema } from './worker-protocol.js';
import { loggerOptions } from '../logging.js';

export type WorkerServerOptions = {
  logger?: boolean;
  logStream?: Writable;
  sandbox?: boolean;
  token?: string;
  queue?: RenderQueue;
};

function constantTimeEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left, 'utf8').digest();
  const b = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function authorized(request: FastifyRequest, token: string | undefined): boolean {
  if (!token) return true;
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  return constantTimeEqual(header.slice('Bearer '.length).trim(), token);
}

/**
 * Internal HTTP boundary around the renderer, used by the worker container.
 * It is not part of the public API and should only be reachable from the API
 * service on an internal Docker network. An optional bearer token protects
 * against accidental lateral access.
 */
export async function buildWorkerServer(
  options: WorkerServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: (options.logger ?? process.env.NODE_ENV !== 'test') && loggerOptions(options.logStream),
    bodyLimit: LIMITS.export.maxResponseBytes * 4,
  });
  const sandbox = options.sandbox ?? process.env.EXPORT_CHROMIUM_SANDBOX !== 'false';
  const token = options.token ?? process.env.EXPORT_WORKER_TOKEN?.trim() ?? undefined;
  const queue =
    options.queue ??
    new RenderQueue(1, 4, (metrics) =>
      app.log.info({ event: 'export.queue', scope: 'worker', ...metrics }, 'Export queue changed'),
    );

  app.get('/health', async () => ({
    status: 'ok',
    service: 'poster-worker',
    version: '0.1.0',
    sandbox,
  }));

  app.post('/render', async (request, reply) => {
    if (!authorized(request, token)) {
      throw new DesignError('UNAUTHORIZED', 'Worker authorization is required', 'worker');
    }
    const job = remoteRenderJobSchema.parse(request.body);
    const result = await queue.run(() => renderHtml({ ...job, sandbox }));
    void reply
      .header('content-type', result.contentType)
      .header('x-export-width', String(result.width))
      .header('x-export-height', String(result.height))
      .header('cache-control', 'no-store')
      .send(result.bytes);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DesignError) {
      const status = API_ERROR_STATUS[error.code] ?? 500;
      if (status >= 500) {
        request.log.error(
          { event: 'worker.error', code: error.code, status },
          'Worker request failed',
        );
      }
      void reply.status(status).send({ error: { code: error.code, message: error.message } });
      return;
    }
    request.log.error({ event: 'worker.error', status: 500 }, 'Worker request failed');
    void reply
      .status(500)
      .send({ error: { code: 'EXPORT_FAILED', message: 'The export worker failed' } });
  });

  return app;
}
