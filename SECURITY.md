# Security

This document summarises the security controls built so far (through phase 2: identity,
authentication, organizations, RBAC and tenant isolation). Design detail lives in:

- [Authentication](docs/architecture/authentication.md): tokens, sessions, rotation, revocation,
  passwords, lockout, recovery, CSRF, theft analysis
- [Authorization](docs/architecture/authorization.md): permission catalog, roles, guard order,
  membership rules
- [Tenant isolation](docs/architecture/tenant-isolation.md): token-derived tenant, PostgreSQL Row
  Level Security, tests
- ADRs [0006](docs/adr/0006-multi-tenancy-shared-schema.md),
  [0010](docs/adr/0010-authentication-strategy.md),
  [0011](docs/adr/0011-refresh-token-rotation.md),
  [0012](docs/adr/0012-postgresql-row-level-security.md)

## Reporting a vulnerability

Security contact to be defined. Until then, do not open public issues for suspected
vulnerabilities.

## Authentication

- Access tokens: Ed25519-signed JWTs (`EdDSA` pinned), 15 minutes, verified locally by each
  service; only identity-service holds the private key. In the browser they live in memory only.
- Refresh tokens: 256-bit opaque values, stored as SHA-256 hashes, sent only as an `httpOnly`,
  `Secure`, `SameSite=Strict` cookie scoped to `/api/v1/auth`. Rotated on every use; reuse of a
  consumed token revokes the whole session. Sessions end after 7 days idle or 30 days absolute.
- Revocation: Redis session and membership markers checked on every request; the check fails
  closed (`503`) if Redis is unavailable.
- Passwords: 12–128 characters, Argon2id (m=19456 KiB, t=2, p=1), constant-cost verification for
  unknown emails, identical error for unknown email and wrong password.
- Password reset and email verification: single-use, hashed, expiring tokens (30 min / 24 h);
  `forgot-password` always answers `202`; a reset revokes every session.
- CSRF: `SameSite=Strict` refresh cookie plus a required `x-solmira-client` header on
  cookie-authenticated endpoints; no CORS is configured, so cross-site pages cannot send it.

Known tradeoffs (documented in the authentication doc): registration answers `409` for an existing
email; account lockout can be triggered by anyone who knows an email; no MFA yet.

## Authorization

- Permission-based checks (`@RequirePermission`) against a catalog defined once in
  `@solmira/contracts` and synced to the database on deploy; the runtime database role cannot
  modify it.
- One global guard: authentication is required unless a route is explicitly `@Public()`.
- Role ranks govern who can manage whom; no self-changes; an organization always keeps at least one
  active owner; role changes, suspensions and removals invalidate existing tokens immediately.
- The web app's permission-aware UI is convenience only; the API enforces every rule.

## Tenant isolation

- The tenant comes only from the verified token; a route `:organizationId` that differs from it is
  answered with `404`, as is any id from another tenant.
- Every transaction sets the tenant with transaction-local `set_config`, and PostgreSQL RLS
  policies filter tenant tables; no context means no rows.
- Services connect as a non-owner runtime role; readiness fails if that role is a superuser, has
  `BYPASSRLS` or owns RLS tables. Migrations run separately as the owner role.
- Proven by database-level tests as the runtime role and HTTP-level cross-tenant tests.

## Secrets handling

| Aspect         | Development                                                                                              | Deployed environments                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Signing keys   | Generated locally with `pnpm --filter @solmira/identity-service keys:generate` into the service's `.env` | Held in a secret manager (AWS Secrets Manager, phase 12); private key only in identity-service |
| Database roles | `<service>_owner` and `<service>_app` share one dev password (`infra/docker/postgres/init`)              | Per-role credentials in the secret manager                                                     |
| `.env` files   | Git-ignored; only `.env.example` files with placeholder or dev-only values are committed                 | Not used; configuration comes from the environment                                             |

Every service validates its environment with zod at startup and fails fast, reporting the names,
never the values, of invalid variables. identity-service refuses to start without signing keys.

## HTTP security headers

- Services (helmet): `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` for the
  JSON API, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and the other helmet
  defaults. Swagger UI is served only outside production.
- Gateway (Nginx, server level): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `X-Request-Id`.
- The browser talks only to the gateway origin; there is no CORS surface.

## Rate limits

| Layer                 | Scope                                                             | Limit                                                    |
| --------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| Gateway `auth_per_ip` | `/api/v1/auth/(login\|register\|forgot-password\|reset-password)` | 10 requests/min per IP, burst 5, `429`                   |
| Gateway `api_per_ip`  | all other API routes                                              | 30 requests/s per IP, burst 60, `429`                    |
| identity-service      | failed logins per email                                           | 5 per 15-minute fixed window, then `429` + `Retry-After` |
| identity-service      | password reset emails per address                                 | 3 per hour, extra requests silently dropped              |

JSON request bodies are size-limited by the platform bootstrap.

## Logging and redaction

Logs are structured JSON (pino) with `service`, `requestId` and `correlationId`. Redaction happens
inside the logger, so no call site can forget it: `Authorization` and `Cookie` request headers,
`Set-Cookie` response headers, and any `password`, `passwordHash`, `currentPassword`,
`newPassword`, `token`, `accessToken`, `refreshToken`, `secret` and `apiKey` fields are replaced
with `[REDACTED]`. Login and reset throttles key Redis entries by `sha256(email)`, so raw email
addresses are not stored there. Unknown errors are returned as `500 INTERNAL_ERROR` without stack
traces or driver messages.

## Not yet built

MFA, audit-log API and UI (phase 10), security test suite for IDOR and role escalation across all
services (phase 11), production hardening checklist and secret rotation runbooks (phase 12).
