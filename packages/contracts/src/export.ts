import { designDocSchema, LIMITS } from '@poster/core';
import { z } from 'zod';
import { allowedMimeTypeSchema } from './assets.js';

export const exportFormatSchema = z.enum(['png', 'jpeg', 'pdf', 'html']);

/**
 * Rasters are offered at 1x, 2x and 3x only. `pdf` and `html` ignore the scale
 * because their size follows the artboard.
 */
export const exportScaleSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const exportOptionsSchema = z.object({
  format: exportFormatSchema.default('png'),
  scale: exportScaleSchema.default(1),
  quality: z.number().min(0.1).max(1).default(0.92),
  /** Repeated requests with the same key return the stored export. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});

/**
 * A binary part attached to the request. The bytes are deliberately not part of
 * this schema: on the wire each asset travels as its own multipart part named by
 * `id`, and the server re-sniffs the type instead of trusting `mimeType`.
 */
export const exportAssetSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  mimeType: allowedMimeTypeSchema,
  byteLength: z.number().int().positive().max(LIMITS.assets.maxBytesPerAsset),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

/**
 * Export takes the canonical document plus only the assets it references, never
 * Design HTML: the editor already holds the document, and a serialize/reparse
 * step could change the design before it reaches the renderer.
 */
export const exportRequestSchema = z.object({
  options: exportOptionsSchema,
  doc: designDocSchema,
  assets: z.array(exportAssetSchema).max(LIMITS.export.maxAssets).default([]),
});

export const exportMetadataSchema = z.object({
  id: z.string(),
  format: exportFormatSchema,
  scale: exportScaleSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  durationMs: z.number().nonnegative(),
  cacheHit: z.boolean(),
});

export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type ExportOptions = z.infer<typeof exportOptionsSchema>;
export type ExportAsset = z.infer<typeof exportAssetSchema>;
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportMetadata = z.infer<typeof exportMetadataSchema>;

export const EXPORT_SCALES = [1, 2, 3] as const;

export const EXPORT_LIMITS = {
  formats: exportFormatSchema.options,
  scales: EXPORT_SCALES,
  maxRequestBytes: LIMITS.export.maxRequestBytes,
  maxOutputPixels: LIMITS.export.maxOutputPixels,
  maxResponseBytes: LIMITS.export.maxResponseBytes,
  maxAssets: LIMITS.export.maxAssets,
  timeoutMs: LIMITS.export.timeoutMs,
  queueMax: LIMITS.export.queueMax,
  concurrency: LIMITS.export.concurrency,
} as const;
