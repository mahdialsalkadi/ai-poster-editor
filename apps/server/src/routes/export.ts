import type { FastifyInstance } from 'fastify';
import { EXPORT_LIMITS, exportRequestSchema } from '@poster/contracts';
import { DesignError } from '@poster/core';
import { requestIdOf } from '../errors.js';

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/export', async (request) => {
    // The schema is the validation boundary until the worker exists: it refuses
    // Design HTML, unknown formats, non-integer scales and oversized asset lists
    // before the feature error below. Canonicalization, asset re-validation and
    // rendering all belong to the milestone 6 worker (docs/contract.md §12.1).
    exportRequestSchema.parse(request.body);
    throw new DesignError(
      'UNSUPPORTED_FEATURE',
      'The export worker arrives in milestone 6; the request contract is documented in docs/contract.md',
      'export',
    );
  });

  app.get('/export/limits', async (request) => ({
    data: EXPORT_LIMITS,
    requestId: requestIdOf(request),
  }));
}
