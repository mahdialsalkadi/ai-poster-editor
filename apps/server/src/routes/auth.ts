import type { FastifyInstance } from 'fastify';
import { loginRequestSchema } from '@poster/contracts';
import { DesignError } from '@poster/core';
import { requestIdOf } from '../errors.js';
import { requirePrincipal, type Guard } from '../auth/guard.js';
import type { AuthService } from '../auth/service.js';

export function authRoutes(options: { auth: AuthService | null; guard: Guard; loginLimit: Guard }) {
  return async function register(app: FastifyInstance): Promise<void> {
    const service = options.auth;

    app.post('/login', { preHandler: options.loginLimit }, async (request, reply) => {
      if (!service?.supabaseEnabled) {
        throw new DesignError(
          'UNSUPPORTED_FEATURE',
          'Sign-in is not configured on this server',
          'auth',
        );
      }
      const body = loginRequestSchema.parse(request.body);
      const session = await service.login(body.email, body.password);
      void reply.header('set-cookie', service.sessionCookie(session));
      return {
        data: {
          user: {
            id: session.userId,
            ...(session.email ? { email: session.email } : {}),
            method: 'supabase' as const,
          },
        },
        requestId: requestIdOf(request),
      };
    });

    app.post('/logout', async (request, reply) => {
      if (service) {
        const session = service.readCookie(request.headers.cookie);
        await service.logout(session?.accessToken);
        void reply.header('set-cookie', service.clearCookie());
      }
      return {
        data: { ok: true, method: request.auth?.method ?? 'public' },
        requestId: requestIdOf(request),
      };
    });

    app.get('/me', { preHandler: options.guard }, async (request) => {
      const principal = requirePrincipal(request);
      return {
        data: {
          user: {
            id: principal.id,
            ...(principal.email ? { email: principal.email } : {}),
            method: principal.method,
          },
        },
        requestId: requestIdOf(request),
      };
    });
  };
}
