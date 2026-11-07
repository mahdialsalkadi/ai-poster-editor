import { LIMITS } from '@poster/core';
import { z } from 'zod';
import { warningSchema } from './errors.js';

export const languageSchema = z.enum(['auto', 'ar', 'en']);

export const generateDesignRequestSchema = z.object({
  prompt: z.string().min(3).max(4_000),
  width: z.number().int().min(LIMITS.document.minArtboardSide).max(LIMITS.document.maxArtboardSide).default(1080),
  height: z.number().int().min(LIMITS.document.minArtboardSide).max(LIMITS.document.maxArtboardSide).default(1350),
  language: languageSchema.default('auto'),
  style: z.string().max(200).optional(),
});

export const editDesignRequestSchema = z.object({
  designHtml: z.string().min(1),
  instruction: z.string().min(3).max(4_000),
  selectedLayerIds: z.array(z.string()).min(1).max(LIMITS.document.maxLayers),
  allowNewLayers: z.boolean().default(false),
});

export const aiUsageSchema = z.object({
  model: z.string(),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});

export const generatedDesignResponseSchema = z.object({
  designHtml: z.string(),
  warnings: z.array(warningSchema),
  usage: aiUsageSchema,
});

export type GenerateDesignRequest = z.infer<typeof generateDesignRequestSchema>;
export type EditDesignRequest = z.infer<typeof editDesignRequestSchema>;
export type GeneratedDesignResponse = z.infer<typeof generatedDesignResponseSchema>;
export type AiUsage = z.infer<typeof aiUsageSchema>;
