import { baseEnvSchema, portSchema, postgresEnvSchema } from '@solmira/service-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'dispatcher';

/** `0,5,300` becomes [0, 5, 300]: the wait before attempt 1, 2, 3, in seconds. */
const scheduleSchema = z
  .string()
  .transform((value) => value.split(',').map((part) => Number(part.trim())))
  .pipe(
    z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(7 * 24 * 3600),
      )
      .min(1, 'Give at least one delay')
      .max(30),
  );

/** The default schedule: immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h (ADR-0031). */
export const DEFAULT_RETRY_SCHEDULE = '0,5,300,1800,7200,18000,36000,36000';

export const envSchema = baseEnvSchema
  .extend({
    PORT: portSchema(4006),
    ...postgresEnvSchema.shape,

    /** Must match the key ingest-service encrypts signing secrets with (ADR-0026). */
    SECRETS_ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'Must be 32 bytes, base64 encoded (openssl rand -base64 32)',
      ),
    SECRETS_ENCRYPTION_KEY_ID: z.string().min(1).max(64).default('local-1'),
    /** Development and tests only: allows http and non-public targets. Refused in production. */
    ALLOW_PRIVATE_ENDPOINT_TARGETS: z.stringbool().default(false),

    /** Deliveries taken per pass, and the most one organization contributes to a pass. */
    DISPATCH_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    DISPATCH_PER_TENANT_BATCH: z.coerce.number().int().min(1).max(100).default(10),
    /** Deliveries in flight at once in this worker. */
    DISPATCH_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(20),
    /** Tests turn the loop off and drive the dispatcher by hand. */
    DISPATCH_AUTOSTART: z.stringbool().default(true),
    DISPATCH_POLL_MS: z.coerce.number().int().min(10).max(60_000).default(500),
    /** How long a claim is held; a delivery of a dead worker is retried after this. */
    DISPATCH_LEASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(120),

    DELIVERY_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
    DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(30_000),
    /** How much of a response body is kept (the rest is not even read). */
    DELIVERY_RESPONSE_BODY_LIMIT_BYTES: z.coerce.number().int().min(0).max(65_536).default(4_096),
    /** Larger payloads are refused (ingestion enforces a smaller limit already). */
    DELIVERY_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(1_000_000).default(1_000_000),

    RETRY_SCHEDULE_SECONDS: scheduleSchema.default(() =>
      DEFAULT_RETRY_SCHEDULE.split(',').map(Number),
    ),
    /** Each delay is multiplied by a random factor within plus or minus this ratio. */
    RETRY_JITTER_RATIO: z.coerce.number().min(0).max(0.5).default(0.2),

    DYNAMODB_TABLE: z.string().min(3).default('solmira-delivery-attempts'),
    /** DynamoDB Local in development; unset in AWS. */
    DYNAMODB_ENDPOINT: z.url().optional(),
    DYNAMODB_CREATE_TABLE: z.stringbool().default(false),
    ATTEMPT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.ALLOW_PRIVATE_ENDPOINT_TARGETS), {
    path: ['ALLOW_PRIVATE_ENDPOINT_TARGETS'],
    message: 'Must not be enabled in production',
  })
  .refine((env) => env.DISPATCH_LEASE_SECONDS * 1000 > env.DELIVERY_TIMEOUT_MS * 2, {
    path: ['DISPATCH_LEASE_SECONDS'],
    message: 'The lease must be longer than twice the delivery timeout',
  });

export type DispatcherConfig = z.infer<typeof envSchema>;
