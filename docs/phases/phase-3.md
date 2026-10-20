# Phase 3: Pivot and cleanup

Branch `phase-3/pivot-cleanup`, merged into `pivot/webhook-platform`.

## What changed

- The order, inventory and purchasing domain is removed from services, contracts, migrations, the
  console, tests and docs. It is recoverable at the tag `v0-distribution` (commit `cf9372f`).
- `operations-service` is now `ingest-service` (package, database `solmira_ingest`, roles,
  compose services, gateway upstream, CI jobs). Its migrations restart from a baseline: the
  `outbox_events` table and the `app_current_organization_id()` function.
- Generic pieces moved to the platform layer: the `Idempotency-Key` contract
  (`@solmira/contracts`), and constraint-violation, LIKE-escaping, paging and UUID-param helpers
  (`@solmira/service-kit`).
- The permission catalog shrank to organization, member, role, analytics and audit permissions.
- The identity permission sync already pruned removed permissions and their role assignments
  (`ON DELETE CASCADE`); an integration test now proves it.
- MinIO and the S3 client are gone from compose, CI and code.
- `knip` runs in CI and the unused code and dependencies it found were removed.
- Docs rewritten: README, ARCHITECTURE, DEVELOPMENT, SECURITY (threat model), ROADMAP (acceptance
  criteria for every phase), a new API reference, ADR-0023 and ADR-0024; ADRs 0004 and 0013 to 0022
  are marked Superseded.

## Why

Phases 3 to 5 of the earlier plan built a domain that overlaps with another project. See ADR-0023.

## Decisions

- Applications and API keys live in ingest-service, not identity-service (ADR-0024): revocation
  needs no cross-service call and a key can reference its application.
- Baseline reset instead of a drop migration (ADR-0023): nothing was ever deployed.
- Web components that only the removed console used (data table, dialog, tabs, list params) were
  deleted rather than kept unused; restore them from the tag when the webhook console needs them.
- Role permissions: STAFF and VIEWER currently hold the same read permissions until the webhook
  resource permissions are added in Phase 4.
- The `dispatcher` worker is not scaffolded yet; it is created in Phase 6.

## Tests added or changed

- `apps/identity-service/test/access-catalog.integration.test.ts` (2 tests): pruning of removed
  permissions and their assignments; catalog and role assignments stay complete.
- `apps/ingest-service/test/readiness.integration.test.ts` (4 tests): readiness against real
  PostgreSQL, Redis and RabbitMQ, the runtime role is subject to RLS, a missing tenant context
  matches nothing, the outbox is not owned by the runtime role.
- `packages/contracts/src/idempotency.test.ts`, moved with the code it covers.
- Removed with their code: the catalog, inventory, purchasing, image and isolation suites of the
  old service. No identity test was removed or loosened.

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip
pnpm turbo run lint typecheck test build
pnpm infra:up
pnpm --filter @solmira/identity-service test:integration
pnpm --filter @solmira/ingest-service test:integration
git grep -i -w -E "products?|skus?|warehouses?|inventory|suppliers?|purchase orders?" -- . ':!docs/adr' ':!docs/ROADMAP.md' ':!pnpm-lock.yaml'   # no output
```

Results on the final commit of this phase, run locally: lint, typecheck, unit tests and build pass
for all 32 turbo tasks; identity integration 68 tests pass; ingest integration 4 tests pass; service-kit integration 4 tests pass;
`knip` and `format:check` pass; the grep above prints nothing; on empty volumes both migrations
apply and the five services report ready through the gateway; the ingest-service Docker image
builds. The full CI run (including the other four images) executes on the pull request.

## Known limitations

- Local databases created before the pivot must be recreated (`docker compose down -v`).
- Cross-tenant tests for the new service arrive with its first tenant tables in Phase 4.
- `knip` prints configuration hints about entry patterns that match no files in the skeleton
  services; they are harmless and disappear as those services gain code.
