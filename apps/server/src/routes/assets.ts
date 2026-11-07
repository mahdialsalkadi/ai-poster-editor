import type { FastifyInstance } from 'fastify';
import { DesignError } from '@poster/core';
import { requestIdOf } from '../errors.js';

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  app.post('/assets', async () => {
    throw new DesignError(
      'UNSUPPORTED_FEATURE',
      'Asset uploads are not enabled in M0; image layers can reference existing asset ids',
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
}
