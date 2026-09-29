# Solmira Architecture

This is the living architecture document for Solmira. It starts as the design proposal
written before implementation and is updated as each phase lands. Deeper material lives in
[`docs/architecture/`](docs/architecture/) and decisions are recorded as ADRs in
[`docs/adr/`](docs/adr/).

> Status legend: **Built** = implemented and tested, **Planned** = designed, lands in the phase noted.

## 1. System context

```mermaid
flowchart LR
  user([Operations teams<br/>browser]) --> cdn[CloudFront]
  cdn --> gw[Gateway<br/>Nginx]
  gw --> web[web<br/>Next.js]
  gw --> id[identity-service]
  gw --> ops[operations-service]
  gw --> ntf[notification-service<br/>REST + WebSocket]
  gw --> ana[analytics-service<br/>REST + GraphQL]
  gw --> aud[audit-service]

  id & ops & ntf & ana & aud --> pg[(PostgreSQL<br/>database per service)]
  id & ops & ntf & ana --> redis[(Redis)]
  id & ops -- outbox relay --> mq{{RabbitMQ<br/>solmira.events}}
  mq --> ops & ntf & ana & aud
  aud --> ddb[(DynamoDB<br/>event history)]
  ops --> s3[(S3<br/>product media)]
```

## 2. Repository structure

```
apps/
  web/                    Next.js 16 app router UI (operations console)
  identity-service/       auth, sessions, organizations, members, roles, invitations
  operations-service/     catalog, suppliers, warehouses, inventory, purchasing, orders, fulfillment
  notification-service/   in-app + email notifications, preferences, WebSocket gateway
  analytics-service/      event-fed read models, dashboard REST + GraphQL
  audit-service/          audit log query API, event-history archive (DynamoDB)
packages/
  contracts/              zod schemas + types shared by web and services (HTTP, events, permissions)
  service-kit/            NestJS platform module: config, logging, request context, errors,
                          health, Postgres/Redis/RabbitMQ clients, bootstrap
infra/
  docker/                 Dockerfiles, Nginx gateway config, Postgres init scripts
  terraform/              AWS infrastructure (phase 12)
docs/
  architecture/  adr/  runbooks/
```

Tooling: pnpm workspaces + Turborepo (task graph and caching), TypeScript 6 strict everywhere,
ESM everywhere (NestJS 12 is ESM-only), ESLint flat config, Prettier, Vitest.

## 3. Service boundaries

Services are cut along **consistency boundaries**, not along nouns. The rule: data that must change
atomically together lives in one service and one database. Everything else talks through events.

| Service                  | Owns                                                                                            | Why it is separate                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **identity-service**     | users, credentials, sessions, organizations, memberships, roles, permissions, invitations       | Security-critical, different change cadence, the only holder of the token signing key.                                                                            |
| **operations-service**   | products, variants, suppliers, customers, warehouses, inventory, POs, orders, shipments         | Order confirmation, inventory reservation and receiving must be ACID. Splitting orders from inventory would turn the most correctness-sensitive path into a saga. |
| **notification-service** | notifications, preferences, delivery attempts, WebSocket connections                            | Pure event consumer; scales with connected clients, not with orders. Failure must never block an order.                                                           |
| **analytics-service**    | pre-aggregated read models (daily sales, product sales, inventory value, fulfillment durations) | Expensive reads must not share a database with the transactional path.                                                                                            |
| **audit-service**        | curated audit log (Postgres) and raw event history (DynamoDB)                                   | Append-only, high write volume, long retention, compliance access patterns.                                                                                       |

`operations-service` is a **modular monolith** internally: `catalog`, `inventory`, `purchasing`,
`orders` and `fulfillment` are separate NestJS modules. They talk only through exported services,
never another module's tables. Any module can be extracted later once its data no longer has to
share a transaction (see ADR-0004).

## 4. Request path

Status: **Built** in identity-service (phase 2). Other services adopt the same `AuthModule` and
tenant-scoped database helper from `service-kit` as their routes land.

1. **Gateway (Nginx)** assigns or propagates `X-Request-Id` and `X-Correlation-Id`, applies edge rate
   limits and security headers, routes by path prefix, and writes JSON access logs. It holds no business logic.
2. **Service** runs the request-context middleware (AsyncLocalStorage) so every log line and
   emitted event carries both IDs. One global `AuthGuard` verifies the access token locally
   (Ed25519-signed JWT; public key from configuration, also published as JWKS by identity-service),
   checks the Redis revocation denylist, and checks the required permission for the tenant resolved
   _from the token_. The organization ID is never taken from the request body or query; a route
   `:organizationId` must equal the token's organization, otherwise the answer is 404.
