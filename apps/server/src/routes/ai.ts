import type { FastifyInstance } from 'fastify';
import { editDesignRequestSchema, generateDesignRequestSchema } from '@poster/contracts';
import { DesignError } from '@poster/core';

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/generate', async (request) => {
    generateDesignRequestSchema.parse(request.body);
    throw new DesignError(
      'UNSUPPORTED_FEATURE',
      'AI generation needs a configured provider; the deterministic local generator was removed (docs/contract.md §12.2)',
      'ai',
    );
  });

  app.post('/edit', async (request) => {
    editDesignRequestSchema.parse(request.body);
    throw new DesignError(
      'UNSUPPORTED_FEATURE',
      'Selection-scoped AI editing requires a configured provider (docs/contract.md §12.2)',
      'ai',
    );
  });
}
