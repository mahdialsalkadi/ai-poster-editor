import { LIMITS } from '@poster/core';
import { z } from 'zod';
import { designHtmlSchema } from './design.js';

export const exportFormatSchema = z.enum(['png', 'jpeg', 'pdf']);

export const exportRequestSchema = z.object({
  designHtml: designHtmlSchema,
  format: exportFormatSchema.default('png'),
  scale: z.number().min(0.1).max(4).default(1),
  quality: z.number().min(0.1).max(1).default(0.92),
  /** Optional idempotency key; repeated requests with the same key return the same export. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const exportMetadataSchema = z.object({
  id: z.string(),
  format: exportFormatSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  durationMs: z.number().nonnegative(),
  cacheHit: z.boolean(),
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportMetadata = z.infer<typeof exportMetadataSchema>;

export const EXPORT_LIMITS = {
  maxOutputPixels: LIMITS.export.maxOutputPixels,
  maxResponseBytes: LIMITS.export.maxResponseBytes,
  timeoutMs: LIMITS.export.timeoutMs,
} as const;
