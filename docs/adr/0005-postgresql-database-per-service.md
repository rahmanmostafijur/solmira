# ADR-0005: PostgreSQL as system of record, one database per service

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Solmira's core data is relational and invariant-heavy:

- `inventory` has a unique key `(organization_id, warehouse_id, variant_id)` and
  `CHECK (on_hand >= 0 AND reserved >= 0 AND damaged >= 0 AND reserved <= on_hand)`, with
  `available` as a generated column.
- `purchase_order_items` has `CHECK (received_quantity <= ordered_quantity)`.
- `orders` has unique `(organization_id, order_number)` and `(organization_id, idempotency_key)`.
- Order confirmation updates `orders`, `inventory`, `inventory_reservations`,
  `inventory_movements`, `order_status_history` and `outbox_events` in one transaction.
- The console needs ad hoc filtering and sorting (status, supplier, warehouse, date ranges,
  text search) with cursor pagination.

Service boundaries (ADR-0004) require that no service reads another's tables. Tenancy
(ADR-0006) relies on Row Level Security.

## Decision

- **PostgreSQL** is the system of record for all five services.
- **One logical database per service**: `identity`, `operations`, `notification`, `analytics`,
  `audit`. Locally they share one PostgreSQL container (created by `infra/docker` init
  scripts); in AWS they are separate databases on RDS, with the option of separate RDS instances
  for operations and analytics when load warrants. No cross-database queries or foreign keys.
- **Two roles per database:**
  - `<service>_owner` owns the schema and runs drizzle-kit migrations (DDL). Used only by the
    migration job.
  - `<service>_app` has only `SELECT/INSERT/UPDATE/DELETE` on the tables it needs and is what
    the running service connects as. Because table owners bypass RLS by default, the runtime must
    not be the owner, otherwise every RLS policy is silently inert. Tables also use
    `FORCE ROW LEVEL SECURITY` as a second guard.
- Append-only tables (`inventory_movements`, `audit_logs`) grant the app role no `UPDATE/DELETE`.
- Credentials come from environment variables locally and Secrets Manager in AWS.

## Alternatives considered

- **DynamoDB for everything.** Excellent for key-value access at scale, and it is used where that
  fits (audit event history, phase 10). Rejected as the system of record because the invariants
  above would move into application code: no `CHECK` constraints, no foreign keys, transactions
  capped at 100 items and priced per item, and ad hoc console filtering would require a GSI per
  filter combination or a scan. The guarded `UPDATE ... WHERE on_hand - reserved >= $q` becomes a
  condition expression per item plus hand-built ledger writes.
- **MongoDB.** Multi-document transactions exist, but the model is relational (orders ->
  items -> reservations -> inventory) and would be reassembled with `$lookup` or denormalized.
- **MySQL 8.** A credible choice; rejected as primary because PostgreSQL has native Row Level Security
  (the third tenancy wall in ADR-0006), partial indexes, and transactional DDL, so a failed
  migration rolls back cleanly instead of leaving a half-altered schema. `SKIP LOCKED` exists in
  both, so it was not a differentiator.
- **One shared database with schemas per service.** Cheaper, but makes cross-service joins one
  typo away and couples migrations and blast radius.

## Tradeoffs

- Database per service forbids joins across services; analytics and audit get their data from
  events, not queries.
- One shared local instance is a convenience only; noisy-neighbour effects are not representative
  of production.
- The two-role model adds grant management to every migration.

## Consequences

**Positive**

- Invariants live in the database, so a bug in code produces a constraint violation instead of
  negative stock.
- RLS actually applies at runtime because the app role is not the owner.
- Services can be migrated, backed up and restored independently.

**Negative**

- More connection pools overall; PgBouncer or RDS Proxy may be needed as tasks scale (both
  preserve `SET LOCAL` semantics in transaction pooling mode).
- Reporting across services requires the analytics read models.

## MySQL portability notes

The core schema avoids PostgreSQL-only types: UUIDv7 keys generated in the application, money as
`bigint` minor units plus currency, `jsonb` used only as plain JSON, case-insensitive email via a
unique index on `lower(email)` (functional index in MySQL 8), generated columns in both.
PostgreSQL-specific pieces are isolated and documented: RLS (MySQL would rely on application
scoping plus views), partial indexes, and `SKIP LOCKED` (available in MySQL 8).

## Failure, scaling, security and operational implications

- **Failure:** RDS Multi-AZ for failover; readiness checks time-box a `SELECT 1` so a lost
  database removes the task from the load balancer.
- **Scaling:** read replicas for catalog-heavy reads later; analytics isolated by design.
- **Security:** least-privilege app role, no DDL at runtime, RLS enforced, TLS to RDS.
- **Operational:** migrations run as a separate one-shot task with the owner role before the new
  app version starts; per-database backups and point-in-time restore.
