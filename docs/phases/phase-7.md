# Phase 7: Failure handling, isolation, replay, secret rotation

Branch `phase-7/failure-handling`, merged into `pivot/webhook-platform`.

## What changed

- **Endpoint isolation at claim time** (ADR-0033): `claim_due_deliveries()` no longer offers an endpoint
  that holds its cap of in-flight deliveries (counted across workers) or whose circuit is open, lets a
  tripped endpoint carry one probe at a time, and keeps the per-organization cap and longest-waiting-first
  order. A dead endpoint with a large backlog cannot delay healthy endpoints of the same or other tenants.
- **Circuit breaker and auto-disable**: endpoint health lives in PostgreSQL next to the endpoint
  (`consecutive_failures`, `first_failure_at`, `circuit_open_until`, `circuit_trips`), updated with atomic
  expressions in the transaction that records the outcome. Five failures in a row open the circuit for a
  doubling cool-down (30 s to 10 min). A failure streak of five days (configurable) disables the endpoint
  with a statement guarded on `enabled`, and only the winner writes the `endpoint.auto_disabled` event
  (host only, no URL path or query).
- **Per-endpoint rate limit** in Redis (fixed one second window); deliveries over the limit are deferred,
  not failed and not counted as attempts. Without Redis the limit is not applied.
- **Replay**: a message (`POST .../messages/{id}/replay`) or the failed deliveries of an endpoint in a time
  range (`POST .../endpoints/{id}/replay`), in bounded batches, idempotent, as a new retry cycle
  (`cycle_base`) that keeps counting attempts so history keys stay unique. Audited.
- **Secret rotation** (`POST .../secret/rotate`): the old secret keeps signing for a window next to the new
  one; at most two secrets are valid; the dispatcher signs with both and then only the new one. Audited.
  Enabling an endpoint resets its health.
- **notification-service** is no longer a skeleton: its database (RLS), an idempotent consumer for
  `endpoint.auto_disabled`, and `GET /notifications` and `POST /notifications/{id}/read`.
- Permissions `deliveries.replay` (managers and up), `endpoint_secrets.rotate` (owners and admins) and
  `notifications.read` (everyone).

## Decisions

- Isolation by not claiming, rather than claiming and deferring (which would still fill a tenant's quota).
- The endpoint cap across concurrent claim calls is approximate (at most workers times the cap).
- Pending deliveries to an auto-disabled endpoint fail fast with `endpoint_unavailable` and can be replayed
  after the owner re-enables it.
- In-app notifications first; e-mail and push are not planned before the realtime work (Phase 9).

## Tests added

- ingest-service: claim isolation, replay of a message and of an endpoint range (batches, idempotency,
  disabled and archived endpoints, permissions, other tenants, audit), rotation (window, at most two valid
  secrets, audit without secrets, ciphertext at rest, permissions, re-enable reset).
- dispatcher: the worker loop with a dead endpoint holding a large backlog beside healthy endpoints, circuit
  tripping, silence while open, one probe and recovery, auto-disable with six concurrent failures giving
  exactly one event, retries counted from the replay cycle, Redis rate limiting measured per second, and
  signing with one or two secrets around the rotation window.
- notification-service: exactly one notification for an event delivered three times, isolation between
  organizations, idempotent read, malformed events, RLS.

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip && pnpm turbo run lint typecheck test build
pnpm infra:up
for s in service-kit identity-service ingest-service dispatcher notification-service; do
  pnpm --filter @solmira/$s test:integration; done
```

## Known limitations

- Claiming scans the due deliveries of each organization; the cost grows with backlog size. The load test
  in Phase 11 will measure it.
- No message or delivery listing API yet: inspection and the attempt timeline come with the console (Phase 8).
- The failure period and cool-downs are global settings, not per endpoint.
