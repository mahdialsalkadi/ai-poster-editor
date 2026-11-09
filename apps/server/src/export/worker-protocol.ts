import { z } from 'zod';

/**
 * The renderer protocol. The local child process and the container worker use
 * the same job shape; only the transport differs (IPC vs HTTP).
 */
export const browserRenderJobSchema = z.object({
  html: z.string().min(1),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  format: z.enum(['png', 'jpeg', 'pdf']),
  scale: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  quality: z.number().min(0.1).max(1),
  sandbox: z.boolean(),
});

export const remoteRenderJobSchema = browserRenderJobSchema.omit({ sandbox: true });

export const renderMessageSchema = z.object({
  type: z.literal('render'),
  id: z.number().int().nonnegative(),
  job: browserRenderJobSchema,
});

export type BrowserRenderJobPayload = z.infer<typeof browserRenderJobSchema>;
export type RemoteRenderJob = z.infer<typeof remoteRenderJobSchema>;
export type RenderMessage = z.infer<typeof renderMessageSchema>;
