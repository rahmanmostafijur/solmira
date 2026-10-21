# ADR-0036: Audit trail

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Tenants need to answer "who did this, and when" for everything administrative: members and roles,
applications, API keys, endpoints and their secrets, replays. The record must not depend on a service
remembering to write it, must never cross tenants, and must not be editable by the people it describes.

## Decision

- **Records come from the outbox events the services already write** in the same transaction as the
  change (ADR-0029). An action and its record therefore exist together or not at all, and no service
  calls the audit service. audit-service consumes the events and stores one record per event.
- **One exhaustive policy decides what is audited.** `AUDIT_POLICY` in `@solmira/contracts` is a
  `Record` over every identity and ingest event type: each is either audited, with the payload field
  that names its target, or excluded with a reason (authentication events of a person, and the
  high-volume data plane: `message.created`, `delivery.attempted`). Adding an event type without
  deciding does not compile, and the audit tests require a sample for every audited type.
- **Record shape**: action (the event type), actor (a user id, or the platform for system actions such
  as an automatic disabling), target type and id, time, correlation id, and the event's own payload as
  details. Payloads carry ids and field names, never secrets, keys or URLs, by the contract of those
  events. An audited event without an organization or a target is refused (dead-lettered) rather than
  dropped or guessed: a gap in the trail should be loud.
- **Idempotent and tenant-scoped.** The event id is unique, so a redelivered event adds nothing. Every
  read and write runs in the organization's transaction under Row Level Security, and the query also
  filters by organization. `GET /audit-logs` needs `audit_logs.read` (managers and above) and filters
  by action, actor, target and time.
- **Append-only in the database.** A trigger refuses updates by anyone and deletes and truncation by
  any role but the schema owner, which the runtime role is not. The check is on the role, not a
  setting a caller could change. Old records are removed only by a bounded, `SECURITY DEFINER`
  retention function (400 days by default) that deletes nothing else.
- **Gaps found while building it were closed**: revoking an invitation changed state without an event;
  it now records `invitation.revoked` in the same transaction.

## Alternatives considered

- **Each service writes audit rows itself.** A second write path that can drift from the change and
  needs its own transaction handling; the outbox already gives atomicity.
- **Audit everything the services emit.** Delivery attempts would drown the trail; they have their
  own history and analytics.
- **Tamper evidence by hash chaining.** Valuable against a compromised database administrator, which is
  outside the threat model here; revisit with the AWS hardening (Phase 12: object-locked export).

## Consequences

The trail lags a change by the relay and consumer latency (milliseconds normally, longer if the broker
is down). The actor is an id; names stay in identity-service, so the console shows ids until a lookup
is added.

## Failure, scaling, security and operational implications

A consumer failure retries and then dead-letters, visible to an operator (runbook in Phase 12).
Records are small and indexed by (organization, time), (organization, action), (organization, target)
and (organization, actor). The cross-tenant tests cover the API and the database role without a tenant.
