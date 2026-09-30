# Solmira Delivery Roadmap

Each phase ends with lint, type checks and tests passing, the behaviour verified against running
infrastructure, updated docs, and a written milestone review.

| Phase | Theme                 | Exit criteria (verifiable)                                                                                                                                                                                                                 |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Foundation            | Monorepo builds; 5 services + web start; `/health/ready` is green against Postgres/Redis/RabbitMQ in Docker; gateway routes by prefix; CI runs lint/typecheck/test/build/docker.                                                           |
| 2     | Identity & tenancy    | Register/login/refresh rotation with reuse detection; org creation; invitations; RBAC guards; cross-tenant access tests fail closed; RLS enabled.                                                                                          |
| 3     | Catalog               | **Done.** Products, variants, categories, suppliers, warehouses; search/filter/sort/offset pagination; bulk status; validated image uploads to private S3 (MinIO locally) with signed reads (ADR-0013–0017). Customers move to phase 6.    |
| 4     | Inventory             | **Done.** Counters plus append-only ledger, reason-checked adjustments and counts, atomic transfers, all-or-nothing reservations; concurrency tests prove no oversell and no deadlock (ADR-0018–0020).                                     |
| 5     | Purchasing            | **Done.** PO state machine with approval and separation of duties, partial receiving that updates lines, stock and ledger in one transaction, no over-receiving under concurrency, idempotent receipts, events via outbox (ADR-0021–0022). |
| 6     | Customer orders       | Order state machine, idempotent creation, confirm-reserves-inventory transaction, cancellation releases stock, outbox events.                                                                                                              |
| 7     | Event backbone        | Outbox relay with confirms, retry queues + DLQs, idempotent consumers, duplicate-delivery tests, DLQ runbook.                                                                                                                              |
| 8     | Realtime              | Authenticated Socket.IO gateway, org-scoped rooms, Redis adapter for multi-instance fan-out, live order/inventory/notification UI.                                                                                                         |
| 9     | Analytics             | Event-fed rollups, dashboard REST + GraphQL, Redis cache-aside with stampede protection, `EXPLAIN` evidence for key queries.                                                                                                               |
| 10    | Audit & observability | Audit log API + UI, DynamoDB event history, OpenTelemetry traces, metrics endpoints, dashboards.                                                                                                                                           |
| 11    | Testing depth         | Integration suites on Testcontainers, API tests, Playwright E2E for the demo scenario, security tests (IDOR, role escalation).                                                                                                             |
| 12    | Production readiness  | Terraform for AWS, CD workflow, load test results, hardening checklist, backup/DR runbooks, interview guide and portfolio material.                                                                                                        |

## Technical risks

| Risk                                                            | Impact   | Mitigation                                                                                                                |
| --------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant data leak through a missed `WHERE organization_id` | Critical | Token-derived tenant only; composite FKs; PostgreSQL RLS as a second wall; automated cross-tenant tests per endpoint.     |
| Overselling under concurrent confirmation                       | High     | Single-statement guarded `UPDATE` inside a transaction; deterministic lock order; concurrency integration test.           |
| Lost or duplicated events                                       | High     | Transactional outbox, publisher confirms, idempotent consumers keyed by `eventId`.                                        |
| NestJS 12 is ESM-only; parts of the ecosystem lag               | Medium   | Pin versions; prefer thin, well-maintained libs (pino, ioredis, amqplib, drizzle); verify each addition builds under ESM. |
| Distributed debugging across 5 services                         | Medium   | Correlation IDs from day one; structured logs; OpenTelemetry in phase 10.                                                 |
| Local resource limits (full stack in Docker on a laptop)        | Medium   | Infra-only compose by default; services run on the host in dev; the `apps` profile builds the full stack on demand.       |
| Refresh-token theft                                             | High     | httpOnly `SameSite=Strict` cookie scoped to the auth path; rotation with family revocation on reuse.                      |
| Analytics queries degrading the order path                      | Medium   | Separate service and DB fed by events; no analytics reads against operations DB.                                          |
| Scope creep versus depth                                        | Medium   | Each phase has verifiable exit criteria; depth on the critical path (tenancy, inventory, events) over breadth.            |
