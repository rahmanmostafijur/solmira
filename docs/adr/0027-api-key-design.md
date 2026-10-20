# ADR-0027: API key design and lookup

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Tenant backends authenticate ingestion calls with an API key (Phase 5). Keys must be stored so
that a database leak does not reveal them, shown once, scoped, revocable, and tracked for last
use. Authentication happens before the tenant is known, but every tenant table is protected by
Row Level Security, which hides rows until a tenant is set.

## Decision

- **Format.** `slm_` followed by 32 random bytes, base64url encoded. The first 12 characters are
  stored as a display prefix so a key can be recognized in the console.
- **At rest.** Only the SHA-256 digest is stored. Keys are random with 256 bits of entropy, so a
  fast hash is sufficient and a slow password hash would only add latency to every request.
- **Scopes.** `messages:write` and `messages:read`, validated against a fixed list.
- **Lifecycle.** Revocation sets `revoked_at` and takes effect on the next request. An optional
  `expires_at` is honored.
- **Lookup.** A `SECURITY DEFINER` function, `authenticate_api_key(digest)`, owned by the schema
  owner and executable by the runtime role, returns the organization, application, scopes and key
  id for an active key, and records `last_used_at` (at most once a minute per key). It is the
  only place that reads `api_keys` without a tenant; it has a fixed `search_path` and returns
  nothing for revoked, expired or archived-application keys.
- **Guard.** The HTTP guard for API keys is built in Phase 5 with ingestion; Phase 4 provides the
  keys, the lookup and its tests.

## Alternatives considered

- **Keys in identity-service.** Rejected in ADR-0024.
- **Disable RLS on `api_keys`.** Rejected: it weakens the tenant boundary for the sake of one
  lookup. A narrow definer function is auditable.
- **Cache keys in Redis.** Deferred: revocation latency would become a security property.

## Consequences

The definer function is part of the security surface and has its own tests (wrong key, revoked,
expired, archived application, cross-tenant).

## Failure, scaling, security and operational implications

Digest comparison happens in the database through an indexed equality lookup. Keys never appear
in logs; the redaction list covers `apiKey` and `key` fields.
