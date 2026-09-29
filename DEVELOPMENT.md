# Development Guide

## Prerequisites

| Tool    | Version                            | Notes                                                     |
| ------- | ---------------------------------- | --------------------------------------------------------- |
| Node.js | 24 (see `.nvmrc`)                  |                                                           |
| pnpm    | 10.x                               | `npm i -g pnpm@10` if `corepack enable` lacks permissions |
| Docker  | Desktop or Engine with Compose v2+ | ~3 GB free RAM for the infra containers                   |

## First run

```bash
pnpm install
pnpm infra:up
```

Then create each service's `.env` from its example (values already match the compose defaults):

```bash
for s in identity operations notification analytics audit; do
  cp apps/$s-service/.env.example apps/$s-service/.env
done
cp apps/web/.env.example apps/web/.env
```

```bash
pnpm dev
```

`pnpm dev` builds the shared packages, then runs every service in watch mode (`tsc --watch` plus
`node --watch`) and `next dev` for the web app.

## Local endpoints

| What                               | URL                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Console (through the gateway)      | http://localhost:8080                                                                    |
| Gateway liveness                   | http://localhost:8080/gateway/health                                                     |
| Service readiness                  | http://localhost:8080/internal/health/{identity,operations,notification,analytics,audit} |
| API docs (Swagger, non-production) | http://localhost:8080/internal/docs/{service}/                                           |
| RabbitMQ management                | http://localhost:15672 (solmira / solmira_dev_password)                                  |
| PostgreSQL                         | `localhost:5433` (superuser `solmira`)                                                   |
| Redis                              | `localhost:6379`                                                                         |

Services listen on 4001–4005 and the web app on 3000. Always go through the gateway on 8080, which
is the only origin the browser uses (no CORS).

PostgreSQL is published on **5433**, not 5432, so it does not collide with a locally installed
PostgreSQL. If `localhost:5432` answers with an authentication error, you are talking to that one.

## Databases and roles

The Postgres init script (`infra/docker/postgres/init/`) creates one database per service
(`solmira_<service>`) with two roles:

- `<service>_owner`: owns the schema and runs migrations
- `<service>_app`: the runtime role, with DML only, so row-level security applies to it

The script runs only on an empty volume. To re-run it: `docker compose down -v && pnpm infra:up`
(this deletes local data).

## Everyday commands

```bash
pnpm lint            # ESLint across the workspace
pnpm typecheck       # tsc --noEmit everywhere (next typegen for web)
pnpm test            # unit tests (no Docker needed)
pnpm build           # production builds
pnpm format          # Prettier

pnpm --filter @solmira/service-kit test:integration   # needs pnpm infra:up
```

Run one package: `pnpm --filter @solmira/identity-service dev`.

## Running the whole stack in containers

```bash
docker compose -f docker-compose.yml -f docker-compose.apps.yml up -d --build
```

This builds the production images (multi-stage, non-root, `tini` as PID 1) and points the gateway
at the containers instead of the host.

## Conventions

- **ESM everywhere.** Relative imports in services and packages end in `.js`.
- **Nest injection** uses explicit `@Inject(Class)` in constructors. It keeps DI independent of emitted
  type metadata and satisfies the `consistent-type-imports` lint rule.
- **Config** is a zod schema per service (`src/config.ts`), validated once at startup. The service
  refuses to start with a readable list of invalid variables.
- **Errors**: throw `AppError` subclasses (`NotFoundError`, `ConflictError`, ...) for client-facing
  failures. Anything else is logged in full and returned as a generic 500.
- **Validation**: `@Body(new ZodValidationPipe(schema))`. Unknown keys are stripped.
- **Commits** follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

## Troubleshooting

| Symptom                                                | Cause / fix                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Gateway returns `SERVICE_UNAVAILABLE` JSON             | The target service is not running on the host. Start it with `pnpm dev`.                           |
| `password authentication failed for user "solmira"`    | A native PostgreSQL owns port 5432; use 5433 (the default in `.env.example`).                      |
| Service exits with `Invalid environment configuration` | Missing `.env`; copy it from `.env.example`.                                                       |
| Readiness shows `rabbitmq: error` right after start    | The connection is established in the background; it recovers within seconds.                       |
| Nest "can't resolve dependencies" in a new service     | Check that `@nestjs/platform-express` is a dependency, so pnpm resolves one shared `@nestjs/core`. |
