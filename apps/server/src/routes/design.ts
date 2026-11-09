import type { FastifyInstance } from 'fastify';
import type { Guard } from '../auth/guard.js';
import {
  mergeDesignRequestSchema,
  serializeDesignRequestSchema,
  validateDesignRequestSchema,
} from '@poster/contracts';
import {
  mergeDesignDoc,
  parseDesignHtml,
  serializeDesignDoc,
  validateDesignDoc,
} from '@poster/core';
import { requestIdOf } from '../errors.js';

export function designRoutes(options: { guard: Guard; limit: Guard }) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.addHook('preHandler', options.guard);
    app.addHook('preHandler', options.limit);

    app.post('/validate', async (request) => {
      const body = validateDesignRequestSchema.parse(request.body);
      const { doc, warnings } = parseDesignHtml(body.designHtml);
      return { data: { doc, warnings }, requestId: requestIdOf(request) };
    });

    app.post('/serialize', async (request) => {
      const body = serializeDesignRequestSchema.parse(request.body);
      const doc = validateDesignDoc(body.doc);
      return {
        data: { designHtml: serializeDesignDoc(doc), warnings: [] },
        requestId: requestIdOf(request),
      };
    });

    app.post('/merge', async (request) => {
      const body = mergeDesignRequestSchema.parse(request.body);
      const result = mergeDesignDoc(body.base, body.patch, {
        ...(body.selectedLayerIds ? { selectedLayerIds: body.selectedLayerIds } : {}),
        allowNewLayers: body.allowNewLayers,
        allowArtboardChanges: body.allowArtboardChanges,
      });
      return {
        data: {
          doc: result.doc,
          designHtml: serializeDesignDoc(result.doc),
          warnings: result.warnings,
        },
        requestId: requestIdOf(request),
      };
    });
  };
}
