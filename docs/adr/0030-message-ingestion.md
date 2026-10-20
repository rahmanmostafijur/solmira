# ADR-0030: Message ingestion, idempotency and fan-out

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Tenants send events with `POST /api/v1/applications/{app}/messages`. The request must be
authenticated by API key, safe to retry, bounded in size, validated against the event type, and
must hand the message to delivery without any chance of losing it.

## Decision

- **Authentication.** A guard on the messages routes reads `Authorization: Bearer slm_...`, resolves
  the key through `authenticate_api_key()` (ADR-0027), requires the `messages:write` scope, and
  answers 404 when the key belongs to another application than the one in the path. The routes are
  `@Public()` for the JWT guard, because they use this other scheme.
- **Rate limiting.** A fixed window per API key in Redis (600 requests per minute by default,
  configurable). Over the limit: `429` with `Retry-After`. If Redis is unavailable the limiter
  fails open for ingestion, because rejecting every tenant for a cache outage is worse than
  briefly not limiting; a log line and a metric record it.
- **Validation order.** Authentication, rate limit, body shape (400), event type exists and is live
  (422 `UNKNOWN_EVENT_TYPE`), payload size (413 `PAYLOAD_TOO_LARGE`, 256 KiB by default), payload
  against the event type's JSON Schema (422 `PAYLOAD_INVALID` with the failing paths).
- **Idempotency.** `Idempotency-Key` is required. A table `idempotency_keys (application_id, key,
request_hash, message_id, expires_at)` is unique per application and key. The insert is an upsert
  that replaces only expired rows, so within the retention window (24 hours by default) a replay
  returns the original message with `200`, and the same key with a different body is `409
IDEMPOTENCY_CONFLICT`. Concurrent requests with one key serialize on the unique index. The
  request hash covers the event type and the canonical JSON of the payload.
- **One transaction.** The message, its idempotency record and its outbox event
  (`message.created`) commit together, then the API answers `202` with the message id.
- **Fan-out.** The ingest service itself consumes `message.created` and creates deliveries with one
  set-based statement: one row per live, enabled endpoint of the application that is subscribed to
  the event type or has no subscriptions. `UNIQUE (message_id, endpoint_id)` and the consumer's
  idempotency record make it safe to repeat. Deliveries start `pending` and due now; the dispatcher
  (Phase 6) takes it from there.
- **Identifiers.** Deliveries get UUIDv7 ids from PostgreSQL 18's `uuidv7()` so the set-based insert
  needs no round trip per row.

## Alternatives considered

- **Fan-out inside the ingestion transaction.** Atomic, but a request to an application with many
  endpoints would write thousands of rows before answering. The outbox keeps the request short and
  the work retryable.
- **An idempotency check in Redis.** Rejected: the guarantee must survive a Redis flush.
- **Failing closed when Redis is down.** Rejected as above; ingestion availability matters more
  than strict limiting.

## Consequences

There is a short asynchronous gap between `202` and the creation of deliveries. A tenant cannot
observe deliveries for a message until fan-out ran; the console shows it as pending.

## Failure, scaling, security and operational implications

Retrying a request after a timeout is always safe. Payloads are stored as `jsonb`; the size limit
bounds table growth. Keys, secrets and URLs never appear in the outbox event, which carries ids.
