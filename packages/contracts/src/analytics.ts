import { z } from 'zod';
import { timestampSchema } from './resource-fields.js';

/** Delivery analytics (ADR-0035). Every figure is computed from recorded attempts in the range. */

export const DEFAULT_ANALYTICS_RANGE_HOURS = 24;
export const MAX_ANALYTICS_RANGE_DAYS = 31;

export const analyticsRangeQuerySchema = z
  .object({
    /** Inclusive start. Defaults to 24 hours before `to`. */
    from: timestampSchema.optional(),
    /** Exclusive end. Defaults to now. */
    to: timestampSchema.optional(),
  })
  .refine((range) => !range.from || !range.to || Date.parse(range.from) < Date.parse(range.to), {
    path: ['to'],
    message: 'The end of the range must be after its start',
  })
  .refine(
    (range) =>
      !range.from ||
      !range.to ||
      Date.parse(range.to) - Date.parse(range.from) <= MAX_ANALYTICS_RANGE_DAYS * 86_400_000,
    { path: ['to'], message: `The range can span at most ${MAX_ANALYTICS_RANGE_DAYS} days` },
  );
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;

/** Milliseconds, interpolated between the two nearest attempts; null when there are no attempts. */
export const latencySchema = z.object({
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  p99: z.number().nullable(),
});

export const deliveryStatsSchema = z.object({
  /** Real sends in the range. Refusals that sent nothing (a disabled endpoint) are not attempts. */
  attempts: z.number().int(),
  successfulAttempts: z.number().int(),
  /** successfulAttempts / attempts, from 0 to 1; null when there are no attempts. */
  successRate: z.number().min(0).max(1).nullable(),
  /** Distinct deliveries that had an attempt in the range. */
  deliveries: z.number().int(),
  /** attempts / deliveries; 1 means every delivery succeeded on the first try. */
  attemptsPerDelivery: z.number().nullable(),
  latencyMs: latencySchema,
});
export type DeliveryStats = z.infer<typeof deliveryStatsSchema>;

export const applicationStatsSchema = deliveryStatsSchema.extend({ applicationId: z.uuid() });
export type ApplicationStats = z.infer<typeof applicationStatsSchema>;

export const endpointStatsSchema = deliveryStatsSchema.extend({ endpointId: z.uuid() });
export type EndpointStats = z.infer<typeof endpointStatsSchema>;

export const applicationReportSchema = z.object({
  applicationId: z.uuid(),
  from: timestampSchema,
  to: timestampSchema,
  summary: deliveryStatsSchema,
  endpoints: z.array(endpointStatsSchema),
});
export type ApplicationReport = z.infer<typeof applicationReportSchema>;

export const applicationsReportSchema = z.object({
  from: timestampSchema,
  to: timestampSchema,
  applications: z.array(applicationStatsSchema),
});
export type ApplicationsReport = z.infer<typeof applicationsReportSchema>;
