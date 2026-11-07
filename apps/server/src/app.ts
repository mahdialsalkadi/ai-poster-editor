import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { LIMITS } from '@poster/core';
import { createAiServiceFromEnv, type AiService } from './ai/service.js';
import { registerErrorHandler, requestIdOf } from './errors.js';
import { ExportService } from './export/service.js';
import { aiRoutes } from './routes/ai.js';
import { assetRoutes } from './routes/assets.js';
import { designRoutes } from './routes/design.js';
import { exportRoutes } from './routes/export.js';

export type ServerOptions = {
  logger?: boolean;
  ai?: AiService | null;
  exportService?: ExportService;
};

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== 'test',
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
  });

  const ai = options.ai !== undefined ? options.ai : createAiServiceFromEnv(process.env);
  const exportService = options.exportService ?? new ExportService();
  const origin = process.env.PUBLIC_ORIGIN;
  await app.register(cors, {
    origin: origin ? [origin] : true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  // Export is the only multipart route; the limits mirror §12.1 and the
  // per-asset size is re-checked by `prepareAsset` before decoding.
  await app.register(multipart, {
    limits: {
      fileSize: LIMITS.export.maxRequestBytes,
      files: LIMITS.export.maxAssets,
      fields: 4,
      fieldSize: LIMITS.document.maxBytes * 2,
      parts: LIMITS.export.maxAssets + 4,
    },
  });

  registerErrorHandler(app);

  app.get('/api/health', async (request) => ({
    data: {
      status: 'ok',
      version: '0.1.0',
      milestone: 'M7',
      limits: {
        designBytes: LIMITS.document.maxBytes,
        layers: LIMITS.document.maxLayers,
        exportPixels: LIMITS.export.maxOutputPixels,
      },
    },
    requestId: requestIdOf(request),
  }));

  await app.register(designRoutes, { prefix: '/api/design' });
  await app.register(aiRoutes({ ai }), { prefix: '/api/ai' });
  await app.register(exportRoutes({ service: exportService }), { prefix: '/api' });
  await app.register(assetRoutes, { prefix: '/api' });

  return app;
}
