# Solmira Roadmap

Solmira is a multi-tenant webhook delivery platform. Tenants send events through an API; Solmira
delivers them as signed HTTP webhooks to their customers' endpoints with retries, endpoint
isolation, observability and replay (see [ADR-0023](adr/0023-pivot-to-webhook-delivery.md)).

Phases 1 and 2 (foundation, identity and tenant isolation) are shared with the earlier product
direction and are done. The earlier order/inventory phases are archived at the git tag
`v0-distribution`.

Every phase has acceptance criteria that a test or a measurement can verify. A phase merges only
when all of them pass and CI is green. Progress is logged in
[`docs/phases/PROGRESS.md`](phases/PROGRESS.md).

| Phase | Theme                                                | Status      |
| ----- | ---------------------------------------------------- | ----------- |
| 1     | Foundation                                           | Done        |
| 2     | Identity and tenant isolation                        | Done        |
| 3     | Pivot and cleanup                                    | Done        |
| 4     | Applications, API keys, event types, endpoints       | Done        |
| 5     | Message ingestion, outbox relay, fan-out             | In progress |
| 6     | Dispatcher                                           | Planned     |
| 7     | Failure handling, isolation, replay, secret rotation | Planned     |
| 8     | Console                                              | Planned     |
| 9     | Realtime delivery feed and analytics                 | Planned     |
| 10    | Audit and receiver verification library              | Planned     |
| 11    | Testing depth: load and chaos                        | Planned     |
| 12    | Production readiness on AWS                          | Planned     |

## Acceptance criteria

### Phase 1: Foundation (done)

Monorepo builds; services start; `/health/ready` is green against PostgreSQL, Redis and RabbitMQ;
the gateway routes by prefix; CI runs lint, typecheck, test, build and Docker builds.

### Phase 2: Identity and tenant isolation (done)

Registration, login and refresh rotation with reuse detection; organizations and invitations; RBAC
guards; cross-tenant access fails closed in HTTP and database-level tests; RLS enabled.

### Phase 3: Pivot and cleanup

