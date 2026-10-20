# ADR-0032: Delivery attempt history in DynamoDB

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Every HTTP attempt produces a record (status, latency, truncated response, error class, next retry).
The volume is several records per delivery, much larger than the current-state table, it is
append-only, and old records have no value after a retention period. DynamoDB is part of the
approved stack for exactly this.

## Decision

- **Table.** One table, `solmira-delivery-attempts`, on-demand capacity, TTL on `expiresAt` (epoch
  seconds). Retention defaults to 30 days (`ATTEMPT_RETENTION_DAYS`).
- **Keys.** `pk = TENANT#<organizationId>#MESSAGE#<messageId>`,
  `sk = ENDPOINT#<endpointId>#ATTEMPT#<attempt, zero padded to 4>`: all attempts of a message, or of
  one delivery, are one query. A global secondary index `gsi1` has
  `gsi1pk = TENANT#<organizationId>#ENDPOINT#<endpointId>` and
  `gsi1sk = <ISO timestamp>#<deliveryId>#<attempt>`: the history of an endpoint over time, used by
  replay and analytics.
- **Idempotent writes.** The key contains the attempt number, so recording the same attempt twice
  (after a worker crash) overwrites one item instead of adding a second.
- **Contents.** Delivery and message ids, attempt number, start time, duration, HTTP status, error
  class, response body truncated to 4 KiB (and a flag), the next retry time. Never request
  headers, the signature, secrets or the payload.
- **Tenant isolation.** DynamoDB has no row-level security. Every key starts with the tenant, every
  read goes through a store whose methods take the organization from the authenticated context and
  build the key from it, so there is no API that reads without a tenant prefix. In AWS, an IAM
  policy using `dynamodb:LeadingKeys` limits each service role to its own prefixes (Phase 12), and
  the tests below prove that a message id from another tenant returns nothing.
- **Local development and tests** use DynamoDB Local (`amazon/dynamodb-local`); the table is created
  on start-up when `DYNAMODB_CREATE_TABLE` is set. In AWS, Terraform owns the table.

## Alternatives considered

- **Attempts in PostgreSQL.** Rejected: unbounded append-only growth in the transactional database,
  and retention would need partitioning and purge jobs.
- **Object storage per attempt.** Rejected: cheap but cannot be queried by endpoint and time.
- **Several tables.** Rejected: one table with a GSI answers both access patterns.

## Consequences

Reads are eventually consistent on the index. History is derived data: if a write is lost, the
delivery state in PostgreSQL is still correct and the loss is logged.

## Failure, scaling, security and operational implications

Writes are retried a few times with short delays and never block state advancement beyond that.
Capacity scales with traffic (on-demand). Response bodies from internal-looking hosts cannot occur
because sends to non-public addresses are refused before connecting.
