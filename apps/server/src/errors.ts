import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DesignError } from '@poster/core';
import { API_ERROR_STATUS, type ErrorEnvelope } from '@poster/contracts';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function safeRequestId(request: IncomingMessage): string {
  const header = request.headers['x-request-id'];
  return typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
}

export function requestIdOf(request: FastifyRequest): string {
  return request.id;
}

export function errorEnvelope(
  code: ErrorEnvelope['error']['code'],
  message: string,
  requestId: string,
  path?: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      requestId,
      ...(path === undefined ? {} : { path }),
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = requestIdOf(request);

    if (error instanceof DesignError) {
      const status = API_ERROR_STATUS[error.code] ?? 500;
      if (status >= 500) {
        request.log.error({ event: 'api.error', code: error.code, status }, 'API request failed');
      }
      void reply
        .status(status)
        .send(errorEnvelope(error.code, error.message, requestId, error.path, error.details));
      return;
    }

    if (error instanceof ZodError) {
      void reply.status(422).send(
        errorEnvelope('INVALID_DOC', 'Request failed validation', requestId, 'body', {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        }),
      );
      return;
    }

    const validation =
      typeof error === 'object' && error !== null && 'validation' in error
        ? (error as { validation: unknown }).validation
        : undefined;
    if (validation) {
      void reply.status(400).send(
        errorEnvelope('INVALID_DOC', 'Request failed validation', requestId, 'body', {
          issues: validation,
        }),
      );
      return;
    }

    // Error messages/stacks may contain provider credentials or user content.
    request.log.error({ event: 'api.error', status: 500 }, 'API request failed');
    void reply
      .status(500)
      .send(errorEnvelope('INTERNAL_ERROR', 'Internal server error', requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(errorEnvelope('NOT_FOUND', 'Route not found', requestIdOf(request)));
  });
}