3. **Data access** runs inside a tenant-scoped transaction (`inTenantScope`). Queries filter by
   `organization_id`, and PostgreSQL Row Level Security enforces the same rule as defense in depth.

Routing table (gateway → service):

| Prefix                                                                                                                   | Service              |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `/api/v1/auth`, `/me`, `/organizations`, `/users`, `/roles`, `/permissions`, `/invitations`                              | identity-service     |
| `/api/v1/products`, `/suppliers`, `/customers`, `/warehouses`, `/inventory`, `/purchase-orders`, `/orders`, `/shipments` | operations-service   |
| `/api/v1/notifications`, `/ws`                                                                                           | notification-service |
| `/api/v1/analytics`, `/graphql`                                                                                          | analytics-service    |
| `/api/v1/audit-logs`                                                                                                     | audit-service        |
| everything else                                                                                                          | web                  |

The browser talks only to the gateway origin, so there is no CORS surface in production.

## 5. Multi-tenancy

Strategy: **shared database, shared schema, `organization_id` on every tenant-owned row** (ADR-0006, ADR-0012).

Status: **Built** for identity-service and operations-service. All three layers below are in
place; operations uses composite foreign keys for every catalog reference (phase 3). Full description:
[`docs/architecture/tenant-isolation.md`](docs/architecture/tenant-isolation.md).

| Option                        | Isolation | Cost / ops                          | Verdict                                                  |
| ----------------------------- | --------- | ----------------------------------- | -------------------------------------------------------- |
| Shared DB + shared schema     | Logical   | Lowest; one migration path          | **Chosen**, hardened with RLS and composite foreign keys |
| Shared DB + schema per tenant | Stronger  | Migrations × tenants, catalog bloat | Reserved for regulated tenants                           |
| Database per tenant           | Strongest | Highest; per-tenant pooling/backups | Enterprise tier option                                   |

Three layers of enforcement:

1. **Application**: tenant ID comes only from the verified token; repositories require it as an argument.
2. **Schema**: composite foreign keys `(organization_id, id)`, for example `order_items (organization_id, variant_id) → product_variants (organization_id, id)`, make it impossible to _reference_ another tenant's row even with a guessed UUID.
3. **Database**: RLS policies `USING (organization_id = app_current_organization_id())`, where the function reads `current_setting('app.organization_id', true)` and yields `NULL` (no rows) when the setting is missing. The service connects as a non-owner role and sets the setting with `set_config(..., true)` (transaction-local, like `SET LOCAL`) at the start of every transaction. This is safe with connection pooling because the setting dies with the transaction. RLS is enabled, not forced; readiness fails if the runtime role could bypass it.

Lookups by ID for an entity in another tenant return **404, not 403**, so the API does not confirm the entity exists.

## 6. Identity (Phase 2)

Status: **Built**. identity-service issues Ed25519-signed access tokens (15 min, held in browser
memory only) and rotates opaque refresh tokens held in an `httpOnly`, `SameSite=Strict` cookie
scoped to `/api/v1/auth`; reusing a consumed refresh token revokes the whole session. Access is
checked by permission from a catalog in `@solmira/contracts`, synced to the database on deploy,
and role changes take effect immediately through a Redis denylist. Tenant context flows from the
token into every transaction, where RLS enforces it.

- [`docs/architecture/authentication.md`](docs/architecture/authentication.md): tokens, sessions, rotation, revocation, passwords, recovery, CSRF
- [`docs/architecture/authorization.md`](docs/architecture/authorization.md): permission catalog, roles and ranks, guard order, membership rules
- [`docs/architecture/tenant-isolation.md`](docs/architecture/tenant-isolation.md): how tenant context reaches the database, RLS policies, tests
- ADRs [0010](docs/adr/0010-authentication-strategy.md), [0011](docs/adr/0011-refresh-token-rotation.md), [0012](docs/adr/0012-postgresql-row-level-security.md); overview in [`SECURITY.md`](SECURITY.md)

## 6a. Catalog, suppliers and warehouses (Phase 3)

