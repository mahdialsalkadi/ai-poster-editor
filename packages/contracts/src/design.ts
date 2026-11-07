import { designDocSchema, LIMITS } from '@poster/core';
import { z } from 'zod';
import { warningSchema } from './errors.js';

export const designHtmlSchema = z
  .string()
  .min(1)
  .refine((value) => new TextEncoder().encode(value).length <= LIMITS.document.maxBytes, {
    message: `Design HTML must not exceed ${LIMITS.document.maxBytes} bytes`,
  });

export const validateDesignRequestSchema = z.object({
  designHtml: designHtmlSchema,
});

export const validateDesignResponseSchema = z.object({
  doc: designDocSchema,
  warnings: z.array(warningSchema),
});

export const serializeDesignRequestSchema = z.object({
  doc: designDocSchema,
});

export const serializeDesignResponseSchema = z.object({
  designHtml: z.string(),
  warnings: z.array(warningSchema).default([]),
});

export const mergeDesignRequestSchema = z.object({
  base: designDocSchema,
  patch: designDocSchema,
  selectedLayerIds: z.array(z.string()).max(LIMITS.document.maxLayers).optional(),
  allowNewLayers: z.boolean().default(false),
  allowArtboardChanges: z.boolean().default(false),
});

export const mergeDesignResponseSchema = z.object({
  doc: designDocSchema,
  designHtml: z.string(),
  warnings: z.array(warningSchema),
});

export type ValidateDesignRequest = z.infer<typeof validateDesignRequestSchema>;
export type ValidateDesignResponse = z.infer<typeof validateDesignResponseSchema>;
export type SerializeDesignRequest = z.infer<typeof serializeDesignRequestSchema>;
export type SerializeDesignResponse = z.infer<typeof serializeDesignResponseSchema>;
export type MergeDesignRequest = z.infer<typeof mergeDesignRequestSchema>;
export type MergeDesignResponse = z.infer<typeof mergeDesignResponseSchema>;
