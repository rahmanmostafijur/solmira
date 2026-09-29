import { z } from 'zod';

// Server-only configuration. Nothing here is prefixed NEXT_PUBLIC_, so it never reaches the browser bundle.
const serverEnvSchema = z.object({
  GATEWAY_INTERNAL_URL: z
    .url()
    .default('http://localhost:8080')
    .transform((url) => url.replace(/\/+$/, '')),
});

export const serverEnv = serverEnvSchema.parse({
  GATEWAY_INTERNAL_URL: process.env.GATEWAY_INTERNAL_URL,
});
