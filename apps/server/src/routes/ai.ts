import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Guard } from '../auth/guard.js';
import { editDesignRequestSchema, generateDesignRequestSchema } from '@poster/contracts';
import { DesignError } from '@poster/core';
import type { AiRequestContext, AiService } from '../ai/service.js';
import { requestIdOf } from '../errors.js';

function contextOf(request: FastifyRequest): AiRequestContext {
  const principal = request.auth;
  const id = principal?.id ?? request.ip;
  return {
    ip: request.ip,
    sessionId: id,
    projectId: id,
  };
}

function unavailable(): DesignError {
  return new DesignError(
    'UNSUPPORTED_FEATURE',
    'AI is disabled or not configured on this server; check AI_DISABLED, AI_PROVIDER, AI_MODEL and AI_API_KEY (docs/contract.md §12.2)',
    'ai',
  );
}

export function aiRoutes(options: { ai: AiService | null; guard: Guard }) {
  return async function register(app: FastifyInstance): Promise<void> {
    const service = options.ai;
    app.addHook('preHandler', options.guard);

    app.post('/generate', async (request) => {
      if (!service) throw unavailable();
      const body = generateDesignRequestSchema.parse(request.body);
      const data = await service.generate(body, contextOf(request));
      return { data, requestId: requestIdOf(request) };
    });

    app.post('/edit', async (request) => {
      if (!service) throw unavailable();
      const body = editDesignRequestSchema.parse(request.body);
      const data = await service.edit(body, contextOf(request));
      return { data, requestId: requestIdOf(request) };
    });
  };
}
