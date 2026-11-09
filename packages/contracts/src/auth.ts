import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024),
});

export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().optional(),
  method: z.enum(['supabase', 'api-key', 'public']),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
