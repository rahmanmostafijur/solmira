# ADR-0001: Monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Solmira ships one Next.js app (`apps/web`) and five NestJS services (`identity`, `operations`,
`notification`, `analytics`, `audit`). They share two libraries:

- `packages/contracts`: zod schemas and inferred types for HTTP request/response bodies, the
  integration event envelope, every `(type, version)` event payload, and the permission catalog.
- `packages/service-kit`: the NestJS platform module (config validation, pino logging, request
  context, error envelope, health checks, Postgres/Redis/RabbitMQ clients, bootstrap).

The main driver is `contracts`. When `order.confirmed` gains a field, the producer
(operations-service), three consumers (notification, analytics, audit) and the web console's
order form all have to agree on the new schema. In a polyrepo that is a publish to a private
registry, five version bumps and a window where half the fleet validates against the old schema.
In one repo it is one pull request, and `tsc` fails every consumer that does not handle the change.

Secondary drivers: one CI pipeline, one lint/format/TypeScript 6 config, and a single place for
a reviewer (or interviewer) to read the whole system.

## Decision

- **pnpm workspaces** for package management. Internal packages are referenced with
  `workspace:*`; the strict, symlinked `node_modules` layout means a service cannot import a
  dependency it did not declare (no phantom dependencies leaking from hoisting).
- **Turborepo** for the task graph: `build`, `typecheck`, `lint`, `test` declare `dependsOn:
["^build"]`, so `contracts` and `service-kit` build before any app. Outputs are content-hashed
  and cached locally and in CI; `turbo run test --filter=...[origin/main]` runs only affected
  packages on pull requests.
- Each app keeps its own `package.json` and Dockerfile, so it can still be built and deployed
  independently. The monorepo is a source-control and build decision, not a deployment one.

## Alternatives considered

- **Nx.** Stronger features (generators, module-boundary lint rules, distributed task
  execution). Rejected because its plugin layer wraps the underlying tools (Next.js, Vitest,
  NestJS CLI) and adds configuration that must track their versions. With NestJS 12 being
  ESM-only, an extra abstraction that lags upstream is a liability. Module boundaries are
  enforced instead with ESLint import rules and package `exports` fields.
- **npm (or Yarn classic) workspaces without an orchestrator.** Workspaces alone solve linking
  but not ordering or caching; CI would rebuild all six apps on every change. Hoisting also
  allows phantom dependencies that break only in the per-service Docker build.
- **Polyrepo with a published `@solmira/contracts` package.** Gives hard ownership boundaries,
  but every contract change becomes a coordinated multi-repo release, and schema drift between
  producer and consumer is caught in production instead of by the compiler. The team size
  (one or a few engineers) gets none of the organizational benefit.

## Tradeoffs

- Gain atomic cross-service changes and compile-time contract checking; give up the forced
  discipline of versioned contracts. Mitigation: event payloads carry an explicit `version`, and
  consumers must accept version N and N-1 so services can still deploy one at a time.
- A shared lockfile means one dependency upgrade can touch every service at once.
- Turborepo caching is only correct if task inputs are declared correctly; a missing
  `inputs`/`env` entry produces a stale cache hit.

## Consequences

**Positive**

- A breaking change to a zod schema fails `typecheck` in every affected app in the same PR.
- CI time scales with the size of the change, not the size of the repo.
- One place to enforce TypeScript strictness, ESLint flat config, Prettier and Vitest setup.

**Negative**

- Docker builds need `pnpm deploy` / `turbo prune` to produce a minimal per-service context;
  naive `COPY . .` builds bust the layer cache on any change anywhere.
- Contributors must understand workspace filters and the task graph.
- Everything is visible to everything; boundaries rely on lint rules, not repository access.

## Failure, scaling, security and operational implications

- **Failure:** a broken `contracts` build blocks all apps; this is intended (fail before deploy).
- **Scaling:** remote caching (Turborepo remote cache or CI cache) is the lever if CI slows;
  splitting into polyrepos is reserved for when separate teams own separate services.
- **Security:** one lockfile gives one dependency audit surface (`pnpm audit`, Dependabot);
  pnpm's strict layout prevents code from relying on undeclared transitive packages.
- **Operational:** deployments remain per service; a merge that touches only
  `notification-service` builds and ships only that image.
