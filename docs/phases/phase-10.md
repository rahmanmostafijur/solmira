# Phase 10: Audit and receiver verification library

Branch `phase-10/audit-verification`, merged into `pivot/webhook-platform`.

## What changed

- **Audit trail** (audit-service, no longer a skeleton; ADR-0036): consumes the administrative events the
  services already write to their outboxes, stores one record per event (actor, action, target, time,
  details) under Row Level Security, and serves `GET /audit-logs` with filters behind `audit_logs.read`.
  The database refuses updates, and deletes by the runtime role; only a bounded retention function removes
  old records.
- **One exhaustive audit policy** in `@solmira/contracts`: every event type is audited (with the payload
  field that names its target) or excluded with a reason, enforced by the type system. Audit tests require a
  sample for every audited type.
- **A gap closed**: revoking an invitation left no event; identity now records `invitation.revoked` in the
  same transaction (with a test).
- **Console**: Settings > Audit log (action filter, pagination, details), shown with `audit_logs.read`.
- **Receiver verification library** (`@solmira/webhooks`): a README that is the receiver's guide, a
  high-level `parseWebhook`, examples for `node:http` and for `Request` handlers (Next.js, Hono, Workers)
  with an Express snippet, a signing example, and tests for the examples. `SignedHeaders` became a type
  alias so signed headers can be passed straight to `verifyWebhook`.
- Deployment: an audit migration step in the compose overlay, the audit suite in CI, and the browser test
  starts audit-service too.

## Decisions

See ADR-0036: events as the source of records, a compile-time exhaustive policy, append-only enforced by
role in the database, refusal instead of guessing when an audited event cannot be attributed.

## Tests added

- audit-service: every audited type maps to a record with the right target (replay by message or by
  endpoint, system actor), excluded types leave nothing, malformed audited events are refused; integration
  tests record every audited event type end to end, once per event, filter by action, actor, target and
  time, keep tenants apart (API and database role), require the permission, refuse update, delete and
  truncate by the runtime role, and purge only old records.
- identity: the invitation revocation event, once, with the organization and the actor.
- `@solmira/webhooks`: the reference vector, the cases of the reference libraries (empty and invalid
  secrets, missing and malformed headers, partial signatures, tolerance edges, several signatures, rotation,
  header case, multi-byte and empty bodies) with signatures computed independently, `parseWebhook`, and
  both examples against real HTTP and `Request` objects.
- web: audit formatting and navigation; the browser test checks the actions it performs appear in the log.

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip && pnpm turbo run lint typecheck test build
pnpm infra:up
for s in service-kit identity-service ingest-service dispatcher notification-service analytics-service audit-service; do
  pnpm --filter @solmira/$s test:integration; done
pnpm --filter @solmira/web test:e2e
```

## Known limitations

- Audit records show actor ids, not names; names live in identity-service.
- No tamper evidence beyond the database permissions; an object-locked export is planned with the AWS work
  (Phase 12).
- The library is a workspace package (`private`), not published to a registry.
