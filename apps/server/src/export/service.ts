import { DesignError, LIMITS, canonicalizeDoc } from '@poster/core';
import { createHash } from 'node:crypto';
import type { ExportFormat, ExportRequest } from '@poster/contracts';
import { prepareAssets, referencedAssetIds } from './assets.js';
import { RenderQueue } from './queue.js';
import { renderDesign } from './renderer.js';
import { checkExportDeadline, waitForExport } from './deadline.js';

export type ExportResult = {
  id: string;
  bytes: Buffer;
  format: ExportFormat;
  scale: number;
  width: number;
  height: number;
  durationMs: number;
  cacheHit: boolean;
  contentType: string;
};

type Cached = { bytes: Buffer; result: ExportResult; storedAt: number; digest: string };
type Pending = { digest: string; result: Promise<ExportResult> };

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}

function payloadDigest(
  doc: ExportRequest['doc'],
  options: ExportRequest['options'],
  assets: Map<string, Buffer>,
): string {
  const { idempotencyKey: _key, ...exportOptions } = options;
  const files = [...assets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, bytes]) => ({ id, sha256: createHash('sha256').update(bytes).digest('hex') }));
  return createHash('sha256')
    .update(stableJson({ doc, options: exportOptions, assets: files }))
    .digest('hex');
}

function assertDigest(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new DesignError(
      'INVALID_DOC',
      'Idempotency key reused with a different export payload',
      'options.idempotencyKey',
    );
  }
}

export type ExportCaller = { principalId: string; ip: string };

export type ExportServiceOptions = {
  maxEntries?: number;
  maxBytes?: number;
  ttlMs?: number;
  now?: () => number;
  render?: typeof renderDesign;
  queue?: RenderQueue;
  disabled?: boolean;
  totalTimeoutMs?: number;
  prepare?: typeof prepareAssets;
};

let counter = 0;

export class ExportService {
  private readonly queue: RenderQueue;
  private readonly cache = new Map<string, Cached>();
  private readonly pending = new Map<string, Pending>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly render: typeof renderDesign;
  private readonly prepare: typeof prepareAssets;
  private readonly totalTimeoutMs: number;
  readonly disabled: boolean;
  private cacheBytes = 0;

  constructor(options: ExportServiceOptions = {}) {
    this.queue = options.queue ?? new RenderQueue();
    this.maxEntries = options.maxEntries ?? LIMITS.export.cacheMaxEntries;
    this.maxBytes = options.maxBytes ?? LIMITS.export.cacheMaxBytes;
    this.ttlMs = options.ttlMs ?? LIMITS.export.cacheTtlMs;
    this.now = options.now ?? Date.now;
    this.render = options.render ?? renderDesign;
    this.prepare = options.prepare ?? prepareAssets;
    this.totalTimeoutMs = options.totalTimeoutMs ?? LIMITS.export.totalTimeoutMs;
    this.disabled = options.disabled ?? process.env.EXPORT_DISABLED?.trim() === 'true';
  }

  assertEnabled(): void {
    if (this.disabled) {
      throw new DesignError(
        'UNSUPPORTED_FEATURE',
        'Export is disabled by EXPORT_DISABLED',
        'export',
      );
    }
  }

  get queueLimits(): { concurrency: number; queueMax: number } {
    const { concurrency, maxWaiting } = this.queue.metrics;
    return { concurrency, queueMax: maxWaiting };
  }

  private cacheKey(caller: ExportCaller, idempotencyKey: string): string {
    return JSON.stringify([caller.principalId, caller.ip, idempotencyKey]);
  }

