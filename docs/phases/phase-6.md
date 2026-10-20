# Phase 6: Dispatcher

Branch `phase-6/dispatcher`, merged into `pivot/webhook-platform`.

## What changed

- **`apps/dispatcher`**, a new worker: claims due deliveries, builds and signs the request, sends it,
  records the attempt, and schedules the next try or marks the delivery failed. Its only inbound
  surface is the health endpoints.
- **`@solmira/webhooks`** (new package): Standard Webhooks signing and verification. The reference
  example from the specification is a test, and the dispatcher's tests verify its requests with the
  same verifier a receiver uses.
- **Signing**: `webhook-id` is `msg_<message id>` and stays the same for every attempt;
  `webhook-timestamp` is new per attempt; `webhook-signature` is HMAC-SHA256 and carries a second
  signature when a previous secret is still valid (the rotation window, Phase 7).
- **Retries**: configurable schedule, default immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h
  (eight attempts), with plus or minus 20 % jitter. After the last attempt the delivery is `failed`.
- **Safe sending**: the URL is checked again, and name resolution happens inside the connection's own
  lookup so the socket connects to the one validated address (no rebinding window); redirects are not
  followed; connect, response-header and total timeouts; the response body is read only up to 4 KiB
  and the connection is then dropped; oversized payloads are refused.
- **Claiming** (ingest migration 0007): `claim_due_deliveries()` takes due deliveries with
  `FOR UPDATE SKIP LOCKED`, at most a few per organization, longest-waiting organization first, with a
  lease so work of a dead worker comes back. The attempt number is `attempt_count + 1` and only
  advances when the outcome is recorded, so a repeated try keeps its number and its webhook id.
- **Least privilege**: the dispatcher connects as `dispatcher_app` with grants applied by the ingest
  migration step; Row Level Security applies and each delivery is processed in its tenant.
- **Attempt history** in DynamoDB (`solmira-delivery-attempts`, TTL, a GSI for endpoint history),
  written idempotently; a failed write is retried and then logged, and never blocks the delivery.
- **Platform**: DynamoDB Local in compose and CI, the dispatcher in the compose overlay, CI jobs,
  gateway internal health route, and the service registry.
- ADR-0031 (dispatcher design) and ADR-0032 (attempt history).

## Decisions

- Delivery state stays in PostgreSQL and is claimed by the worker; RabbitMQ is not in the send path.
- The worker shares the ingest database but not its privileges; it never touches keys or management data.
- Redirects count as failures instead of being followed.
- Any non-2xx response is retried; 410 and other statuses get no special treatment yet.
- A disabled or archived endpoint, a missing secret and an oversized payload fail the delivery
  immediately without a send (it can be replayed once the cause is fixed, Phase 7).

## Dependencies added

- `undici` 8.12.3 (pinned, approved): HTTP client with a custom connection lookup and no redirect
  following.
- `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` (approved stack): the attempt history.
- DynamoDB Local (`amazon/dynamodb-local:2.6.1`) as a development and test container only.

## Tests added

- `@solmira/webhooks`: the specification's example, tampering with every signed part, tolerance in
  both directions, header case, several signatures, unknown versions.
- Dispatcher unit tests: retry schedule and jitter bounds (including a fixed clock), request building
  verified by a receiver, the sender against real local servers (success, statuses, redirect,
  refused connection, never-answering, dripping and endless responses, 5 MB bodies), and the target
  rules in strict mode (literal and resolved private addresses, mixed answers, rebinding with a
  single resolution).
- Dispatcher integration tests against PostgreSQL (real ingest migrations) and DynamoDB Local:
  signed delivery and success state, attempt history with its retention deadline, the full retry
  cycle to `failed` with the measured waits, send-time SSRF, redirects, timeouts, refusals without
  sending, the rotation window, crash after sending (same webhook id, one history item), stale
  workers, concurrent workers sending each delivery once, tenant fairness, role privileges under RLS,
  history isolation across tenants, and delivery continuing without the history.
- ingest-service: the claim function (due only, leases, per-tenant cap, ordering, concurrency).

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip && pnpm turbo run lint typecheck test build
pnpm infra:up      # now also starts DynamoDB Local
pnpm --filter @solmira/ingest-service test:integration
pnpm --filter @solmira/dispatcher test:integration
```

## Known limitations

- One slow endpoint can occupy worker slots until its timeout; per-endpoint concurrency caps, Redis
  rate limits and circuit breaking come in Phase 7.
- No metrics or traces yet (Phase 12); failures are logged.
- The dispatcher polls (500 ms by default); it does not wake on fan-out events.
- DNS is resolved by the operating system resolver; a hostile resolver can only choose the address
  within the public ranges, never reach a private one.
- TLS failures are classified from error codes; there is no test with a real bad certificate.
