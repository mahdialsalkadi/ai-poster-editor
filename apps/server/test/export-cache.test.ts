import { describe, expect, it } from 'vitest';
import type { DesignDoc } from '@poster/core';
import type { ExportRequest } from '@poster/contracts';
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
});
