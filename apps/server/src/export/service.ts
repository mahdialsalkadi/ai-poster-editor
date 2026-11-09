import { DesignError, LIMITS, canonicalizeDoc } from '@poster/core';
import type { ExportFormat, ExportRequest } from '@poster/contracts';
import { prepareAsset, referencedAssetIds, type PreparedAsset } from './assets.js';
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

type Cached = { bytes: Buffer; result: ExportResult };

let counter = 0;

export class ExportService {
  private readonly queue = new RenderQueue();
  private readonly cache = new Map<string, Cached>();

  constructor(private readonly cacheSize: number = 20) {}

  async export(request: ExportRequest, uploaded: Map<string, Buffer>): Promise<ExportResult> {
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
    for (const id of referenced) {
      if (!uploaded.has(id)) {
        throw new DesignError('ASSET_UNRESOLVED', `Asset ${id} was not uploaded`, `assets.${id}`);
      }
    }

    const idempotencyKey = options.idempotencyKey;
    if (idempotencyKey) {
      const cached = this.cache.get(idempotencyKey);
      if (cached) return { ...cached.result, bytes: cached.bytes, cacheHit: true };
    }

    const assets = new Map<string, PreparedAsset>();
    for (const id of referenced) {
      const raw = uploaded.get(id);
      if (!raw) continue;
      assets.set(id, await prepareAsset(id, raw));
    }

    const startedAt = Date.now();
    const rendered = await this.queue.run(() => renderDesign({ doc, assets, options }));
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

    if (idempotencyKey) {
      this.cache.set(idempotencyKey, { bytes: rendered.bytes, result });
      while (this.cache.size > this.cacheSize) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }

    return result;
  }
}
