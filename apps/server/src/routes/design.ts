import type { FastifyInstance } from 'fastify';
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
  type DesignDoc,
} from '@poster/core';
import { requestIdOf } from '../errors.js';

export async function designRoutes(app: FastifyInstance): Promise<void> {
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
    const result = mergeDesignDoc(body.base as DesignDoc, body.patch as DesignDoc, {
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
}
