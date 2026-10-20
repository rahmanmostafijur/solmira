# ADR-0024: Service boundaries for the webhook platform

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

[ADR-0004](0004-service-boundaries.md) cut services along consistency boundaries for an order
platform. The pivot ([ADR-0023](0023-pivot-to-webhook-delivery.md)) changes what has to be
consistent. The rule itself still holds: data that must change atomically lives in one service and
one database; everything else communicates through events.

A specific question: where do applications and API keys live? An API key belongs to one
application, and every ingestion request is authenticated by looking the key up. Services have
separate databases, so a foreign key between identity and another service is impossible.

## Decision

| Service              | Owns                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| identity-service     | users, sessions, organizations, memberships, roles, permissions, invitations. Unchanged by the pivot.                       |
| ingest-service       | applications, **API keys**, event types, endpoints, signing secrets, messages, deliveries, fan-out, idempotency, the outbox |
| dispatcher (worker)  | sends deliveries, signs, schedules retries, enforces isolation, rate limits and SSRF rules. Introduced in Phase 6.          |
| notification-service | notifies tenants about failing or auto-disabled endpoints                                                                   |
| analytics-service    | success rate, attempts per delivery and latency percentiles per endpoint and application                                    |
| audit-service        | records administrative actions                                                                                              |

Applications and API keys live in ingest-service, and identity-service gains nothing.

## Alternatives considered

- **API keys in identity-service.** Rejected. Ingestion would call identity on every request or
  cache key hashes, so revocation would be eventually consistent and identity would sit on the
  hottest path. A key also references an application that identity does not own.
- **One service for ingestion and dispatch.** Rejected: dispatch is long-running, outbound and
  untrusted; it must scale and fail independently and hold no inbound API surface.
- **A separate service per resource (endpoints, event types, ...).** Rejected: they must change
  together with deliveries and fan-out, which would turn fan-out into a distributed transaction.

## Tradeoffs

ingest-service grows into a modular monolith (applications, endpoints, ingestion). Module
boundaries inside it are kept explicit so a part can be extracted later.

## Consequences

- Revoking an API key takes effect on the next request without a cross-service call.
- ingest-service needs its own authentication scheme for API keys next to the JWT guard
  (Phase 4 and 5).
- Identity's permission catalog gains the webhook permissions; the catalog stays the single source
  of truth in `@solmira/contracts`.

## Failure, scaling, security and operational implications

Ingestion availability depends on ingest-service and its database only. Tenant isolation inside
ingest-service uses the same three layers as identity: token-derived tenant, composite foreign
keys and RLS.
