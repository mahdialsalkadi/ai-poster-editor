import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { buildWorkerServer } from '../src/export/worker-server.js';
import { renderRemote } from '../src/export/renderer.js';
import { closeRendererBrowser } from '../src/export/renderer-core.js';

const job = {
  html: '<!doctype html><div style="width:100px;height:100px;background:#0f172a">probe</div>',
  width: 100,
  height: 100,
  format: 'png' as const,
  scale: 1 as const,
  quality: 0.92,
};

describe('HTTP export worker', () => {
  let app: FastifyInstance;
  let url: string;

  beforeAll(async () => {
    app = await buildWorkerServer({ logger: false, token: 'worker-secret' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await closeRendererBrowser();
  });

  it('reports health without a token', async () => {
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('poster-worker');
  });

  it('requires the configured worker token', async () => {
    const denied = await fetch(`${url}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job),
    });
    expect(denied.status).toBe(401);

    await expect(renderRemote(job, url, { token: 'wrong-token' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('renders and returns content metadata over HTTP', async () => {
    const result = await renderRemote(job, url, { token: 'worker-secret' });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
    expect(result.contentType).toBe('image/png');
    // PNG signature.
    expect(result.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }, 20_000);
});
