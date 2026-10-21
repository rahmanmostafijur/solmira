# Phase 9: Realtime delivery feed and analytics

Branch `phase-9/realtime-analytics`, merged into `pivot/webhook-platform`.

## What changed

- **`delivery.attempted` event** (ADR-0035): the dispatcher adds one to the outbox, in the transaction that
  records the outcome, for every real send. Ids, event type name, result, status code, error class and
  timings only. The dispatcher role may now read the `id`, `organization_id` and `name` columns of
  `event_types`; its isolation test asserts the other columns stay denied.
- **Analytics** (analytics-service, no longer a skeleton): its own database with RLS, one row per attempt
  (idempotent by event id and by attempt), `GET /analytics/applications` and `/analytics/applications/{app}`
  with success rate, attempts per delivery and p50/p95/p99 latency per application and per endpoint, a
  31-day range limit, and an hourly bounded purge after 35 days.
- **Realtime feed** (notification-service): `/ws/v1/deliveries`, authenticated by an access token in the
  first frame, scoped to the organization in the token, with expiry, revocation, permission, connection
  and slow-client handling. The gateway already forwarded `/ws/` with upgrade headers.
- **Console**: a bridge keeps the feed open and refreshes message, delivery and analytics views when events
  arrive; views poll only while the feed is not live. The application page has a delivery health panel and
  the messages page a Live badge.
- Deployment: an analytics migration step in the compose overlay, the analytics suite in CI, and the
  browser test now starts notification and analytics too.

## Decisions

See ADR-0035. In short: raw attempt rows with exact percentiles over roll-ups until the load test says
otherwise; a per-instance exclusive queue for the feed and no resumption; the token in the first frame.

## Tests added

- dispatcher: the event for success, retry and no-send cases, and that it holds no URL or payload.
- analytics-service: figures against fixtures with known answers (1..100 ms gives 50.5, 95.05 and 99.01;
  ten attempts give 550, 955 and 991) and against an independent percentile calculation, range edges,
  empty reports, idempotent storage, malformed events, cross-tenant reads, permissions, invalid ranges,
  retention purge.
- notification-service: the hub and the event mapping (unit), and a feed suite against a real WebSocket and
  RabbitMQ: two organizations each receive only their own events, a client cannot choose its tenant,
  missing, malformed, untrusted, expired and revoked tokens, no organization or permission, expiry while
  connected, the connection limit, other paths.
- web: feed client (reconnect, backoff, refusals), query refresh rules, health panel, formatting.
- end to end: the live list update and the analytics figures, through the real services.

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip && pnpm turbo run lint typecheck test build
pnpm infra:up
for s in service-kit identity-service ingest-service dispatcher notification-service analytics-service; do
  pnpm --filter @solmira/$s test:integration; done
pnpm --filter @solmira/web test:e2e
```

Local result of the final run: 44 turbo tasks passed; integration suites 12, 68, 150, 17, 11 and 26 tests
passed; the browser test passed with notification and analytics in the stack. CI runs the same suites and
the browser test; the GitHub CLI is not authenticated here, so CI has not been observed.

## Known limitations

- Every attempt adds an outbox row, and percentile queries read the attempts of the range. The load test
  (Phase 11) will measure both; roll-ups are the planned answer if the query cost matters.
- The feed has no resumption and no per-application filter on the server; clients filter and reload.
- Revocation is checked when a connection opens; a session revoked later is cut off at token expiry
  (at most 15 minutes).