  private readCache(key: string): Cached | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (this.now() - cached.storedAt > this.ttlMs) {
      this.deleteCache(key);
      return null;
    }
    return cached;
  }

  private deleteCache(key: string): void {
    const cached = this.cache.get(key);
    if (!cached) return;
    this.cache.delete(key);
    this.cacheBytes = Math.max(0, this.cacheBytes - cached.bytes.byteLength);
  }

  private writeCache(key: string, bytes: Buffer, result: ExportResult, digest: string): void {
    if (bytes.byteLength > this.maxBytes) return;
    const at = this.now();
    for (const [entryKey, entry] of this.cache) {
      if (at - entry.storedAt > this.ttlMs) this.deleteCache(entryKey);
    }
    while (
      this.cache.size >= this.maxEntries ||
      this.cacheBytes + bytes.byteLength > this.maxBytes
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.deleteCache(oldest);
    }
    this.cache.set(key, { bytes, result, storedAt: at, digest });
    this.cacheBytes += bytes.byteLength;
  }

  async export(
    request: ExportRequest,
    uploaded: Map<string, Buffer>,
    caller: ExportCaller,
  ): Promise<ExportResult> {
    this.assertEnabled();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.totalTimeoutMs);
    try {
      return await waitForExport(
        this.execute(request, uploaded, caller, controller.signal),
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async execute(
    request: ExportRequest,
    uploaded: Map<string, Buffer>,
    caller: ExportCaller,
    signal: AbortSignal,
  ): Promise<ExportResult> {
    const doc = canonicalizeDoc(request.doc);
    const options = request.options;

    if (options.format === 'png' || options.format === 'jpeg') {
      const pixels = doc.width * options.scale * (doc.height * options.scale);
      if (pixels > LIMITS.export.maxOutputPixels) {
        throw new DesignError(
          'LIMIT_EXCEEDED',
          'The requested export exceeds the output pixel limit',
          'options.scale',
        );
      }
    }

    const referenced = referencedAssetIds(doc);
    if (referenced.length > LIMITS.assets.maxPerDocument)
      throw new DesignError('LIMIT_EXCEEDED', 'Too many referenced images', 'assets');
    const expected = new Set(referenced);
    for (const id of uploaded.keys()) {
      if (!expected.has(id))
        throw new DesignError(
          'INVALID_DOC',
          `Asset ${id} is not referenced by a visible layer`,
          `assets.${id}`,
        );
    }
    for (const id of referenced) {
      if (!uploaded.has(id)) {
        throw new DesignError('ASSET_UNRESOLVED', `Asset ${id} was not uploaded`, `assets.${id}`);
      }
    }

    const idempotencyKey = options.idempotencyKey;
    const cacheKey = idempotencyKey ? this.cacheKey(caller, idempotencyKey) : null;
    const digest = cacheKey ? payloadDigest(doc, options, uploaded) : null;
    if (cacheKey) {
      const cached = this.readCache(cacheKey);
      if (cached) {
        assertDigest(cached.digest, digest!);
        return { ...cached.result, bytes: cached.bytes, cacheHit: true };
      }
      const pending = this.pending.get(cacheKey);
      if (pending) {
        assertDigest(pending.digest, digest!);
        return { ...(await pending.result), cacheHit: true };
      }
    }

    checkExportDeadline(signal);
    const result = this.performExport(doc, options, uploaded, cacheKey, digest, signal);
    if (!cacheKey || !digest) return result;
    this.pending.set(cacheKey, { digest, result });
    try {
      return await result;
    } finally {
      this.pending.delete(cacheKey);
    }
  }

  private async performExport(
    doc: ExportRequest['doc'],
    options: ExportRequest['options'],
    uploaded: Map<string, Buffer>,
    cacheKey: string | null,
    digest: string | null,
    signal: AbortSignal,
  ): Promise<ExportResult> {
    const startedAt = Date.now();
    // Queue admission precedes header inspection/decoding, bounding both image
    // memory and browser work rather than just the final render.
    const rendered = await this.queue.run(async () => {
      const assets = await this.prepare(uploaded, signal);
      checkExportDeadline(signal);
      return this.render({ doc, assets, options });
    }, signal);
    checkExportDeadline(signal);
    if (rendered.bytes.byteLength > LIMITS.export.maxResponseBytes) {
      throw new DesignError(
        'LIMIT_EXCEEDED',
        'The export is larger than the response limit',
        'export',
      );
    }

    counter += 1;
    const result: ExportResult = {
      id: `exp-${Date.now().toString(36)}-${counter.toString(36)}`,
      bytes: rendered.bytes,
      format: options.format,
      scale: options.format === 'html' || options.format === 'pdf' ? 1 : options.scale,
      width: rendered.width,
      height: rendered.height,
      durationMs: Date.now() - startedAt,
      cacheHit: false,
      contentType: rendered.contentType,
    };

    if (cacheKey && digest) this.writeCache(cacheKey, rendered.bytes, result, digest);

    return result;
  }
}
