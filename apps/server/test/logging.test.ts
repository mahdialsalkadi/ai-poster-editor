import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/app.js';
import { buildWorkerServer } from '../src/export/worker-server.js';

function captureLogs() {
  let output = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  return { stream, text: () => output };
}

describe('structured operational logs', () => {
  it('redacts credential headers and omits query strings and unexpected error details', async () => {
    const logs = captureLogs();
    const app = await buildServer({ logger: true, logStream: logs.stream, auth: null, ai: null });
    app.get('/test-failure', async () => {
      throw new Error('private-error-message-secret');
    });
    try {
      app.log.info(
        {
          headers: {
            authorization: 'bearer-secret',
            cookie: 'cookie-secret',
            'x-api-key': 'api-key-secret',
            'set-cookie': 'session-secret',
          },
        },
        'header redaction test',
      );
      const response = await app.inject({
        method: 'GET',
        url: '/test-failure?token=query-secret',
        headers: {
          authorization: 'bearer-secret',
          cookie: 'cookie-secret',
          'x-api-key': 'api-key-secret',
        },
      });
      expect(response.statusCode).toBe(500);
      const output = logs.text();
      for (const secret of [
        'bearer-secret',
        'cookie-secret',
        'api-key-secret',
        'session-secret',
        'query-secret',
        'private-error-message-secret',
      ]) {
        expect(output).not.toContain(secret);
      }
      const records = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(records.some((entry) => entry.event === 'api.error' && entry.status === 500)).toBe(
        true,
      );
      expect(records.find((entry) => entry.msg === 'header redaction test')?.headers).toEqual({
        authorization: '[Redacted]',
        cookie: '[Redacted]',
        'x-api-key': '[Redacted]',
        'set-cookie': '[Redacted]',
      });
    } finally {
      await app.close();
    }
  });

  it('uses the same policy for worker requests and reports unexpected failures safely', async () => {
    const logs = captureLogs();
    const app = await buildWorkerServer({
      logger: true,
      logStream: logs.stream,
      token: 'worker-secret',
    });
    app.get('/test-failure', async () => {
      throw new Error('worker-error-secret');
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/test-failure?token=worker-query-secret',
        headers: { authorization: 'Bearer worker-secret' },
      });
      expect(response.statusCode).toBe(500);
      const output = logs.text();
      expect(output).not.toContain('worker-secret');
      expect(output).not.toContain('worker-error-secret');
      expect(output).not.toContain('worker-query-secret');
      expect(output).toContain('worker.error');
    } finally {
      await app.close();
    }
  });
});
