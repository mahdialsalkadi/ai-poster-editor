import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/app.js';
import { ExportService } from '../src/export/service.js';

afterEach(() => vi.unstubAllEnvs());

describe('export kill switch', () => {
  it('refuses service exports without invoking the renderer', async () => {
    const render = vi.fn();
    const service = new ExportService({ disabled: true, render });
    await expect(
      service.export({} as never, new Map(), { principalId: 'user', ip: '127.0.0.1' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FEATURE' });
    expect(render).not.toHaveBeenCalled();
  });

  it('warns at startup and rejects the route before reading multipart content', async () => {
    vi.stubEnv('EXPORT_DISABLED', 'true');
    let output = '';
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const app = await buildServer({ logger: true, logStream: stream, auth: null, ai: null });
    try {
      const result = await app.inject({ method: 'POST', url: '/api/export' });
      expect(result.statusCode).toBe(422);
      expect(result.json().error).toMatchObject({ code: 'UNSUPPORTED_FEATURE', path: 'export' });
      expect(output).toContain('Export is disabled by EXPORT_DISABLED');
      expect((await app.inject({ method: 'GET', url: '/api/export/limits' })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
