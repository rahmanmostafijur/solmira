# ADR-0006: Multi-tenancy with a shared schema and layered enforcement

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Solmira is multi-tenant: each organization has its own products, warehouses, inventory, orders
and members. A user may belong to several organizations. The top risk in the roadmap is a
**cross-tenant data leak through a missed `WHERE organization_id`**, rated critical. The design
must make one forgotten filter survivable, and must not let a caller reference another tenant's
row by guessing or harvesting a UUID (IDOR).

## Decision

**Shared database, shared schema, `organization_id` on every tenant-owned row**, enforced in
three independent layers.

1. **Application: token-derived tenant.** The access token carries the active `org` claim.
   `PermissionGuard` checks membership and permission for that org; the tenant ID is placed in
   request context. It is never read from the body, query string or a path segment, so
   `POST /orders { organizationId: <other> }` has no effect. Repositories take `organizationId`
   as a required argument and every query filters on it.
2. **Schema: composite foreign keys.** Tenant tables have a unique `(organization_id, id)` and
   references include the tenant: `order_items (organization_id, variant_id) ->
product_variants (organization_id, id)`, `inventory (organization_id, warehouse_id) ->
warehouses (organization_id, id)`. An order line in org A pointing at a variant UUID from org B
   fails with a foreign-key violation even if the application forgot to check.
3. **Database: Row Level Security.** Each tenant table has
   `USING (organization_id = current_setting('app.organization_id')::uuid)` and a matching
   `WITH CHECK`, with `FORCE ROW LEVEL SECURITY`. The unit of work opens a transaction and runs
   `SET LOCAL app.organization_id = $1` first. The app connects as a non-owner role (ADR-0005),
   so policies apply. `SET LOCAL` is scoped to the transaction and discarded on commit/rollback,
   so a pooled connection can never carry tenant A's setting into tenant B's request. If the
   setting is missing, `current_setting` errors and the query fails closed.

**404, not 403.** `GET /orders/<id>` for an order in another org returns `404 NOT_FOUND`,
identical to a non-existent ID, so the API does not confirm the entity exists. 403 is reserved for
"exists in your org but your role lacks the permission".

System roles are rows with `organization_id IS NULL` in identity; RLS policies there allow
`organization_id IS NULL OR organization_id = current_setting(...)` for reads only.

## Alternatives considered

- **Schema per tenant.** Stronger isolation and easy per-tenant export, but every migration runs
  N times, the catalog bloats with thousands of schemas, connection pools need `search_path`
  switching, and cross-tenant operational queries become unions. Reserved for a future
  regulated-tenant tier.
- **Database per tenant.** Strongest isolation and per-tenant restore, highest cost: per-tenant
  pools, backups, monitoring and migration orchestration. Offered only as an enterprise option.
- **Shared schema without RLS (application filtering only).** One missed filter is a breach.
  Rejected as the sole control; it remains layer 1.

## Tradeoffs

- Logical, not physical, isolation: a noisy tenant shares I/O with everyone.
- Every tenant table index should lead with `organization_id`, making indexes slightly larger.
- RLS adds a predicate to every plan; negligible with tenant-leading indexes, but must be
  verified with `EXPLAIN`.
- Background jobs (outbox relay, rollups) must either set the tenant per batch or run as a
  dedicated role with an explicit, audited `BYPASSRLS` scope.

## Consequences

**Positive**

- A single forgotten `WHERE` returns zero foreign rows instead of leaking them.
- IDOR by guessed UUID fails at the schema level for writes and at RLS for reads.
- One migration path, one pool per service, cheapest to operate.

**Negative**

- Tests must prove isolation per endpoint: phase 2 and phase 11 add cross-tenant tests that
  create data in org A and assert 404 from org B for every route.
- Composite keys make some joins and ORM definitions more verbose.

## Failure, scaling, security and operational implications

- **Failure:** missing tenant context fails closed (error), never open (all rows).
- **Scaling:** a very large tenant can later be moved to its own database; `organization_id`
  on every row makes that a filtered copy.
- **Security:** tenant switching requires a new access token for the target org, issued only after
  identity-service re-checks membership, so a removed member cannot mint a token for that org.
- **Operational:** support tooling queries through the same RLS path with an explicit tenant, and
  every such access is written to the audit log.
