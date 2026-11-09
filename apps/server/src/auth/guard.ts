import { DesignError } from '@poster/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SlidingWindowLimiter } from '../ai/rate-limit.js';
import type { AuthService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { id: string; method: 'supabase' | 'api-key' | 'public'; email?: string };
  }
}

/**
 * Registers authentication for a route scope. A `null` service means the
 * deployment deliberately runs without access control (development/tests or
 * `ALLOW_PUBLIC_API=true`); the synthetic principal still gives rate limiting
 * and logging a stable identity.
 */
export type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function authGuard(auth: AuthService | null) {
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!auth) {
      request.auth = { id: `public:${request.ip}`, method: 'public' };
      return;
    }
    const result = await auth.authenticate(request);
    if (result.renewed) {
      reply.header('set-cookie', auth.sessionCookie(result.renewed));
    }
    request.auth = result.principal;
  };
}

/** Keyed by authenticated principal and peer address, never by IP alone. */
export function rateLimitGuard(limiter: SlidingWindowLimiter, label: string): Guard {
  return async function limit(request: FastifyRequest): Promise<void> {
    const principal = request.auth?.id ?? 'anonymous';
    if (!limiter.take(`${principal}|${request.ip}`)) {
      throw new DesignError(
        'RATE_LIMITED',
        `Too many ${label} requests; slow down and try again`,
        label,
      );
    }
  };
}

export function requirePrincipal(request: FastifyRequest): {
  id: string;
  method: string;
  email?: string;
} {
  const principal = request.auth;
  if (!principal) {
    throw new DesignError('UNAUTHORIZED', 'Authentication is required', 'authorization');
  }
  return principal;
}
