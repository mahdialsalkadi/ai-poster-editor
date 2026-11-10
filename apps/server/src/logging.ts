import type { Writable } from 'node:stream';

/** Request bodies, URL paths and queries are deliberately omitted from logs. */
export function loggerOptions(stream?: Writable) {
  return {
    ...(stream ? { stream } : {}),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        'headers.authorization',
        'headers.cookie',
        'headers["x-api-key"]',
        'headers["set-cookie"]',
      ],
      censor: '[Redacted]',
    },
    serializers: {
      req: (request: { method: string }) => ({ method: request.method }),
      res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
    },
  };
}
