import type { FastifyInstance, FastifyRequest } from 'fastify';
import { editDesignRequestSchema, generateDesignRequestSchema } from '@poster/contracts';
import { DesignError, serializeDesignDoc } from '@poster/core';
import type { AiRequestContext, AiService } from '../ai/service.js';
import { requestIdOf } from '../errors.js';

function contextOf(request: FastifyRequest): AiRequestContext {
  const session = request.headers['x-session-id'];
  const project = request.headers['x-project-id'];
  return {
    ip: request.ip,
    sessionId: typeof session === 'string' && session.length > 0 ? session : request.ip,
    projectId: typeof project === 'string' && project.length > 0 ? project : 'default',
  };
}

function unavailable(): DesignError {
  return new DesignError(
    'UNSUPPORTED_FEATURE',
    'AI is not configured on this server: set AI_PROVIDER, AI_MODEL and AI_API_KEY (docs/contract.md §12.2)',
    'ai',
  );
}

export function aiRoutes(options: { ai: AiService | null }) {
  return async function register(app: FastifyInstance): Promise<void> {
    const service = options.ai;

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

    app.get('/snapshots/:id', async (request) => {
      if (!service) throw unavailable();
      const params = request.params as { id?: unknown };
      const id = typeof params.id === 'string' ? params.id : '';
      const snapshot = service.getSnapshot(id);
      if (!snapshot) {
        throw new DesignError('NOT_FOUND', 'Snapshot not found', 'snapshotId');
      }
      return {
        data: {
          snapshotId: snapshot.id,
          createdAt: snapshot.createdAt,
          doc: snapshot.doc,
          designHtml: serializeDesignDoc(snapshot.doc),
        },
        requestId: requestIdOf(request),
      };
    });
  };
}