1. `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `test` and `build` pass,
   and every CI job passes (verify, integration, audit, docker, dead-code check).
2. The identity integration suites (auth, authorization, RLS, tenant isolation) pass with no test
   removed or weakened.
3. `git grep -i -w -E "products?|skus?|warehouses?|inventory|suppliers?|purchase orders?" -- . ':!docs/adr' ':!docs/ROADMAP.md' ':!pnpm-lock.yaml'`
   finds nothing: the removed domain survives only in superseded ADRs and in this roadmap.
4. `knip` reports no unused files, exports or dependencies, and runs in CI.
5. The identity permission sync removes permissions that left the catalog, together with their
   role assignments (integration test).
6. On a fresh stack (`docker compose down -v`), migrations apply and
   `/internal/health/{identity,ingest,notification,analytics,audit}` are all ready.
7. The tag `v0-distribution` exists on `cf9372f`.

### Phase 4: Applications, API keys, event types, endpoints, signing secrets

1. CRUD for applications, event types (with archive), endpoints and API keys, each behind its own
   permission and covered by role tests.
2. Every new table has `organization_id`, composite tenant foreign keys and an RLS policy; a
   cross-tenant test per resource proves read, update and delete fail (404) for another tenant.
3. API keys are shown once, stored only as a hash, scoped, revocable, and record `last_used_at`.
4. Signing secrets are stored encrypted, are never returned after creation, and can be revealed
   only with the reveal permission; every reveal writes an audit event.
5. Endpoint URL validation rejects private, loopback, link-local (including 169.254.169.254),
   multicast and reserved IPv4 and IPv6 ranges, non-HTTPS URLs in production mode, and URLs with
   credentials; unit tests cover each class including IPv4-mapped IPv6 and encoded forms.
6. No secret or API key appears in logs (test over captured log output).

### Phase 5: Message ingestion, outbox relay, fan-out

1. `POST /api/v1/applications/{app}/messages` with an API key and `Idempotency-Key` stores a
   message and its outbox event in one transaction; a replay within the retention window (24 hours
   by default, configurable) returns the original message and creates nothing new; a replay with a
   different body is rejected.
2. Unknown event type, oversized payload and schema-invalid payload are rejected with distinct,
   documented errors.
3. The outbox relay publishes with publisher confirms and `FOR UPDATE SKIP LOCKED`; killing the
   relay mid-batch loses no event (test).
4. Consumers are idempotent: delivering the same event twice produces one set of side effects
   (test). Poison messages end in a DLQ after the configured attempts.
5. Fan-out creates exactly one delivery per subscribed, enabled endpoint, and none for disabled or
   unsubscribed ones.
6. Per-API-key rate limiting is enforced with Redis and returns `429` with `Retry-After`.

### Phase 6: Dispatcher

1. Requests carry valid Standard Webhooks headers; a verifier built from the specification's test
   vectors accepts them, and tampering with id, timestamp or body is rejected.
2. Retries follow the configured schedule (default: immediately, 5s, 5m, 30m, 2h, 5h, 10h, 10h)
   with jitter; a test with a fake clock proves the schedule and the jitter bounds.
3. Connect and total timeouts, the payload limit and the stored-response-body limit are enforced
   (tests against a local server that stalls, streams forever and returns huge bodies).
4. The send-time SSRF guard resolves DNS, rejects forbidden addresses, pins the resolved address,
   and does not follow redirects; a test with a DNS answer that changes between validation and
   connection proves rebinding cannot reach a private address.
5. Every attempt is recorded in DynamoDB with a TTL; PostgreSQL holds the current delivery state.
6. A worker killed after sending and before recording never loses the delivery: it is retried
   (at-least-once) with the same `webhook-id`.

### Phase 7: Failure handling, isolation, replay, secret rotation

1. After the last attempt a delivery is `failed` and available for replay.
2. A dead or slow endpoint never delays deliveries to other endpoints or tenants: a test with one
   stalled endpoint and many healthy ones shows healthy deliveries complete within a stated bound.
3. Circuit breaking and auto-disable work after the configured failure period; the tenant is
   notified exactly once.
4. Replay of a single message and bulk replay of failed messages for an endpoint in a time range
   create new attempts and are idempotent.
5. During a rotation window, requests carry signatures from both the old and the new secret; after
   the window only the new one.

### Phase 8: Console

1. Pages for applications, endpoints, event types and API keys with permission-aware UI.
2. A message inspector with the attempt timeline, replay actions, and a test-send button.
3. Component tests for forms and state, and an end-to-end browser test of the main flow.

### Phase 9: Realtime delivery feed and analytics

1. An authenticated WebSocket feed scoped to the tenant; a test proves another tenant's events are
   never received.
2. Analytics report success rate, attempts per delivery, and p50/p95/p99 latency per endpoint and
   per application, checked against fixtures with known answers.

### Phase 10: Audit and receiver verification library

1. Every administrative action produces an audit record with actor, action, target and time,
   queryable by the tenant and never across tenants.
2. A TypeScript verification library implements Standard Webhooks verification (timestamp
   tolerance, multiple signatures), published as a workspace package with docs and examples, and
   passes the specification's vectors.

### Phase 11: Testing depth

1. A load test with a documented procedure; throughput and p95 are recorded only from real runs.
2. Chaos tests prove no message loss and no cross-endpoint blocking for: endpoint down, endpoint
   slow, RabbitMQ restart, worker crash mid-delivery.

### Phase 12: Production readiness on AWS

1. Terraform validates (`terraform validate`, `fmt -check`) and plans; nothing is applied without
   the owner's approval.
2. Structured logs, metrics, traces, dashboards and alerts are defined as code.
3. Runbooks exist for DLQ handling, RabbitMQ failure, key rotation and restore; a written security
   review lists findings and their status.

## Technical risks

| Risk                                                       | Impact   | Mitigation                                                                                                       |
| ---------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| Cross-tenant data leak                                     | Critical | Token-derived tenant; composite foreign keys; RLS; cross-tenant tests per resource; key prefixes in DynamoDB.    |
| SSRF through endpoint URLs or redirects                    | Critical | Validation at creation and at send time, pinned resolved address, no redirects, HTTPS only in production.        |
| Signing secret exposure                                    | Critical | Envelope encryption, never logged or returned, audited reveal.                                                   |
| Lost or duplicated messages                                | High     | Transactional outbox, publisher confirms, idempotent consumers, at-least-once delivery with stable `webhook-id`. |
| One slow endpoint starving the rest                        | High     | Per-endpoint concurrency caps, timeouts, circuit breaking, fair claiming across tenants.                         |
| Attempt history written outside the PostgreSQL transaction | Medium   | Idempotent state transitions; history is derived data and may be re-recorded.                                    |
| NestJS 12 is ESM-only; parts of the ecosystem lag          | Medium   | Pin versions; prefer thin libraries; verify each addition builds under ESM.                                      |
| Scope creep versus depth                                   | Medium   | Verifiable criteria per phase; depth on correctness under failure over feature count.                            |
