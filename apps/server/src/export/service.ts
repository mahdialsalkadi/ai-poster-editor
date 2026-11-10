import { DesignError, LIMITS, canonicalizeDoc } from '@poster/core';
import type { ExportFormat, ExportRequest } from '@poster/contracts';
import { prepareAssets, referencedAssetIds } from './assets.js';
import { RenderQueue } from './queue.js';
import { renderDesign } from './renderer.js';

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

type Cached = { bytes: Buffer; result: ExportResult; storedAt: number };

export type ExportCaller = { principalId: string; ip: string };

export type ExportServiceOptions = {
  maxEntries?: number;
  maxBytes?: number;
  ttlMs?: number;
  now?: () => number;
  render?: typeof renderDesign;
  queue?: RenderQueue;
  disabled?: boolean;
};

let counter = 0;

export class ExportService {
  private readonly queue: RenderQueue;
  private readonly cache = new Map<string, Cached>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly render: typeof renderDesign;
  readonly disabled: boolean;
  private cacheBytes = 0;

  constructor(options: ExportServiceOptions = {}) {
    this.queue = options.queue ?? new RenderQueue();
    this.maxEntries = options.maxEntries ?? LIMITS.export.cacheMaxEntries;
    this.maxBytes = options.maxBytes ?? LIMITS.export.cacheMaxBytes;
    this.ttlMs = options.ttlMs ?? LIMITS.export.cacheTtlMs;
    this.now = options.now ?? Date.now;
    this.render = options.render ?? renderDesign;
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

  private cacheKey(caller: ExportCaller, idempotencyKey: string): string {
    return `${caller.principalId}|${caller.ip}|${idempotencyKey}`;
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

  private writeCache(key: string, bytes: Buffer, result: ExportResult): void {
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
    this.cache.set(key, { bytes, result, storedAt: at });
    this.cacheBytes += bytes.byteLength;
  }

  async export(
    request: ExportRequest,
    uploaded: Map<string, Buffer>,
    caller: ExportCaller,
  ): Promise<ExportResult> {
    this.assertEnabled();
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
    if (cacheKey) {
      const cached = this.readCache(cacheKey);
      if (cached) return { ...cached.result, bytes: cached.bytes, cacheHit: true };
    }

    const startedAt = Date.now();
    // Queue admission precedes header inspection/decoding, bounding both image
    // memory and browser work rather than just the final render.
    const rendered = await this.queue.run(async () => {
      const assets = await prepareAssets(uploaded);
      return this.render({ doc, assets, options });
    });
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

    if (cacheKey) this.writeCache(cacheKey, rendered.bytes, result);

    return result;
  }
}