Status: **Built** in operations-service. Products with variants (SKU unique per organization among
live variants), a three-level category tree, suppliers, warehouses with managers verified against
identity, and product images in a private S3 bucket (MinIO locally) served through 5-minute
signed URLs. Nothing is hard-deleted except empty categories; products, variants, suppliers and
warehouses have status lifecycles. Lists offer search (PostgreSQL trigram indexes), filters,
sorting and offset pagination. Every write records a catalog event in the outbox.

operations-service verifies access tokens with identity's public JWKS and never holds the signing
key. It calls identity only to verify a warehouse manager, forwarding the caller's own token.

- [`docs/architecture/catalog.md`](docs/architecture/catalog.md): tables, constraints, indexes, API, rules, events, console, tests
- [`docs/architecture/object-storage.md`](docs/architecture/object-storage.md): storage port, upload and read flows, security properties
- ADRs [0013](docs/adr/0013-catalog-modeling.md), [0014](docs/adr/0014-object-storage-abstraction.md), [0015](docs/adr/0015-sku-uniqueness.md), [0016](docs/adr/0016-warehouses-and-managers.md), [0017](docs/adr/0017-product-image-storage.md)

## 7. Data model (planned; built phase by phase)

Conventions: UUIDv7 primary keys generated in the application (time-ordered, index friendly,
portable to MySQL), money as `bigint` minor units plus an ISO-4217 `currency` code (never floats),
`timestamptz` for all times (stored in UTC), `created_at` / `updated_at` on mutable tables,
and a `version` column where optimistic concurrency is used.

**identity DB** (built): `users`, `organizations`, `organization_members`, `roles` (system roles have
`organization_id IS NULL`), `permissions`, `role_permissions`, `invitations`, `sessions`
(one per sign-in), `refresh_tokens` (the rotation chain of a session), `email_tokens`
(email verification and password reset, by `purpose`), `outbox_events`.
Tokens are stored only as SHA-256 hashes.

**operations DB**: built so far (phase 3): `categories`, `suppliers`, `warehouses`, `products`,
`product_variants`, `product_images`, `member_directory`, `outbox_events` (see
[catalog.md](docs/architecture/catalog.md)). The full target model:

```mermaid
erDiagram
  categories ||--o{ products : groups
  suppliers ||--o{ products : supplies
  products ||--|{ product_variants : has
  products ||--o{ product_images : shows
  warehouses ||--o{ inventory : stocks
  product_variants ||--o{ inventory : "stocked as"
  inventory ||--o{ inventory_movements : "changed by"
  suppliers ||--o{ purchase_orders : receives
  purchase_orders ||--|{ purchase_order_items : contains
  customers ||--o{ orders : places
  orders ||--|{ order_items : contains
  order_items ||--o{ inventory_reservations : holds
  orders ||--o{ shipments : "fulfilled by"
  orders ||--o{ order_status_history : records
```

Key invariants, enforced by the database and not only by code:

- `inventory`: unique `(organization_id, warehouse_id, variant_id)`,
  `CHECK (on_hand >= 0 AND reserved >= 0 AND damaged >= 0 AND reserved <= on_hand)`.
  `available` is a generated column (`on_hand - reserved`).
- `inventory_movements`: append-only ledger (`quantity` signed; `type`, `reference_type`, `reference_id`).
  Stock levels can be rebuilt from it.
- `purchase_order_items`: `CHECK (received_quantity <= ordered_quantity)`.
- `orders`: unique `(organization_id, order_number)`, unique `(organization_id, idempotency_key)`.
- Line items snapshot SKU, name and unit price at order time, so later catalog edits never rewrite history.

**notification DB**: `notifications`, `notification_preferences`, `delivery_attempts`, `processed_events`.
**analytics DB**: `daily_sales`, `daily_product_sales`, `inventory_value_snapshots`, `fulfillment_durations`, `processed_events`.
**audit DB**: `audit_logs` (filterable by actor/entity/action/time), `processed_events`.
**DynamoDB `solmira-event-history`**: `PK = ORG#<orgId>`, `SK = <occurredAt>#<eventId>`,
GSI1 `ENTITY#<type>#<id>` / `occurredAt`, TTL attribute for retention (ADR in phase 10).

MySQL portability: the core schema avoids PostgreSQL-only types. `jsonb` columns are used as
plain JSON, case-insensitive email uses a unique index on `lower(email)`, and generated columns
exist in both engines. PostgreSQL-specific features (RLS, partial indexes, `SKIP LOCKED`) are
isolated and documented where used.

## 8. Event model

All integration events share one envelope (defined in `packages/contracts`):

