# Architecture Decision Records

This directory records the significant architectural decisions behind Solmira. The living
system description is [`ARCHITECTURE.md`](../../ARCHITECTURE.md); the delivery plan is
[`docs/ROADMAP.md`](../ROADMAP.md). ADRs explain _why_ the system has the shape those documents
describe.

## Index

| #    | Title                                                                           | Status   | Date       |
| ---- | ------------------------------------------------------------------------------- | -------- | ---------- |
| 0001 | [Monorepo with pnpm workspaces and Turborepo](0001-monorepo-pnpm-turborepo.md)  | Accepted | 2026-09-29 |
| 0002 | [NestJS for backend services](0002-nestjs-for-backend-services.md)              | Accepted | 2026-09-29 |
| 0003 | [Next.js for the web console](0003-nextjs-for-web.md)                           | Accepted | 2026-09-29 |
| 0004 | [Service boundaries along consistency boundaries](0004-service-boundaries.md)   | Accepted | 2026-09-29 |
| 0005 | [PostgreSQL, one database per service](0005-postgresql-database-per-service.md) | Accepted | 2026-09-29 |
| 0006 | [Multi-tenancy with a shared schema](0006-multi-tenancy-shared-schema.md)       | Accepted | 2026-09-29 |
| 0007 | [Nginx as the edge gateway](0007-nginx-gateway.md)                              | Accepted | 2026-09-29 |
| 0008 | [Drizzle ORM and SQL migrations](0008-drizzle-orm.md)                           | Accepted | 2026-09-29 |
| 0009 | [RabbitMQ for integration events](0009-rabbitmq-for-integration-events.md)      | Accepted | 2026-09-29 |

## Process

Solmira uses lightweight, Nygard-style ADRs: each record is a short markdown file named
`NNNN-kebab-title.md` with a status, a date, the context that forced a decision, the decision
itself, the alternatives that were rejected and why, and the consequences the team accepts.
A new ADR starts as `Proposed`, is discussed in the pull request that introduces it, and becomes
`Accepted` when merged. Accepted ADRs are immutable: if a decision changes, a new ADR is written
that references the old one, and the old record's status is changed to `Superseded by ADR-NNNN`
(the only edit ever made to it). Typos and broken links may be fixed; reasoning is never
rewritten after the fact, so the log stays an honest history of what was known when each
decision was made. Decisions that are planned for later phases (for example DynamoDB event
history in phase 10 and the AWS topology in phase 12) get their own ADRs when those phases start.

## Template

```markdown
# ADR-NNNN: <Title>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD

## Context

## Decision

## Alternatives considered

## Tradeoffs

## Consequences

## Failure, scaling, security and operational implications
```
