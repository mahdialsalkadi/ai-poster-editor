import { afterEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { parseDesignHtml } from '@poster/core';
import { exportQueueConfig } from '../src/export/config.js';
import { buildServer } from '../src/app.js';

afterEach(() => vi.unstubAllEnvs());

describe('export queue configuration', () => {
  it('uses defaults and accepts bounded explicit overrides', () => {
    expect(exportQueueConfig({})).toEqual({ concurrency: 2, maxWaiting: 20 });
    expect(exportQueueConfig({ EXPORT_CONCURRENCY: '1', EXPORT_QUEUE_MAX: '0' })).toEqual({
      concurrency: 1,
      maxWaiting: 0,
    });
  });
  it('rejects invalid or unsafe values instead of silently falling back', () => {
    for (const value of ['0', '3', '-1', '1.5', '1x', 'Infinity']) {
      expect(() => exportQueueConfig({ EXPORT_CONCURRENCY: value })).toThrow(/EXPORT_CONCURRENCY/);
    }
    for (const value of ['21', '-1', '2.5', '20abc', 'Infinity']) {
      expect(() => exportQueueConfig({ EXPORT_QUEUE_MAX: value })).toThrow(/EXPORT_QUEUE_MAX/);
    }
  });
  it('applies configured limits to the actual API queue', async () => {
    vi.stubEnv('EXPORT_CONCURRENCY', '1');
    vi.stubEnv('EXPORT_QUEUE_MAX', '0');
    let output = '';
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const app = await buildServer({ logger: true, logStream: stream, auth: null, ai: null });
    const doc = parseDesignHtml(
      '<div class="artboard" data-width="400px" data-height="400px"></div>',
    ).doc;
    const boundary = 'queue-config';
    const payload =
      ['options', 'doc']
        .map((field) => {
          const value = field === 'options' ? { format: 'html' } : doc;
          return `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}\r\n`;
        })
        .join('') + `--${boundary}--\r\n`;
    try {
      const limits = await app.inject({ method: 'GET', url: '/api/export/limits' });
      expect(limits.json().data).toMatchObject({ concurrency: 1, queueMax: 0 });
      const response = await app.inject({
        method: 'POST',
        url: '/api/export',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      expect(response.statusCode).toBe(200);
      const events = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((record) => record.event === 'export.queue');
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toMatchObject({ concurrency: 1, maxWaiting: 0 });
    } finally {
      await app.close();
    }
  });
});
