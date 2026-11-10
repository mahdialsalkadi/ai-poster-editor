import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseDesignHtml, type DesignDoc } from '@poster/core';
import sharp from 'sharp';
import { buildServer } from '../src/app.js';
import { ExportService } from '../src/export/service.js';
import { ExportWorker } from '../src/export/renderer.js';
import { RenderQueue } from '../src/export/queue.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});
const doc = parseDesignHtml(
  '<div class="artboard" data-width="400px" data-height="400px"><img data-id="image" data-type="image" src="asset:photo" style="position:absolute;left:0px;top:0px;width:100px;height:100px"></div>',
).doc;
function body(
  design: DesignDoc,
  files: Array<{ id: string; bytes: Buffer }> = [],
  format = 'html',
) {
  const boundary = 'poster-hardening';
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries({ options: { format }, doc: design }))
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}\r\n`,
      ),
    );
  for (const { id, bytes } of files)
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="asset:${id}"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      bytes,
      Buffer.from('\r\n'),
    );
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  };
}
async function server(service?: ExportService) {
  const app = await buildServer({
    logger: false,
    auth: null,
    ai: null,
    rateLimits: { exportPerMinute: 100 },
    ...(service ? { exportService: service } : {}),
  });
  apps.push(app);
  return app;
}
const rendered = {
  bytes: Buffer.from('rendered'),
  width: 400,
  height: 400,
  contentType: 'image/png',
};

describe('export API hardening', () => {
  it('rejects oversized dimensions at the API boundary before decoding', async () => {
    const bytes = await sharp({
      create: { width: 8001, height: 1, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    const decode = vi.spyOn(sharp.prototype, 'toBuffer');
    const app = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...body(doc, [{ id: 'photo', bytes }]),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('LIMIT_EXCEEDED');
    expect(decode).not.toHaveBeenCalled();
  });
  it('rejects images above the aggregate header budget at the API boundary', async () => {
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    vi.spyOn(sharp.prototype, 'metadata').mockResolvedValue({
      format: 'png',
      width: 6000,
      height: 5000,
    });
    const decode = vi.spyOn(sharp.prototype, 'toBuffer');
    const app = await server();
    const design = {
      ...doc,
      layers: Array.from({ length: 3 }, (_, i) => ({
        ...doc.layers[0]!,
        id: `image${i}`,
        src: `asset:photo${i}`,
      })),
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/export',
      ...body(
        design,
        [0, 1, 2].map((i) => ({ id: `photo${i}`, bytes })),
      ),
    });
    expect(response.statusCode).toBe(413);
    expect(decode).not.toHaveBeenCalled();
  });
  it('does not trust declared MIME types or accept unreferenced image parts', async () => {
    const app = await server();
    for (const [id, bytes] of [
      ['photo', Buffer.from('<html>not a PNG</html>')],
      ['unreferenced', Buffer.from('unused')],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/export',
        ...body(doc, [{ id, bytes }]),
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_DOC');
    }
  });
  it('omits hidden text and does not require hidden image bytes', async () => {
    const app = await server();
    const design = parseDesignHtml(
      '<div class="artboard" data-width="400px" data-height="400px"><div data-id="hidden" data-type="text" data-hidden="true" style="position:absolute;left:0px;top:0px;width:100px">HIDDEN_SENTINEL</div><img data-id="photo" data-type="image" data-hidden="true" src="asset:missing" style="position:absolute;left:0px;top:0px;width:10px;height:10px"></div>',
    ).doc;
    const response = await app.inject({ method: 'POST', url: '/api/export', ...body(design) });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('HIDDEN_SENTINEL');
    expect(response.body).not.toContain('asset:missing');
  });
  it('returns HTTP 429 when queue admission fails, before preparing image bytes', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entered = new Promise<void>((r) => {
      started = r;
    });
    const service = new ExportService({
      queue: new RenderQueue(1, 0),
      render: async () => {
        started();
        await gate;
        return rendered;
      },
    });
    const app = await server(service);
    const first = app.inject({
      method: 'POST',
      url: '/api/export',
      ...body({ ...doc, layers: [] }, [], 'png'),
    });
    const running = first.then((response) => response);
    await entered;
    try {
      const read = vi.spyOn(sharp.prototype, 'metadata');
      const second = await app.inject({
        method: 'POST',
        url: '/api/export',
        ...body(doc, [{ id: 'photo', bytes: Buffer.from('invalid image') }], 'png'),
      });
      expect(second.statusCode).toBe(429);
      expect(second.json().error.code).toBe('RATE_LIMITED');
      expect(read).not.toHaveBeenCalled();
    } finally {
      release();
      await running;
    }
  });
  it('returns EXPORT_FAILED when the total deadline expires in the queue', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new RenderQueue(1, 1);
    const occupying = queue.run(() => gate);
    const app = await server(new ExportService({ queue, totalTimeoutMs: 30 }));
    try {
      const design = { ...doc, layers: [] };
      const response = await app.inject({ method: 'POST', url: '/api/export', ...body(design) });
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('EXPORT_FAILED');
      expect(queue.metrics.waiting).toBe(0);
    } finally {
      release();
      await occupying;
    }
  });
  it('maps a real worker deadline to EXPORT_FAILED at HTTP 500', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'poster-api-deadline-'));
    const worker = new ExportWorker({
      entry: fileURLToPath(new URL('./fixtures/hanging-worker.mjs', import.meta.url)),
      args: [join(directory, 'pid')],
      timeoutMs: 300,
    });
    try {
      const service = new ExportService({
        render: async () =>
          worker.render({
            html: '<html></html>',
            width: 400,
            height: 400,
            format: 'png',
            scale: 1,
            quality: 0.92,
          }),
      });
      const app = await server(service);
      const response = await app.inject({
        method: 'POST',
        url: '/api/export',
        ...body({ ...doc, layers: [] }, [], 'png'),
      });
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('EXPORT_FAILED');
      expect(response.json().error.message).toContain('timed out');
    } finally {
      await worker.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('hands an occupied queue slot to a waiter even when another task arrives', async () => {
    const queue = new RenderQueue(1, 2);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    };
    const first = queue.run(async () => {
      await gate;
    });
    const second = queue.run(task);
    release();
    const third = first.then(() => queue.run(task));
    await Promise.all([first, second, third]);
    expect(peak).toBe(1);
    await expect(
      queue.run(async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
    await expect(queue.run(async () => 42)).resolves.toBe(42);
  });
});
