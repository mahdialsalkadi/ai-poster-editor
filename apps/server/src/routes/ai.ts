import type { FastifyInstance } from 'fastify';
import { editDesignRequestSchema, generateDesignRequestSchema } from '@poster/contracts';
import { DesignError } from '@poster/core';
import { requestIdOf } from '../errors.js';
import { generateLocalDesign } from '../local-generator.js';

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/generate', async (request) => {
    const body = generateDesignRequestSchema.parse(request.body);
    const provider = process.env.AI_PROVIDER ?? 'local';
    if (provider !== 'local') {
      throw new DesignError(
        'UNSUPPORTED_FEATURE',
        `AI provider "${provider}" is not wired yet; use AI_PROVIDER=local for the deterministic template`,
      );
    }
    return { data: generateLocalDesign(body), requestId: requestIdOf(request) };
  });

  app.post('/edit', async (request) => {
    editDesignRequestSchema.parse(request.body);
    throw new DesignError(
      'UNSUPPORTED_FEATURE',
      'Selection-scoped AI editing requires a configured provider; it is not enabled in M0',
    );
  });
}
