# ADR-0010: Short-lived signed access tokens with server-side refresh sessions

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Five backend services and a Next.js console need to know, on every request, who the caller is and
what they may do in which organization. Constraints:

- identity-service owns credentials (ADR-0004), but other services must not call it on every
  request: that would put it on the critical path of every order and inventory operation.
- A compromised downstream service must not be able to mint credentials.
- Logout, a detected theft, a password reset and a role change must take effect within seconds,
  not at token expiry.
- The console is a browser application, so token storage must survive XSS as well as possible
  and must not open a CSRF hole.
- A user belongs to several organizations and works in one at a time (ADR-0006).

## Decision

Two tokens, with authentication centralised in identity-service and verification decentralised.

- **Access token:** a JWT signed with **Ed25519** (`alg: EdDSA`), 15 minutes by default
  (`ACCESS_TOKEN_TTL_SECONDS`, 60–3600). Claims: `sub`, `sid` (session), optional `org`, `role`,
  `perms` for the active organization, `iat`, `iat_ms`, `exp`, `iss`, `aud`. Every service verifies
  it locally with the public key (`AccessTokenVerifier`, algorithm pinned to EdDSA). Only
  identity-service holds the private key (`AccessTokenIssuer`); the public key is also published as
  JWKS at `/api/v1/auth/.well-known/jwks.json`.
- **Refresh token:** an opaque 256-bit random value, stored server side only as SHA-256, delivered
  only as the `solmira_refresh` cookie (`httpOnly`, `Secure`, `SameSite=Strict`,
  `Path=/api/v1/auth`). It belongs to a **session** with a 7-day idle and 30-day absolute limit, and
  is rotated on every use (ADR-0011).
- **Browser:** the access token lives in JavaScript memory only; a reload restores it through the
  refresh cookie. Cookie-authenticated endpoints additionally require the `x-solmira-client` header.
- **Revocation:** a Redis denylist checked by the global `AuthGuard` on every request. A session
  marker kills all access tokens of a session; a membership marker kills a user's tokens for one
  organization issued before a change (compared with millisecond `iat_ms`). The check fails closed.
- **Organization context:** `org` is set only after identity-service confirms an active membership
  in an active organization. Switching organization issues a new access token after the same check.
- **Passwords:** Argon2id (m=19456 KiB, t=2, p=1), 12–128 characters, dummy verification for
  unknown emails, per-email fixed-window lockout plus a per-IP limit at the gateway.

Details: [`docs/architecture/authentication.md`](../architecture/authentication.md).

## Alternatives considered

- **Server-side sessions only (opaque session id, lookup per request).** Instant revocation and
  simple, but every service would need a session lookup against identity's store on every request,
  coupling all services to identity's availability and database. Rejected for the API; the refresh
  session is exactly this model, used only on the auth path.
- **Long-lived JWT without refresh.** No revocation short of a full denylist of every token.
  Rejected.
- **HS256 (shared secret).** Every verifying service would hold a secret that can also sign.
  One compromised service could mint tokens for any user. Rejected in favour of asymmetric keys.
- **RS256 / ES256.** Both work. Ed25519 has small keys and signatures, fast verification,
  deterministic signatures (no nonce-reuse failure mode) and no parameter choices to get wrong.
- **Access token in `localStorage`.** Survives reloads, but any injected script can exfiltrate it.
  Rejected; memory plus refresh cookie costs one refresh per page load.
- **Access token in a cookie as well.** Would make every API endpoint CSRF-relevant. Rejected; only
  the refresh endpoint is cookie-authenticated, and it has two CSRF defences.
- **External identity provider (Cognito, Auth0, Keycloak).** Viable for production and possibly
  later for SSO, but it hides exactly the mechanisms (rotation, revocation, tenant claims) this
  platform needs to control and test, and adds a paid dependency to local development.
- **Token introspection (RFC 7662) per request.** Same coupling as server-side sessions.

## Tradeoffs

- Permissions in the token are a snapshot; freshness depends on the denylist and on the 15-minute
  lifetime. A larger catalog would grow every token.
- The denylist makes Redis a hard dependency of every authenticated request (fail closed).
- Memory-only storage costs a refresh on every page load and makes multi-tab refresh
  coordination necessary.
- Running our own authentication means owning password storage, lockout and recovery flows.

## Consequences

**Positive**

- No per-request call to identity-service; verification is a local signature check plus one
  Redis `MGET`.
- Downstream services cannot mint tokens; the signing key exists in one service.
- Logout, reuse detection, password reset and membership changes are effective immediately.
- One global guard gives every service the same authentication, tenant and permission behaviour.

**Negative**

- Two token types, two storage mechanisms and a revocation store to operate and explain.
- A signing-key rotation requires a coordinated update of verifiers until they fetch JWKS by `kid`.

## Failure, scaling, security and operational implications

- **Failure:** Redis unavailable → authenticated requests answer `503`, never "trust the token".
  identity-service unavailable → existing access tokens keep working until expiry; no new logins
  or refreshes. Redis data loss → revoked access tokens may work until they expire (≤ 15 min).
- **Scaling:** verification is CPU-only and horizontally scalable; Redis load is one `MGET` of at
  most two keys per request; markers expire after `ACCESS_TOKEN_TTL_SECONDS + 60`.
- **Security:** algorithm pinning, issuer and audience checks, claim schema validation, 5-second
  clock tolerance. Refresh and email tokens are 256-bit and stored hashed. Login and reset
  responses do not reveal whether an email exists; registration does (documented tradeoff).
- **Operational:** keys are generated with `pnpm --filter @solmira/identity-service keys:generate`
  locally and come from a secret manager in deployed environments; the service refuses to start
  without them. Lockout and TTLs are configuration (`LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_SECONDS`,
  `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`, `SESSION_MAX_AGE_SECONDS`).
