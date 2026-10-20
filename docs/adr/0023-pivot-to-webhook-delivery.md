# ADR-0023: Pivot to a webhook delivery platform

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Solmira was built through Phase 5 as a multi-tenant order, inventory and fulfillment platform
(catalog, inventory ledger, reservations, purchase orders and receiving). That domain overlaps
heavily with another project by the same author, and it exercises distributed-systems problems
(delivery guarantees, isolation under partial failure, untrusted outbound traffic) only
indirectly.

The generic platform built in Phases 1 and 2 is domain independent: the monorepo and shared
`service-kit`, the gateway, identity with refresh-token rotation, RBAC, PostgreSQL Row Level
Security, composite tenant keys and the transactional outbox pattern.

## Decision

Solmira becomes a multi-tenant **webhook delivery platform**: tenants send events to an API and
Solmira delivers them as signed HTTP webhooks (Standard Webhooks) to their customers' endpoints
with retries, isolation, observability and replay.

- Keep Phases 1 and 2 as they are. Remove the Phase 3 to 5 domain code from services, contracts,
  migrations, the web console, tests and docs.
- The removed work stays recoverable at the git tag `v0-distribution` (commit `cf9372f`).
- `operations-service` is renamed `ingest-service`. Its database migrations are reset to a single
  baseline, because nothing was ever deployed and there is no data to preserve.
- The S3/MinIO client written for product images is deleted rather than kept without a consumer.
  It is recoverable from the tag (supersedes ADR-0014).
- ADRs for the removed domain are marked Superseded, not deleted.
- The new roadmap is in [`docs/ROADMAP.md`](../ROADMAP.md). The outbox relay and idempotent
  consumer infrastructure, which the earlier plan scheduled late, move into Phase 5 because
  fan-out depends on them.

## Alternatives considered

- **Keep the order domain and add webhooks as a feature.** Rejected: it keeps the overlap that
  motivated the change.
- **Start a new repository.** Rejected: the identity, tenancy, tooling and CI work is reusable and
  is the part worth showing.
- **Keep the old migrations and add a drop migration.** Rejected: it preserves a history that never
  ran anywhere, and keeps unrelated schema in the service.

## Tradeoffs

Deleting working, tested code is a real cost. It is accepted because the tag keeps it, and because
dead domain code would mislead readers and slow every build.

## Consequences

- Local databases created before the pivot must be recreated once (`docker compose down -v`).
- Isolation coverage for the new service is rebuilt table by table as tables are added in Phase 4.
- The permission catalog is reduced to organization, member and role permissions until Phase 4.

## Failure, scaling, security and operational implications

None at runtime: this is a cleanup of code that was never deployed. The identity suites, which
prove tenant isolation, run unchanged.
