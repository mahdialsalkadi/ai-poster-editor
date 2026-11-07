import { LIMITS } from '@poster/core';
import { z } from 'zod';

export const allowedMimeTypeSchema = z.enum(LIMITS.assets.allowedMimeTypes);

export const assetSchema = z.object({
  assetId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  mimeType: allowedMimeTypeSchema,
  width: z.number().int().positive().max(LIMITS.assets.maxDimension),
  height: z.number().int().positive().max(LIMITS.assets.maxDimension),
  bytes: z.number().int().positive().max(LIMITS.assets.maxBytesPerAsset),
  createdAt: z.string().datetime(),
});

export const assetUploadResponseSchema = z.object({
  asset: assetSchema,
});

export type Asset = z.infer<typeof assetSchema>;
export type AssetUploadResponse = z.infer<typeof assetUploadResponseSchema>;

export const ASSET_LIMITS = LIMITS.assets;
