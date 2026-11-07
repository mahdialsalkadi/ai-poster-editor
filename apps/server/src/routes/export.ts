import type { FastifyInstance } from 'fastify';
import { exportRequestSchema } from '@poster/contracts';
import { DesignError, parseDesignHtml } from '@poster/core';
import { requestIdOf } from '../errors.js';

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/export', async (request) => {
    const body = exportRequestSchema.parse(request.body);
    // Validate before rejecting so clients get the same diagnostics they would
    // get from a real export worker.
    parseDesignHtml(body.designHtml);
    throw new DesignError(
      'UNSUPPORTED_FEATURE',
      'The isolated export worker is not enabled in M0',
    );
  });

  app.get('/export/limits', async (request) => ({
    data: {
      maxOutputPixels: 40_000_000,
      maxResponseBytes: 40 * 1024 * 1024,
      timeoutMs: 15_000,
      concurrency: 2,
      queueMax: 20,
    },
    requestId: requestIdOf(request),
  }));
}
