# Phase 5: Message ingestion, outbox relay, fan-out

Branch `phase-5/ingestion`, merged into `pivot/webhook-platform`.

## What changed

- **Ingestion API** (ingest-service): `POST /api/v1/applications/{app}/messages` authenticated by API
  key (`messages:write`), with a required `Idempotency-Key`, a per-key rate limit in Redis,
  distinct errors for unknown event types, oversized payloads, schema mismatches and key reuse, and
  JSON Schema validation (draft 2020-12 with standard formats) of the payload.
- **Idempotency**: an `idempotency_keys` table unique per (application, key). A retry within the
  retention window (24 hours, configurable) returns the original message; a different body is
  `409`; concurrent requests with one key create exactly one message.
- **One transaction**: the message, its idempotency record and a `message.created` outbox event
  commit together.
- **Event backbone** (service-kit, ADR-0029): the outbox relay (`FOR UPDATE SKIP LOCKED`, publisher
  confirms), consumers with a queue, a fixed-TTL retry queue and a dead-letter queue, an attempt
  counter, channel rebuilding after reconnects, and ordered startup (consumers declare their queues
  before the relay publishes).
- **Fan-out**: a consumer in ingest-service creates one `pending` delivery per live, enabled endpoint
  of the application that is subscribed to the event type (or has no subscriptions), in one
  set-based statement, claiming the event id in the same transaction.
- **Schema** (migrations 0004 and 0005): `messages`, `idempotency_keys`, `deliveries`,
  `processed_events`, with RLS and composite tenant keys, and `purge_expired_idempotency_keys()`.
- **Maintenance**: an hourly job removes expired idempotency records and published outbox rows past
  `OUTBOX_RETENTION_DAYS`.
- ADR-0029 (event backbone) and ADR-0030 (ingestion, idempotency, fan-out).

## Decisions

- The limiter fails open if Redis is down: refusing every tenant because a cache failed is the worse
  outage. It logs the failure.
- Fan-out is asynchronous (outbox, then RabbitMQ) so a request to an application with many
  endpoints stays short; the cost is a short gap before deliveries exist.
- The ingest service consumes its own `message.created` events; its queue is declared before the
  relay starts publishing, so no event meets a missing queue.
- Retry uses one queue-level TTL (5 s) so a long delay never blocks a short one.
- Deliveries get `uuidv7()` from PostgreSQL 18 so fan-out is a single `INSERT ... SELECT`.

## Dependencies added

- `ajv-formats` 3.0.1 (pinned): standard JSON Schema formats, maintained by the Ajv authors.
- `@types/express` (dev) in ingest-service for the guard and controller types.

## Tests added

- service-kit against real RabbitMQ and PostgreSQL: relay publishes once and marks rows; broker
  refusal mid-batch rolls back and loses nothing; a crash after publishing but before the commit
  publishes again; two relays share one outbox without duplicates; retries count attempts; poison
  and malformed messages end in the DLQ; a redelivered event applies once.
- ingest-service: ingestion happy path and every authentication failure; every validation error;
  schema changes taking effect; idempotency replay, conflict, expiry, concurrency (12 identical
  and 6 different requests at once); per-key rate limiting; fan-out routing, idempotent handling and
  refusal of bad events; maintenance; RLS and composite keys for the new tables; unit tests for
  canonical JSON, the limiter (including fail-open) and the payload validator.

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip && pnpm turbo run lint typecheck test build
pnpm infra:up      # see DEVELOPMENT.md if port 5433 is taken
pnpm --filter @solmira/service-kit test:integration
pnpm --filter @solmira/ingest-service test:integration
pnpm --filter @solmira/identity-service test:integration
```

## Known limitations

- Deliveries are created but nothing sends them yet (Phase 6).
- Ordering of events is not guaranteed; handlers do not assume it.
- Consumers of other services (notification, analytics, audit) are declared when those services get
  logic; events published before a consumer's queue exists are not replayed to it.
- Tenants cannot list or inspect messages yet (Phases 7 and 8).
- The relay and consumers rebuild their channels on reconnect; the broker-restart scenario is
  exercised as a chaos test in Phase 11.
