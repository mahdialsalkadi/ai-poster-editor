import { describe, expect, it } from 'vitest';
import { parseDesignHtml, type DesignDoc } from '@poster/core';
import type { ExportRequest } from '@poster/contracts';
import sharp from 'sharp';
import { ExportService, type ExportCaller } from '../src/export/service.js';

const doc: DesignDoc = {
  schemaVersion: 1,
  width: 300,
  height: 400,
  background: { kind: 'solid', color: '#0f172a' },
  layers: [],
};

const callerA: ExportCaller = { principalId: 'user-a', ip: '203.0.113.1' };
const callerB: ExportCaller = { principalId: 'user-b', ip: '203.0.113.1' };
const callerAElsewhere: ExportCaller = { principalId: 'user-a', ip: '203.0.113.2' };

function request(key: string): ExportRequest {
  return {
    options: { format: 'png', scale: 1, quality: 0.92, idempotencyKey: key },
    doc,
    assets: [],
  };
}

function serviceWith(
  options: { maxEntries?: number; maxBytes?: number; ttlMs?: number; now?: () => number } = {},
  size = 64,
): { service: ExportService; calls: () => number } {
  let calls = 0;
  const service = new ExportService({
    ...options,
    render: async () => {
      calls += 1;
      return {
        bytes: Buffer.alloc(size, 0x61 + calls),
        width: doc.width,
        height: doc.height,
        contentType: 'image/png',
      };
    },
  });
  return { service, calls: () => calls };
}

