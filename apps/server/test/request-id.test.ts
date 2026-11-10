import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/app.js';

describe('request ID validation', () => {
  it('uses a valid caller ID consistently in responses and structured logs', async () => {
    let output = '';
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const app = await buildServer({ logger: true, logStream: stream, auth: null, ai: null });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/not-found',
        headers: { 'x-request-id': 'valid_id.123-456' },
      });
      expect(response.json().error.requestId).toBe('valid_id.123-456');
      expect(output).toContain('valid_id.123-456');
    } finally {
      await app.close();
    }
  });

  it('replaces invalid, too-short and oversized IDs before logging or responding', async () => {
    let output = '';
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const app = await buildServer({ logger: true, logStream: stream, auth: null, ai: null });
    try {
      for (const value of ['bad credential secret', 'invalid/secret', 'short', 'x'.repeat(65)]) {
        const response = await app.inject({
          method: 'GET',
          url: '/not-found',
          headers: { 'x-request-id': value },
        });
        expect(response.statusCode).toBe(404);
        expect(response.json().error.requestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(output).not.toContain(value);
      }
    } finally {
      await app.close();
    }
  });
});