```ts
{
  eventId: string; // UUIDv7, used for idempotency
  type: string; // e.g. "order.confirmed"
  version: number; // payload schema version
  occurredAt: string; // ISO-8601 UTC
  organizationId: string;
  actorId: string | null;
  correlationId: string; // ties the event to the originating request
  causationId: string | null; // eventId that caused this one
  payload: unknown; // validated per (type, version) with zod
}
```

Topology: one durable **topic exchange** `solmira.events`, routing key = event type. Each
consuming service owns a queue (`<service>.events`) bound to the patterns it cares about, a
**retry queue** with a per-message TTL that dead-letters back to the main queue (exponential
backoff), and a **DLQ** (`<service>.events.dlq`) after N attempts.

Delivery is **at least once**. Producers write events into `outbox_events` inside the business
transaction. A relay publishes them with publisher confirms and marks them sent, claiming
batches with `FOR UPDATE SKIP LOCKED` so relay replicas never double-claim. Consumers are
idempotent: they insert `(consumer, event_id)` into `processed_events` in the same transaction as
their side effect, so a redelivered event is a no-op.

| Event                                                                                  | Producer     | Consumers                                                             |
| -------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------- |
| `member.invited`, `member.role_changed`                                                | identity     | notification, audit                                                   |
| `product.*`, `variant.*`, `category.*`, `supplier.*`, `warehouse.*`, `product_image.*` | operations   | audit, analytics (from phase 7; recorded in the outbox since phase 3) |
| `order.created` / `.confirmed` / `.cancelled` / `.status_changed`                      | operations   | notification, analytics, audit                                        |
| `inventory.reserved` / `.released` / `.adjusted` / `.transferred`                      | operations   | operations (low-stock evaluator), analytics, audit                    |
| `inventory.low_stock`                                                                  | operations   | notification, analytics                                               |
| `purchase_order.created` / `.received`                                                 | operations   | notification, analytics, audit                                        |
| `shipment.created` / `.status_changed`                                                 | operations   | notification, analytics, audit                                        |
| `notification.created`                                                                 | notification | notification WebSocket fan-out (Redis)                                |

## 9. Order confirmation and inventory reservation (summary)

Confirming an order runs **one PostgreSQL transaction** inside operations-service:

1. Lock the order row (`SELECT … FOR UPDATE`) and validate the transition `PENDING → CONFIRMED`
   against the state machine.
2. For each line, in a deterministic order (sorted by inventory key, to prevent deadlocks):
   `UPDATE inventory SET reserved = reserved + $q WHERE … AND on_hand - reserved >= $q`.
   Zero rows updated means insufficient stock, so the whole transaction rolls back.
3. Insert `inventory_reservations`, `inventory_movements (type = reserved)` and `order_status_history`.
4. Insert outbox events `order.confirmed` and `inventory.reserved`.
5. Commit. Notifications, analytics and audit happen asynchronously from the outbox.

Two buyers racing for the last unit: both `UPDATE`s target the same row. PostgreSQL serializes
them on the row lock, and the second re-evaluates the `WHERE` guard after the first commits,
matches zero rows and fails cleanly. No overselling, no application-level locks. Full analysis
in `docs/architecture/inventory-reservation.md` (phase 4).

## 10. Cross-cutting

- **Config**: every service validates `process.env` with zod at startup and fails fast with the
  names (never the values) of invalid variables.
- **Logging**: pino JSON logs; every line has `service`, `requestId`, `correlationId`.
  Authorization headers, cookies, passwords and tokens are redacted at the logger.
- **Errors**: one envelope `{ error: { code, message, details?, requestId } }`. Unknown errors become
  `500 INTERNAL_ERROR` with no stack or driver message leaked to clients.
- **Health**: `GET /health/live` (process up) and `GET /health/ready` (dependencies reachable,
  each check time-boxed). Load balancers use readiness; restarts use liveness.
- **Observability** (phase 10): OpenTelemetry traces across HTTP and RabbitMQ (trace context in
  message headers), Prometheus-format metrics, CloudWatch in AWS.

## 11. Deployment (phase 12 summary)

CloudFront → ALB → ECS Fargate services in private subnets, RDS PostgreSQL (Multi-AZ),
ElastiCache Redis, Amazon MQ for RabbitMQ, DynamoDB, S3 for media, Secrets Manager for
credentials, CloudWatch for logs and metrics, all provisioned by Terraform. Details in
`DEPLOYMENT.md` when phase 12 lands.