describe('export cache', () => {
  it('scopes a cached export by principal and address', async () => {
    const { service, calls } = serviceWith();
    const key = 'idempotency-scope-1';

    const first = await service.export(request(key), new Map(), callerA);
    expect(first.cacheHit).toBe(false);

    const repeat = await service.export(request(key), new Map(), callerA);
    expect(repeat.cacheHit).toBe(true);
    expect(calls()).toBe(1);

    const otherPrincipal = await service.export(request(key), new Map(), callerB);
    expect(otherPrincipal.cacheHit).toBe(false);

    const otherAddress = await service.export(request(key), new Map(), callerAElsewhere);
    expect(otherAddress.cacheHit).toBe(false);
    expect(calls()).toBe(3);
  });

  it('re-renders after the TTL expires', async () => {
    let now = 1_800_000_000_000;
    const { service, calls } = serviceWith({ ttlMs: 1_000, now: () => now });
    const key = 'idempotency-ttl-1';

    await service.export(request(key), new Map(), callerA);
    now += 999;
    expect((await service.export(request(key), new Map(), callerA)).cacheHit).toBe(true);

    now += 2;
    const expired = await service.export(request(key), new Map(), callerA);
    expect(expired.cacheHit).toBe(false);
    expect(calls()).toBe(2);
  });

  it('evicts the oldest entry when the entry cap is reached', async () => {
    const { service, calls } = serviceWith({ maxEntries: 2 });

    await service.export(request('idempotency-entry-1'), new Map(), callerA);
    await service.export(request('idempotency-entry-2'), new Map(), callerA);
    await service.export(request('idempotency-entry-3'), new Map(), callerA);

    expect(
      (await service.export(request('idempotency-entry-1'), new Map(), callerA)).cacheHit,
    ).toBe(false);
    expect(
      (await service.export(request('idempotency-entry-3'), new Map(), callerA)).cacheHit,
    ).toBe(true);
    expect(calls()).toBe(4);
  });

  it('evicts by total bytes and refuses to cache an oversized export', async () => {
    const { service, calls } = serviceWith({ maxEntries: 10, maxBytes: 100 });

    await service.export(request('idempotency-bytes-1'), new Map(), callerA);
    await service.export(request('idempotency-bytes-2'), new Map(), callerA);
    // The second write evicts the first so the total stays below the byte cap.
    expect(
      (await service.export(request('idempotency-bytes-2'), new Map(), callerA)).cacheHit,
    ).toBe(true);
    expect(
      (await service.export(request('idempotency-bytes-1'), new Map(), callerA)).cacheHit,
    ).toBe(false);
    expect(calls()).toBe(3);

    const large = serviceWith({ maxBytes: 100 }, 101);
    await large.service.export(request('idempotency-large-1'), new Map(), callerA);
    const repeated = await large.service.export(request('idempotency-large-1'), new Map(), callerA);
    expect(repeated.cacheHit).toBe(false);
    expect(large.calls()).toBe(2);
  });

  it('does not share a cache entry without an idempotency key', async () => {
    const { service, calls } = serviceWith();
    const noKey: ExportRequest = {
      options: { format: 'png', scale: 1, quality: 0.92 },
      doc,
      assets: [],
    };
    await service.export(noKey, new Map(), callerA);
    await service.export(noKey, new Map(), callerA);
    expect(calls()).toBe(2);
  });

  it('rejects a changed document or options under an existing key', async () => {
    const { service, calls } = serviceWith();
    const input = request('content-key');
    await service.export(input, new Map(), callerA);
    await expect(
      service.export({ ...input, doc: { ...doc, width: 301 } }, new Map(), callerA),
    ).rejects.toMatchObject({ code: 'INVALID_DOC', path: 'options.idempotencyKey' });
    await expect(
      service.export({ ...input, options: { ...input.options, scale: 2 } }, new Map(), callerA),
    ).rejects.toMatchObject({ code: 'INVALID_DOC', path: 'options.idempotencyKey' });
    expect(calls()).toBe(1);
  });

  it('rejects changed referenced asset bytes while allowing identical content', async () => {
    const { service, calls } = serviceWith();
    const imageDoc = parseDesignHtml(
      '<div class="artboard" data-width="300px" data-height="400px"><img data-id="image" data-type="image" src="asset:photo" style="position:absolute;left:0px;top:0px;width:10px;height:10px"></div>',
    ).doc;
    const first = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    const second = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const input = { ...request('asset-key'), doc: imageDoc };
    await service.export(input, new Map([['photo', first]]), callerA);
    expect(
      (await service.export(input, new Map([['photo', Buffer.from(first)]]), callerA)).cacheHit,
    ).toBe(true);
    await expect(
      service.export(input, new Map([['photo', second]]), callerA),
    ).rejects.toMatchObject({
      code: 'INVALID_DOC',
      path: 'options.idempotencyKey',
    });
    expect(calls()).toBe(1);
  });

  it('coalesces identical in-flight exports and rejects concurrent mismatched content', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    const service = new ExportService({
      render: async () => {
        calls += 1;
        entered();
        await gate;
        return { bytes: Buffer.from('png'), width: 300, height: 400, contentType: 'image/png' };
      },
    });
    const input = request('concurrent-key');
    const first = service.export(input, new Map(), callerA);
    await started;
    const repeat = service.export(input, new Map(), callerA);
    try {
      await expect(
        service.export({ ...input, doc: { ...doc, width: 301 } }, new Map(), callerA),
      ).rejects.toMatchObject({ code: 'INVALID_DOC' });
    } finally {
      release();
    }
    const [original, duplicate] = await Promise.all([first, repeat]);
    expect(original.id).toBe(duplicate.id);
    expect(duplicate.cacheHit).toBe(true);
    expect(calls).toBe(1);
  });

  it('clears in-flight entries on failure so the key can be retried', async () => {
    let attempts = 0;
    const service = new ExportService({
      render: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('render failed');
        return { bytes: Buffer.from('ok'), width: 300, height: 400, contentType: 'image/png' };
      },
    });
    await expect(service.export(request('retry-key'), new Map(), callerA)).rejects.toThrow(
      'render failed',
    );
    expect((await service.export(request('retry-key'), new Map(), callerA)).cacheHit).toBe(false);
    expect(attempts).toBe(2);
  });
});
