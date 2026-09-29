import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'error']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const dependencyCheckSchema = z.object({
  name: z.string(),
  status: healthStatusSchema,
  latencyMs: z.number().nonnegative(),
  /** Present and false for dependencies whose failure degrades a feature but not readiness. */
  critical: z.boolean().optional(),
});
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

/**
 * Readiness deliberately reports only names, status and latency. Failure causes are logged
 * server-side, never returned, so the endpoint does not leak infrastructure details.
 */
export const readinessReportSchema = z.object({
  status: healthStatusSchema,
  service: z.string(),
  checks: z.array(dependencyCheckSchema),
});
export type ReadinessReport = z.infer<typeof readinessReportSchema>;
