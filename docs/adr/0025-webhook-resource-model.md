# ADR-0025: Webhook resource model and lifecycle

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Phase 4 introduces the resources tenants manage: applications, event types, endpoints and API
keys. Decisions needed: who owns each resource, what "delete" means once messages and deliveries
exist (Phase 5), and what an empty subscription list means.

## Decision

- **Ownership.** Every resource carries `organization_id`. Applications, endpoints and API keys
  belong to an application; event types belong to the organization and are shared by all of its
  applications, so `invoice.paid` is defined once for production and staging.
- **No hard deletes.** Applications, event types and endpoints are _archived_ (`archived_at`); an
  archived resource disappears from default lists, accepts no new messages and cannot be
  subscribed to, but its history stays intact. API keys are _revoked_ (`revoked_at`). `DELETE` on
  an endpoint archives it and is idempotent.
- **Subscriptions.** An endpoint subscribes to a set of event types. An empty set means "all event
  types", because that is the least surprising default for a new endpoint.
- **Names.** Application names are unique per organization among live applications
  (case-insensitive). Event type names are unique per organization including archived ones, so a
  name is never reused for a different meaning. Event type names match
  `^[a-z0-9][a-z0-9_.-]{0,127}$`.
- **Event type schemas.** An optional JSON Schema (draft 2020-12, compiled with Ajv, at most
  64 KiB, no remote references) validates message payloads from Phase 5. A schema that does not
  compile is rejected at creation.
- **Endpoint settings.** `url`, `description`, `enabled`, `rateLimitPerSecond` (1 to 1000 or none)
  and custom headers (at most 10; names that would break the protocol or the signature are
  rejected).
- **Identifiers in paths.** Applications and endpoints are addressed by UUID. A resource outside
  the caller's organization answers 404.

## Alternatives considered

- **Hard delete with cascades.** Rejected: messages and deliveries reference endpoints, and
  history is the product.
- **Event types per application.** Rejected: duplicates definitions across environments.
- **Empty subscription means none.** Rejected: an endpoint that silently receives nothing is a
  worse failure than one that receives everything the tenant sends to that application.

## Consequences

Lists need an `includeArchived` filter. Storage grows with archived rows, which is acceptable.

## Failure, scaling, security and operational implications

Archiving is a single-row update, so it is safe to retry. Custom header values may be sensitive
(for example an authorization header the tenant's customer requires); they are stored in the
database, returned only to members who may read endpoints, and never logged.
