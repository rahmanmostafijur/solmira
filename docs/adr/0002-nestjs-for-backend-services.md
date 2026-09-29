# ADR-0002: NestJS for backend services

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Five backend services must implement the same cross-cutting behaviour identically: zod-validated
config that fails fast, request context via AsyncLocalStorage (`requestId`, `correlationId`),
local JWT verification, permission checks for the tenant resolved from the token, the
`{ error: { code, message, details?, requestId } }` envelope, `/health/live` and `/health/ready`,
and a tenant-scoped unit of work that runs `SET LOCAL app.organization_id` before any query.

operations-service is also a modular monolith (ADR-0004): `catalog`, `inventory`, `purchasing`,
`orders` and `fulfillment` must live in one process and one database while being prevented from
reaching into each other's tables. The framework therefore needs a first-class notion of module
boundaries, not just routing.

Everything is TypeScript 6 strict and ESM. NestJS 12 is ESM-only.

## Decision

Use **NestJS 12** on the Express adapter (`@nestjs/platform-express`) for all five services, with
the shared platform packaged once in `packages/service-kit` as a dynamic module. Express is chosen
over Fastify for ecosystem breadth (helmet, Socket.IO adapter, multer); raw HTTP throughput is not
the bottleneck for these services, the database is.

- **Dependency injection** wires repositories, the unit of work and clients; tests swap them via
  `Test.createTestingModule().overrideProvider()` without monkey-patching imports.
- **Modules as domain boundaries.** `InventoryModule` exports `InventoryReservationService`
  and nothing else; `OrdersModule` imports that service to confirm an order but never touches
  the `inventory` table directly. A module that is not exported cannot be injected, so a boundary
  violation is a startup error, not a code-review catch.
- **Guards** implement authentication (`JwtAuthGuard`) and authorization
  (`@RequirePermission('orders:confirm')` + `PermissionGuard`) declaratively per route.
- **Pipes** run zod schemas from `packages/contracts` on body/query/params, so validation uses
  the exact same schema as the web client.
- **Exception filters** map domain errors (`InsufficientStockError`, `InvalidTransitionError`,
  cross-tenant `NotFound`) to the error envelope, and turn anything unknown into
  `500 INTERNAL_ERROR` without leaking stack traces or driver messages.
- **Interceptors** handle logging, timing and (later) OpenTelemetry spans.
- Build with `tsc` (or SWC with decorator metadata enabled) for production and tests; Vitest uses
  the SWC plugin.

## Alternatives considered

- **Bare Express or Fastify.** Minimal and fast, but every service would hand-roll DI, guard
  ordering, validation and error mapping. Five hand-rolled copies drift; the one that forgets the
  tenant guard is a cross-tenant leak. Fastify's plugin encapsulation helps but offers no
  injectable module graph for the operations-service monolith.
- **Hono / Elysia-style minimal frameworks.** Excellent ergonomics and edge-friendly, but the
  same missing structure as bare Fastify plus a thinner ecosystem for AMQP, Socket.IO gateways
  (phase 8) and GraphQL (phase 9).
- **Non-Node stacks (Spring Boot, .NET, Go).** Mature for this domain, but would split the
  language between web and backend and lose shared zod contracts (ADR-0001).

## Tradeoffs

- **Decorator metadata needs a compiler that emits it.** DI resolves constructor parameters via
  `emitDecoratorMetadata`. esbuild-based runners such as `tsx` do not emit `design:paramtypes`,
  so a service run with `tsx` starts and then fails with unresolved providers. Dev and test
  must use `tsc --watch`, `nest start` or SWC with `decoratorMetadata: true`.
- **ESM-only ecosystem lag.** Some Nest ecosystem packages and older CommonJS libraries do not
  yet load cleanly under NestJS 12. Mitigation (ROADMAP risk): pin versions, prefer thin libs
  (pino, ioredis, amqplib, drizzle), and verify each new dependency builds under ESM before use.
- Framework conventions add indirection; a newcomer must learn modules/providers/guards first.

## Consequences

**Positive**

- Cross-cutting rules live once in `service-kit`; a new service gets auth, tenancy, logging and
  health by importing one module.
- Module boundaries in operations-service are enforced by the container, making later
  extraction (ADR-0004) a mechanical move.
- Unit tests override providers; integration tests boot the real module against Testcontainers.

**Negative**

- Startup is slower than a bare server (reflection, module graph); acceptable for long-lived
  Fargate tasks.
- Decorator-heavy code hides control flow; exception filters and guard order must be documented.

## Failure, scaling, security and operational implications

- **Failure:** misconfigured DI fails at boot, before readiness goes green, so a bad deploy never
  receives traffic.
- **Scaling:** services are stateless; horizontal scaling behind the ALB. Framework overhead is
  negligible next to database round-trips.
- **Security:** guards are applied globally with explicit `@Public()` opt-out, so a new route is
  authenticated by default (fail closed).
- **Operational:** one bootstrap means identical log shape, health endpoints and shutdown hooks
  (drain HTTP, close AMQP channels, end the pg pool) across all services.
