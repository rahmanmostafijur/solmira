# ADR-0031: Dispatcher design: claiming, leases, retries and the delivery request

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Something has to take pending deliveries, send them as signed HTTP requests to untrusted hosts,
and decide what happens next, without losing a delivery when a worker dies and without letting one
tenant or endpoint starve the rest. Phase 6 builds the sending path; isolation, circuit breaking
and replay follow in Phase 7.

## Decision

- **A separate worker.** `apps/dispatcher` is its own deployable. It has no inbound API beyond
  health. It works on the `deliveries` rows in the ingest database (the delivery state is part of
  the ingest consistency boundary, ADR-0024), through its own database role.
- **Least privilege.** The role `dispatcher_app` may only read messages, endpoints and secrets and
  update deliveries, and Row Level Security applies to it: every unit of work after claiming runs
  in the tenant of the delivery. The ingest migration step grants exactly that (and nothing on API
  keys or on the management data of applications).
- **Claiming.** The one cross-tenant read is `claim_due_deliveries(limit, per_tenant, lease)`, a
  `SECURITY DEFINER` function. It selects due deliveries with `FOR UPDATE SKIP LOCKED`, at most
  `per_tenant` per organization, so one tenant's backlog cannot fill a batch, marks them
  `in_progress` and sets a lease (`locked_until`). Due means `pending`, or `in_progress` with an
  expired lease, so work held by a dead worker is picked up again.
- **At-least-once.** The attempt number is `attempt_count + 1` at claim time, and `attempt_count`
  only advances when the outcome is recorded. A worker that dies after sending and before recording
  therefore repeats the same attempt number with the same `webhook-id`.
- **Order of effects per attempt:** send the request, update the delivery in PostgreSQL, then
  write the attempt to the history (DynamoDB, ADR-0032). (Amended by ADR-0040; the history was first
  written before the state.) History is derived data and its write is
  idempotent; PostgreSQL is the source of truth for state.
- **Retries.** Success is any `2xx`. Everything else (other statuses, timeouts, connection and TLS
  errors, blocked targets, redirects) schedules the next attempt from a configurable schedule, by
  default `0, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h` (eight attempts), with uniform jitter of
  plus or minus 20 %. After the last attempt the delivery is `failed`.
- **The request.** `POST` with the message payload as the JSON body, Standard Webhooks headers
  (`webhook-id` = `msg_<message id>`, stable across attempts and retries; `webhook-timestamp` per
  attempt; `webhook-signature` = `v1,` + base64 HMAC-SHA256 over `id.timestamp.body`), the tenant's
  custom headers, and a fixed `user-agent`. Signing lives in `@solmira/webhooks`, together with the
  verification that receivers and the tests use.
- **Sending safely** (the SSRF guard, ADR-0028 applied at send time). The URL is checked again.
  Name resolution happens inside the connection itself: a custom `lookup` resolves the host, rejects
  the connection unless every returned address is public, and hands back exactly that address, so
  there is no second resolution an attacker could answer differently. Redirects are not followed
  and count as failures. Timeouts: connect, response headers, whole request. The response body is
  read only up to a limit (4 KiB stored), then the connection is dropped.
- **Concurrency.** A fixed number of deliveries in flight per worker (default 20), claimed in
  batches. Per-endpoint caps and rate limits come with isolation in Phase 7.

## Alternatives considered

- **A work queue in RabbitMQ per delivery.** Rejected: retry delays of hours need per-message TTLs
  (head-of-line blocking) and make replay and inspection hard. PostgreSQL holds the state, so a
  queue can never disagree with it.
- **The dispatcher inside the ingest process.** Rejected: outbound traffic to untrusted hosts must
  scale and fail independently and hold no inbound API surface.
- **Validate the address, then connect by host name.** Rejected: that is exactly the rebinding window.
- **Following redirects after validating each hop.** Rejected as unnecessary risk; receivers
  publish their final URL.

## Consequences

The ingest migration step owns the grants of the dispatcher role, so a new table the dispatcher needs
is added in one place. `claim_due_deliveries` is part of the security surface and has its own tests.

## Failure, scaling, security and operational implications

A crashed worker delays its claimed deliveries by at most the lease. Several workers can run at once
because claiming skips locked rows. A DynamoDB outage does not stop delivery: history writes are
retried, PostgreSQL state keeps advancing, and the gap is logged.
