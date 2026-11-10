import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Writable } from 'node:stream';
import { LIMITS } from '@poster/core';
import { createAiServiceFromEnv, type AiService } from './ai/service.js';
import { SlidingWindowLimiter } from './ai/rate-limit.js';
import { assertProductionAuth, createAuthFromEnv, type AuthService } from './auth/service.js';
import { authGuard, rateLimitGuard } from './auth/guard.js';
import { registerErrorHandler, requestIdOf } from './errors.js';
import { loggerOptions } from './logging.js';
import { ExportService } from './export/service.js';
import { RenderQueue } from './export/queue.js';
import { aiRoutes } from './routes/ai.js';
import { assetRoutes } from './routes/assets.js';
import { authRoutes } from './routes/auth.js';
import { designRoutes } from './routes/design.js';
import { exportRoutes } from './routes/export.js';

export type RateLimitOverrides = {
  designPerMinute?: number;
  exportPerMinute?: number;
  loginPerMinute?: number;
};

export type ServerOptions = {
  logger?: boolean;
  /** Optional destination for structured log records. */
  logStream?: Writable;
  ai?: AiService | null;
  exportService?: ExportService;
  /** `undefined` reads the environment; `null` explicitly disables access control. */
  auth?: AuthService | null;
  rateLimits?: RateLimitOverrides;
  /** Overrides `PUBLIC_ORIGIN` for CORS and cookie origin checks (tests). */
  publicOrigin?: string;
};

function trustProxy(value: string | undefined): boolean | string {
  if (!value) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return String(hops);
  return value;
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  assertProductionAuth(process.env);

  const app = Fastify({
    logger: (options.logger ?? process.env.NODE_ENV !== 'test') && loggerOptions(options.logStream),
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
    trustProxy: trustProxy(process.env.TRUST_PROXY),
  });

  const ai = options.ai !== undefined ? options.ai : createAiServiceFromEnv(process.env, app.log);
  if (process.env.AI_DISABLED?.trim() === 'true') app.log.warn('AI is disabled by AI_DISABLED');
  const exportService =
    options.exportService ??
    new ExportService({
      queue: new RenderQueue(undefined, undefined, (metrics) =>
        app.log.info({ event: 'export.queue', scope: 'api', ...metrics }, 'Export queue changed'),
      ),
    });
  const auth = options.auth !== undefined ? options.auth : createAuthFromEnv(process.env);
  const guard = authGuard(auth);
  const designLimiter = new SlidingWindowLimiter(
    options.rateLimits?.designPerMinute ?? LIMITS.rateLimit.designPerMinute,
    60_000,
  );
  const exportLimiter = new SlidingWindowLimiter(
    options.rateLimits?.exportPerMinute ?? LIMITS.rateLimit.exportPerMinutePerIp,
    60_000,
  );
  const loginLimiter = new SlidingWindowLimiter(
    options.rateLimits?.loginPerMinute ?? LIMITS.rateLimit.loginPerMinutePerIp,
    60_000,
  );
  const designLimit = rateLimitGuard(designLimiter, 'design');
  const exportLimit = rateLimitGuard(exportLimiter, 'export');
  const loginLimit = rateLimitGuard(loginLimiter, 'login');

  const origin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
  await app.register(cors, {
    origin: origin ? [origin] : process.env.NODE_ENV === 'production' ? false : true,
    credentials: true,
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

  await app.register(authRoutes({ auth, guard, loginLimit }), { prefix: '/api/auth' });
  await app.register(designRoutes({ guard, limit: designLimit }), { prefix: '/api/design' });
  await app.register(aiRoutes({ ai, guard }), { prefix: '/api/ai' });
  await app.register(exportRoutes({ service: exportService, guard, limit: exportLimit }), {
    prefix: '/api',
  });
  await app.register(assetRoutes({ guard }), { prefix: '/api' });

  return app;
}
