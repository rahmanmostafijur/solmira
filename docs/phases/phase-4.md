# Phase 4: Applications, API keys, event types, endpoints, signing secrets

Branch `phase-4/webhook-resources`, merged into `pivot/webhook-platform`.

## What changed

- **ingest-service** gains the webhook management API: applications, event types, endpoints (with
  event subscriptions and custom headers) and API keys. Every route is permission-checked and
  scoped to the organization in the token.
- **Database** (migrations 0002 and 0003): `applications`, `event_types`, `endpoints`,
  `endpoint_event_types`, `endpoint_secrets`, `api_keys`. Every table has `organization_id`,
  composite tenant foreign keys and an RLS policy. `authenticate_api_key()` is the single
  tenant-less lookup, a narrow `SECURITY DEFINER` function.
- **Signing secrets** are generated in the Standard Webhooks format, envelope-encrypted (AES-256-GCM,
  a data key per secret wrapped by a key-encryption key), returned once on endpoint creation and
  revealable only through an audited permission.
- **API keys** are shown once and stored as SHA-256 digests; they have scopes, an optional expiry,
  revocation and last-use tracking. The HTTP guard that accepts them arrives with ingestion.
- **Endpoint URL policy** (service-kit): https in production, no credentials, every special-purpose
  IPv4 range, IPv6 limited to global unicast minus documentation, 6to4 and protocol ranges,
  alternative IPv4 spellings, local-only host names, and a DNS check at creation. The dispatcher
  reuses the address policy at send time.
- **Contracts and permissions**: 16 new permissions; secret reveal, API key creation and
  application archiving stay with owners and admins; managers run event types and endpoints.
- **Gateway** routes `/api/v1/applications` and `/api/v1/event-types` to ingest-service.
- ADRs 0025 to 0028 record the decisions. `ZodBody` OpenAPI helper moved to service-kit.

## Decisions

- Event types are shared by all applications of an organization (ADR-0025).
- Resources are archived or revoked, never hard deleted; `DELETE` on an endpoint archives it.
- An empty subscription list means the endpoint receives every event type.
- A development-only flag, `ALLOW_PRIVATE_ENDPOINT_TARGETS`, relaxes the address rules for local
  receivers and chaos tests. The service configuration refuses it in production (tested).
- The local key-encryption key lives in `SECRETS_ENCRYPTION_KEY`; KMS arrives with the AWS phase
  behind the same `SecretCipher` port.

## Dependencies added

- `ajv` 8.20.0 (pinned) in ingest-service: compiles a tenant's JSON Schema at event type creation
  and validates message payloads from Phase 5. Remote references are never fetched.
- `uuid`, `@nestjs/swagger` and `@solmira/contracts` re-added to ingest-service now that it has
  code that uses them.

## Tests added

- Unit: URL and IP policy (hostile-input tables, IPv4-mapped IPv6, NAT64, 6to4, octal, hex and
  decimal IPv4), secret cipher (binding to organization and endpoint, tampering, wrong key), API key
  material, payload schema compilation, configuration, contracts and role permissions.
- Integration against PostgreSQL, Redis and RabbitMQ: CRUD and role checks for every resource;
  secret storage, reveal, audit event and refusal; URL validation through HTTP with fake DNS;
  cross-tenant access over HTTP for every resource; RLS and composite keys at database level per
  table; API key authentication (valid, malformed, revoked, expired, archived application,
  last-used throttling); and a log capture proving no secret, key or custom header value is logged.

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip && pnpm turbo run lint typecheck test build
pnpm infra:up      # a native Postgres on 5433 needs POSTGRES_PORT, see DEVELOPMENT.md
pnpm --filter @solmira/ingest-service test:integration
pnpm --filter @solmira/identity-service test:integration
```

Results, run locally on the final commit of this phase: format, knip, lint, typecheck, unit tests
and build pass for all 32 turbo tasks; integration tests pass: identity 68, ingest-service 73,
service-kit 4. The ingest-service image builds and loads the compiled schema validator. The gateway
renders its template and routes `/api/v1/applications` to ingest-service. The full CI run executes on
the pull request.

## Known limitations

- API keys cannot authenticate HTTP requests yet (Phase 5 adds the guard and rate limits).
- Secret rotation and the dual-signing window are Phase 7; the schema already supports them.
- DNS is checked at creation only as advice; the authoritative check is at send time (Phase 6).
- The reveal audit event sits in the outbox until the relay (Phase 5) and audit-service (Phase 10)
  consume it.
- Custom header values (for example an authorization header) are stored in plaintext in the
  database and returned to members who can read endpoints; they are never logged.
