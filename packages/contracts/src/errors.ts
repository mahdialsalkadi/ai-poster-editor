import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'SECURITY_VIOLATION',
  'INVALID_DOC',
  'LIMIT_EXCEEDED',
  'UNSUPPORTED_FEATURE',
  'DUPLICATE_ID',
  'ASSET_UNRESOLVED',
  'EXPORT_FAILED',
  'AI_INVALID_OUTPUT',
  'SPEND_CAP_EXCEEDED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    path: z.string().optional(),
    details: z.unknown().optional(),
    requestId: z.string().min(1),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string(),
  layerId: z.string().optional(),
  severity: z.enum(['info', 'warning']),
});

export type WarningPayload = z.infer<typeof warningSchema>;

export const successEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    data,
    warnings: z.array(warningSchema).default([]),
    requestId: z.string().min(1),
  });
