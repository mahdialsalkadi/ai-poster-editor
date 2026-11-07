import type { FastifyInstance } from 'fastify';
import { EXPORT_LIMITS, exportRequestSchema } from '@poster/contracts';
import { canonicalizeDoc, DesignError } from '@poster/core';
import { requestIdOf } from '../errors.js';

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/export', async (request) => {
    const body = exportRequestSchema.parse(request.body);
    // Validate before refusing so clients get the diagnostics the milestone 6
    // worker will return; canonicalization, asset re-validation and rendering
    // all belong to that worker (docs/contract.md §12.1).
    canonicalizeDoc(body.doc);
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
