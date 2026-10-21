# Architecture Decision Records

This directory records the significant architectural decisions behind Solmira. The living
system description is [`ARCHITECTURE.md`](../../ARCHITECTURE.md); the delivery plan is
[`docs/ROADMAP.md`](../ROADMAP.md). ADRs explain _why_ the system has the shape those documents
describe.

## Index

| #    | Title                                                                                                                       | Status             | Date       |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- |
| 0001 | [Monorepo with pnpm workspaces and Turborepo](0001-monorepo-pnpm-turborepo.md)                                              | Accepted           | 2026-09-29 |
| 0002 | [NestJS for backend services](0002-nestjs-for-backend-services.md)                                                          | Accepted           | 2026-09-29 |
| 0003 | [Next.js for the web console](0003-nextjs-for-web.md)                                                                       | Accepted           | 2026-09-29 |
| 0004 | [Service boundaries along consistency boundaries](0004-service-boundaries.md)                                               | Superseded by 0024 | 2026-09-29 |
| 0005 | [PostgreSQL, one database per service](0005-postgresql-database-per-service.md)                                             | Accepted           | 2026-09-29 |
| 0006 | [Multi-tenancy with a shared schema](0006-multi-tenancy-shared-schema.md)                                                   | Accepted           | 2026-09-29 |
| 0007 | [Nginx as the edge gateway](0007-nginx-gateway.md)                                                                          | Accepted           | 2026-09-29 |
| 0008 | [Drizzle ORM and SQL migrations](0008-drizzle-orm.md)                                                                       | Accepted           | 2026-09-29 |
| 0009 | [RabbitMQ for integration events](0009-rabbitmq-for-integration-events.md)                                                  | Accepted           | 2026-09-29 |
| 0010 | [Authentication strategy: signed access tokens and refresh sessions](0010-authentication-strategy.md)                       | Accepted           | 2026-09-29 |
| 0011 | [Refresh token rotation with reuse detection](0011-refresh-token-rotation.md)                                               | Accepted           | 2026-09-29 |
| 0012 | [PostgreSQL Row Level Security](0012-postgresql-row-level-security.md)                                                      | Accepted           | 2026-09-29 |
| 0013 | [Catalog modeling: products, variants, categories and suppliers](0013-catalog-modeling.md)                                  | Superseded by 0023 | 2026-09-30 |
| 0014 | [Object storage behind a port, S3 API everywhere](0014-object-storage-abstraction.md)                                       | Superseded by 0023 | 2026-09-30 |
| 0015 | [SKU uniqueness per organization, among live variants](0015-sku-uniqueness.md)                                              | Superseded by 0023 | 2026-09-30 |
| 0016 | [Warehouses, and managers from the same organization](0016-warehouses-and-managers.md)                                      | Superseded by 0023 | 2026-09-30 |
| 0017 | [Product images: validated uploads and tenant-scoped keys](0017-product-image-storage.md)                                   | Superseded by 0023 | 2026-09-30 |
| 0018 | [Inventory as counters plus an append-only ledger](0018-inventory-ledger-and-counters.md)                                   | Superseded by 0023 | 2026-09-30 |
| 0019 | [Stock movement rules: adjustments, counts and transfers](0019-stock-movement-rules.md)                                     | Superseded by 0023 | 2026-09-30 |
| 0020 | [Reservations, and how overselling is prevented](0020-reservations-and-oversell-prevention.md)                              | Superseded by 0023 | 2026-09-30 |
| 0021 | [Purchase orders: model, lifecycle and money](0021-purchase-order-model-and-lifecycle.md)                                   | Superseded by 0023 | 2026-10-01 |
| 0022 | [Receiving: one transaction, row locks and an Idempotency-Key](0022-transactional-idempotent-receiving.md)                  | Superseded by 0023 | 2026-10-01 |
| 0023 | [Pivot to a webhook delivery platform](0023-pivot-to-webhook-delivery.md)                                                   | Accepted           | 2026-10-21 |
| 0024 | [Service boundaries for the webhook platform](0024-service-boundaries-webhook-platform.md)                                  | Accepted           | 2026-10-21 |
| 0025 | [Webhook resource model and lifecycle](0025-webhook-resource-model.md)                                                      | Accepted           | 2026-10-21 |
| 0026 | [Signing secret storage and reveal](0026-signing-secret-storage.md)                                                         | Accepted           | 2026-10-21 |
| 0027 | [API key design and lookup](0027-api-key-design.md)                                                                         | Accepted           | 2026-10-21 |
| 0028 | [Endpoint URL policy and SSRF defense at creation](0028-endpoint-url-policy.md)                                             | Accepted           | 2026-10-21 |
| 0029 | [Event backbone: outbox relay, consumers, retries and DLQs](0029-event-backbone.md)                                         | Accepted           | 2026-10-21 |
| 0030 | [Message ingestion, idempotency and fan-out](0030-message-ingestion.md)                                                     | Accepted           | 2026-10-21 |
| 0031 | [Dispatcher design: claiming, leases, retries and the delivery request](0031-dispatcher-design.md)                          | Accepted           | 2026-10-21 |
| 0032 | [Delivery attempt history in DynamoDB](0032-attempt-history-dynamodb.md)                                                    | Accepted           | 2026-10-21 |
| 0033 | [Endpoint isolation, circuit breaking, auto-disable, replay and secret rotation](0033-isolation-failure-handling-replay.md) | Accepted           | 2026-10-21 |
| 0034 | [Message inspection and test send](0034-inspection-and-test-send.md)                                                        | Accepted           | 2026-10-21 |
| 0035 | [Realtime delivery feed and analytics](0035-realtime-feed-and-analytics.md)                                                 | Accepted           | 2026-10-21 |

## Process

Solmira uses lightweight, Nygard-style ADRs: each record is a short markdown file named
`NNNN-kebab-title.md` with a status, a date, the context that forced a decision, the decision
itself, the alternatives that were rejected and why, and the consequences the team accepts.
A new ADR starts as `Proposed`, is discussed in the pull request that introduces it, and becomes
`Accepted` when merged. Accepted ADRs are immutable: if a decision changes, a new ADR is written
that references the old one, and the old record's status is changed to `Superseded by ADR-NNNN`
(the only edit ever made to it). Typos and broken links may be fixed; reasoning is never
rewritten after the fact, so the log stays an honest history of what was known when each
decision was made. Decisions that are planned for later phases (for example retry scheduling, DynamoDB attempt
history and the AWS topology) get their own ADRs when those phases start.

## Template

```markdown
# ADR-NNNN: <Title>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD

## Context

## Decision

## Alternatives considered

## Tradeoffs

## Consequences

## Failure, scaling, security and operational implications
```
