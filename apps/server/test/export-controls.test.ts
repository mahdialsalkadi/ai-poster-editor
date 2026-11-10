import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/app.js';
import { ExportService } from '../src/export/service.js';
import { RenderQueue } from '../src/export/queue.js';
import type { ExportRequest } from '@poster/contracts';

const input: ExportRequest = {
  doc: {
    schemaVersion: 1,
    width: 300,
    height: 400,
    background: { kind: 'solid', color: '#fff' },
    layers: [],
  },
  options: { format: 'png', scale: 1, quality: 0.92, idempotencyKey: 'deadline-key' },
  assets: [],
};
const caller = { principalId: 'user', ip: '127.0.0.1' };

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

describe('total export deadline', () => {
  it('removes a timed-out waiter without starting work or leaking a queue slot', async () => {
    const queue = new RenderQueue(1, 1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const occupying = queue.run(() => gate);
    const render = vi.fn();
    const service = new ExportService({ queue, render, totalTimeoutMs: 30, disabled: false });
    try {
      await expect(service.export(input, new Map(), caller)).rejects.toMatchObject({
        code: 'EXPORT_FAILED',
      });
      expect(queue.metrics).toMatchObject({ active: 1, waiting: 0 });
      expect(render).not.toHaveBeenCalled();
    } finally {
      release();
      await occupying;
    }
    expect(queue.metrics.active).toBe(0);
  });

  it('returns on deadline during asset preparation, retains the slot, and never starts render', async () => {
    const queue = new RenderQueue(1, 0);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const render = vi.fn();
    const prepare = vi.fn(async () => {
      await gate;
      return new Map();
    });
    const service = new ExportService({
      queue,
      render,
      prepare,
      totalTimeoutMs: 30,
      disabled: false,
    });
    await expect(service.export(input, new Map(), caller)).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
    });
    expect(queue.metrics.active).toBe(1);
    release();
    await vi.waitFor(() => expect(queue.metrics.active).toBe(0));
    expect(render).not.toHaveBeenCalled();
  });

  it('keeps the slot until an already-running render settles and does not cache late output', async () => {
    const queue = new RenderQueue(1, 0);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const service = new ExportService({
      queue,
      totalTimeoutMs: 30,
      disabled: false,
      render: async () => {
        calls += 1;
        if (calls === 1) await gate;
        return { bytes: Buffer.from('ok'), width: 300, height: 400, contentType: 'image/png' };
      },
    });
    await expect(service.export(input, new Map(), caller)).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
    });
    expect(queue.metrics.active).toBe(1);
    release();
    await vi.waitFor(() => expect(queue.metrics.active).toBe(0));
    const retry = await service.export(input, new Map(), caller);
    expect(retry.cacheHit).toBe(false);
    expect(calls).toBe(2);
  });
});
