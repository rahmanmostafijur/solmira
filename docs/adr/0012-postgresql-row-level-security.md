# ADR-0012: PostgreSQL Row Level Security with transaction-local tenant context

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

ADR-0006 chose a shared schema with three layers of tenant enforcement and sketched RLS as the
database layer. Implementing it in identity-service forced concrete choices ADR-0006 left open or
got slightly wrong:

- How the tenant reaches PostgreSQL through a connection pool without leaking between requests.
- What a query without tenant context should see.
- How flows that start _before_ a tenant is known (login, refresh, invitation acceptance) work
  without weakening policies.
- Whether to `FORCE` RLS, given that migrations and the access-catalog sync must write freely.
- How to stop a misconfiguration (connecting as a privileged role) from silently disabling RLS,
  because PostgreSQL gives no error when RLS is bypassed.
- Some identity tables are user-scoped, not tenant-scoped.

## Decision

- **Context per transaction.** All data access goes through `inTenantScope(db, { organizationId,
userId }, work)` (`packages/service-kit/src/database/tenant-scope.ts`), which opens a transaction
  and first runs `set_config('app.organization_id', $1, true), set_config('app.user_id', $2, true)`
  with bound parameters. The `true` makes the settings transaction-local. `Database.unscoped` is the
  same call with nulls; there is no path that skips it.
- **Default deny.** Policies use `app_current_organization_id()` / `app_current_user_id()`, which
  return `NULLIF(current_setting(name, true), '')::uuid`. Missing context yields `NULL`, which
  matches no row. (ADR-0006 expected `current_setting` to raise; returning no rows is equally
  closed and avoids errors on legitimately context-free queries.)
- **Policies** (`drizzle/0001_row_level_security.sql`): `organization_members`, `organizations`
  and `invitations` are filtered by the active organization for all commands, with `WITH CHECK` on
  writes. Reads of `organization_members` and `organizations` also admit the caller's own
  memberships (`user_id = app_current_user_id()`) so users can list and switch organizations.
  `permissions`, `roles` and `role_permissions` have SELECT-only policies, making the catalog
  read-only for the runtime role.
- **Not every table.** `users`, `sessions`, `refresh_tokens`, `email_tokens` and `outbox_events`
  have no RLS: they are user-scoped or system tables accessed before any tenant exists, by secret
  hash or by the token's user id.
- **One SECURITY DEFINER function** `find_invitation_by_token_hash(text)` with a fixed
  `search_path` returns the single invitation matching a token hash; all writes afterwards run
  in that invitation's tenant scope under normal policies.
- **Two roles per database.** `<service>_owner` owns the schema and runs migrations and
  `syncAccessCatalog`. `<service>_app` has DML only and is the only role the running service uses.
- **ENABLE, not FORCE.** RLS is enabled on the tables above but not forced, so the owner keeps
  full access for migrations and backfills. This refines the `FORCE ROW LEVEL SECURITY` detail
  sketched in ADR-0006 (whose overall decision stands); the protection comes from the runtime role never being owner.
- **Readiness guard.** `assertRowLevelSecurityEnforced` refuses readiness if the runtime role is a
  superuser, has `BYPASSRLS` or owns any RLS-enabled table, so a privileged `DATABASE_URL` takes the
  instance out of rotation instead of silently disabling isolation.

Details: [`docs/architecture/tenant-isolation.md`](../architecture/tenant-isolation.md).

## Alternatives considered

- **Session-level `SET app.organization_id`.** Survives the transaction and leaks into the next
  borrower of a pooled connection unless every path resets it. Rejected for `SET LOCAL` semantics.
- **Application filtering only.** One forgotten `WHERE` is a breach. Kept as layer 1, not the only one.
- **`FORCE ROW LEVEL SECURITY` with policies that admit the owner.** Would also constrain the owner,
  but migrations and catalog sync would then need their own context or bypass policies, adding
  complexity to the most privileged path for little gain once the owner is never used at runtime.
- **A `BYPASSRLS` role for context-free flows (login, refresh, invitations).** Simpler code, but a
  role that ignores all policies would be used by internet-facing endpoints. Rejected for tables
  without RLS where appropriate plus one narrow definer function.
- **A permissive policy for invitations (`token_hash = current_setting('app.token_hash')`).** Works,
  but spreads a special case into the generic policy. The definer function keeps it in one place.
- **Views per tenant or schema per tenant.** See ADR-0006.

## Tradeoffs

- Every transaction pays one extra round trip for `set_config`.
- Policies with subqueries (`organizations_select` uses `EXISTS` over `organization_members`) add
  cost that must be verified with `EXPLAIN` on hot paths.
- Tables without RLS rely on application discipline alone; the set is small and documented.
- Not forcing RLS means correctness depends on role separation, which is therefore checked at
  runtime rather than assumed.

## Consequences

**Positive**

- A query that forgets the tenant filter returns only the caller's rows; a query with no context
  returns none.
- Pooled connections cannot carry one tenant's context into another request.
- The runtime role cannot change the permission catalog even if application code tried.
- A misconfigured deployment fails readiness instead of running without isolation.

**Negative**

- Every service must use the scoped database helper and the two-role setup; this is now a platform
  convention enforced by review and tests.
- Debugging as the runtime role requires setting context; as the owner, results are unfiltered.

## Failure, scaling, security and operational implications

- **Failure:** missing context → no rows (reads) or `42501` / zero rows affected (writes); never all
  rows. Privileged runtime role → `/health/ready` is `503`.
- **Scaling:** transaction-local settings work with PgBouncer transaction pooling; tenant-leading
  indexes keep policy predicates cheap; a large tenant can later move to its own database with a
  filtered copy.
- **Security:** proven by 12 database-level tests as the runtime role (default deny, cross-tenant
  read/update/delete/insert/move, catalog tampering, pooled-connection leak, definer lookup) and 14
  HTTP-level cross-tenant tests.
- **Operational:** migrations run as the owner via `MIGRATION_DATABASE_URL` as a separate deploy step;
  the service uses `DATABASE_URL` with the app role. Background jobs must set scope explicitly from
  the event's `organizationId`; cross-tenant system jobs and support tooling need their own role and
  an audited path, to be decided in their phases.
