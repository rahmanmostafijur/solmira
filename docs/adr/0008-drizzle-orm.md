# ADR-0008: Drizzle ORM and drizzle-kit SQL migrations

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The most important queries in Solmira are not CRUD; they are concurrency-sensitive SQL:

- **Order confirmation:** `SELECT ... FROM orders WHERE ... FOR UPDATE` to lock the order, then
  per line, in sorted inventory-key order to avoid deadlocks,
  `UPDATE inventory SET reserved = reserved + $q WHERE organization_id = $1 AND warehouse_id = $2
AND variant_id = $3 AND on_hand - reserved >= $q`, where zero affected rows means insufficient
  stock and rolls the transaction back. Two buyers racing for the last unit serialize on the row
  lock; the second re-evaluates the guard and matches zero rows.
- **Outbox relay:** `SELECT ... FROM outbox_events WHERE sent_at IS NULL ORDER BY id LIMIT $n
FOR UPDATE SKIP LOCKED` so relay replicas never claim the same batch.
- **Partial PO receiving:** guarded `UPDATE purchase_order_items SET received_quantity =
received_quantity + $q WHERE ... AND received_quantity + $q <= ordered_quantity`.
- Every transaction starts with `SET LOCAL app.organization_id` for RLS (ADR-0006).

The data layer must make these exact statements easy to write and read, expose affected-row
counts, run inside explicit transactions, work under ESM with NestJS 12, and produce migrations
a reviewer can read as SQL (including RLS policies, composite foreign keys, generated columns and
`CHECK` constraints).

## Decision

Use **Drizzle ORM** with the `node-postgres` driver, and **drizzle-kit** to generate SQL
migration files that are committed and reviewed.

- Schemas are TypeScript table definitions per service (`src/db/schema/*.ts`), giving inferred
  row types without a separate generator step.
- Queries use the typed builder for ordinary reads/writes and `sql` template fragments
  (parameterized, never string-concatenated) for guards and locking clauses; `.for('update',
{ skipLocked: true })` covers row locks.
- Migrations: `drizzle-kit generate` emits `NNNN_name.sql`; hand-written SQL is appended for what
  generators do not model (RLS policies, `FORCE ROW LEVEL SECURITY`, grants to the app role).
  Migrations run with the owner role only (ADR-0005).
- Repositories receive a transaction handle from the tenant unit of work; no global client
  is used for tenant data.

## Alternatives considered

- **Prisma.** Excellent DX and schema language, but row locking (`FOR UPDATE`, `SKIP LOCKED`) and
  guarded conditional updates require `$queryRaw`, which drops type safety on exactly the queries
  that matter. The query engine is a heavier runtime layer, interactive transactions have
  timeouts and pooling quirks, and running `SET LOCAL` reliably on the same connection as the
  following queries needs care. Its migration SQL is readable, but RLS and grants are still
  manual.
- **TypeORM.** Decorator entities fit NestJS stylistically, but the active-record/unit-of-work
  abstraction hides the SQL we most need to see, its ESM support has historically been rough,
  and auto-generated migrations are harder to review.
- **Raw `pg` or Kysely.** Maximum control, and Kysely is type-safe. Rejected narrowly: raw `pg`
  gives no type inference, and Kysely needs a separate migration story and schema-to-type
  generation. Drizzle offers similar SQL closeness plus schema-defined types and migration
  generation in one tool.

## Tradeoffs

- Drizzle is younger than Prisma or TypeORM; APIs still move between minor versions. Versions
  are pinned and upgrades are deliberate.
- Generated migrations must be reviewed; drizzle-kit may propose a drop-and-recreate for a rename.
- Developers need real SQL skill; the ORM does not shield anyone from locking semantics.

## Consequences

**Positive**

- The oversell guard and SKIP LOCKED claim read almost exactly like the SQL in the architecture
  doc, which makes review and interview explanation straightforward.
- Thin runtime: no engine binary, fast cold start in containers, clean ESM imports.
- Migrations are plain SQL files, diffable and runnable by any PostgreSQL tool in an incident.

**Negative**

- Fewer batteries (no built-in soft deletes, no relation-level cascades in the ORM); written
  where needed.
- Mixing builder and `sql` fragments requires conventions so raw fragments stay parameterized.

## Failure, scaling, security and operational implications

- **Failure:** constraint violations (`CHECK`, unique, composite FK) are mapped to domain errors
  by the exception filter; unexpected driver errors become `500 INTERNAL_ERROR` with no driver
  message leaked.
- **Scaling:** explicit SQL makes `EXPLAIN` evidence (phase 9) straightforward; no hidden N+1
  from lazy relations.
- **Security:** all values are bound parameters; lint forbids `sql.raw` with interpolated input.
- **Operational:** migrations run as a one-shot task before rollout, are forward-only, and
  destructive changes use expand/contract across two releases.
