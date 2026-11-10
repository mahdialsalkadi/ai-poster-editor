import type { FastifyInstance } from 'fastify';
import type { Guard } from '../auth/guard.js';
import { DesignError } from '@poster/core';
import { requestIdOf } from '../errors.js';

export function assetRoutes(options: { guard: Guard }) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.addHook('preHandler', options.guard);

    app.post('/assets', async () => {
      throw new DesignError(
        'UNSUPPORTED_FEATURE',
        'Standalone asset uploads are disabled; send referenced assets with POST /api/export',
      );
    });

    app.get('/assets/limits', async (request) => ({
      data: {
        maxBytesPerAsset: 10 * 1024 * 1024,
        maxDimension: 8_000,
        maxPixelsPerAsset: 40_000_000,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      },
      requestId: requestIdOf(request),
    }));
  };
}
