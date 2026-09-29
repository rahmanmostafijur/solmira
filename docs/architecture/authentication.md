# Authentication

Status: **Built** (phase 2). Decisions: [ADR-0010](../adr/0010-authentication-strategy.md),
[ADR-0011](../adr/0011-refresh-token-rotation.md). Related: [authorization](authorization.md),
[tenant isolation](tenant-isolation.md).

identity-service is the only component that authenticates users and the only holder of the
token signing key. Every other service verifies access tokens locally with the public key.

## Code map

| Concern                                  | Location                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Request/response schemas, cookie names   | `packages/contracts/src/auth.ts`                                              |
| Access token verification (all services) | `packages/service-kit/src/auth/access-token-verifier.ts`                      |
| Global guard and decorators              | `packages/service-kit/src/auth/auth.guard.ts`, `decorators.ts`                |
| Revocation denylist                      | `packages/service-kit/src/auth/revocation-store.ts`                           |
| Fixed-window attempt counter             | `packages/service-kit/src/rate-limit/attempt-counter.ts`                      |
| Token issuing and JWKS                   | `apps/identity-service/src/auth/access-token-issuer.ts`, `jwks.controller.ts` |
| Login, register, refresh, switch org     | `apps/identity-service/src/auth/auth.service.ts`, `auth.controller.ts`        |
| Sessions and rotation                    | `apps/identity-service/src/auth/sessions.service.ts`                          |
| Cookies and CSRF header check            | `apps/identity-service/src/auth/auth-cookies.ts`                              |
| Password hashing                         | `apps/identity-service/src/auth/password-hasher.ts`                           |
| Opaque tokens and their hashes           | `apps/identity-service/src/auth/secrets.ts`                                   |
| Password reset, email verification       | `apps/identity-service/src/auth/account-recovery.service.ts`                  |
| Browser session handling                 | `apps/web/src/lib/auth/session-store.ts`, `apps/web/src/lib/api/client.ts`    |

## Token model

Two tokens with deliberately different properties.

| Property           | Access token                                                      | Refresh token                                                                          |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Format             | JWT, `alg: EdDSA` (Ed25519), header `typ: at+jwt`, `kid`          | Opaque: 32 bytes from the CSPRNG, base64url (256 bits)                                 |
| Lifetime           | `ACCESS_TOKEN_TTL_SECONDS`, default 900 (15 min), allowed 60–3600 | Idle `REFRESH_TOKEN_TTL_SECONDS` 7 days, capped by the session's absolute 30 days      |
| Verified by        | Every service, locally, with the public key                       | identity-service only, by database lookup                                              |
| Stored server side | Never                                                             | Only `sha256(token)` in `refresh_tokens.token_hash` (unique)                           |
| Stored in browser  | JavaScript memory only (`session-store.ts`)                       | `solmira_refresh` cookie: `httpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth` |
| Revocable          | Via the Redis denylist (session and membership markers)           | Directly, by marking rows revoked                                                      |

### Access token claims

Defined by `accessTokenClaimsSchema` and validated after signature verification, so a
well-signed token with an unexpected shape is still rejected.

| Claim        | Meaning                                                                                 |
| ------------ | --------------------------------------------------------------------------------------- |
| `sub`        | user id                                                                                 |
| `sid`        | session id (the refresh-token chain this token was minted from)                         |
| `org`        | active organization; present only if the user has an active membership in an active org |
| `role`       | role key in `org`                                                                       |
| `perms`      | permission keys granted in `org`, resolved from the database at issue time              |
| `iat`, `exp` | standard, seconds                                                                       |
| `iat_ms`     | issue time in milliseconds, used for revocation cut-offs (see lessons learned)          |
| `iss`, `aud` | `JWT_ISSUER` (default `solmira-identity`), `JWT_AUDIENCE` (default `solmira-api`)       |

Verification (`AccessTokenVerifier`) pins the algorithm list to `['EdDSA']`, so `alg: none` and
HS256-with-the-public-key confusion attacks are rejected. It checks issuer and audience and allows
5 seconds of clock skew. An expired token is answered with `401 TOKEN_EXPIRED`, any other failure
with `401 UNAUTHENTICATED`, so the client knows when a refresh is worth trying.

The public key reaches services as `JWT_PUBLIC_KEY` (PEM). identity-service also publishes it
as a JWK set at `GET /api/v1/auth/.well-known/jwks.json` (`Cache-Control: public, max-age=300`) so
that key rotation by `kid` can be added without a new contract.

### Sessions

A **session** is one sign-in on one device: a row in `sessions` plus a chain of rows in
`refresh_tokens`, each pointing at its successor through `replaced_by_id`.

- Created by register and login with `expires_at = now + SESSION_MAX_AGE_SECONDS` (30 days,
  **absolute**; activity never extends it).
- Each refresh token expires at `min(now + REFRESH_TOKEN_TTL_SECONDS, session.expires_at)`, so a
  session unused for 7 days cannot be refreshed (**idle** timeout), and no session outlives 30 days.
- `sessions.active_organization_id` remembers which organization the next refresh should issue
  a token for.
- `revoked_at` and `revoke_reason` (`logout`, `user_request`, `refresh_token_reuse`,
  `password_reset`, `account_disabled`) record why it ended; each revocation writes a
  `session.revoked` outbox event.
- `GET /api/v1/auth/sessions` lists the caller's active sessions; `DELETE /api/v1/auth/sessions/:id`
  signs out one device. Another user's session id is answered with 404.

A second cookie, `solmira_session=1` (`httpOnly`, `SameSite=Lax`, `Path=/`, same expiry as the
refresh cookie), is a **hint only**. The Next.js proxy uses it to route signed-out visitors to
`/login` without an API call. It carries no secret and grants nothing.

## Flows

### Register and login

- `POST /api/v1/auth/register` hashes the password, inserts the user, creates a session, creates a
  24-hour email verification token and records `user.registered`, all in one transaction. The
  verification email is sent after commit, best-effort (a mail outage never fails sign-up).
  The new user has no organization, so the first access token has no `org` claim.
- `POST /api/v1/auth/login` checks the lockout counter, verifies the password, then checks
  `users.status` (the "disabled" answer is only given to someone who knows the password). It lands
  the session in the user's oldest active membership and records `user.logged_in`.
- Both return `AuthSession { accessToken, accessTokenExpiresAt, user, activeOrganization }` in the
  body and set the refresh and hint cookies. The refresh token never appears in a response body.

### Browser handling

`apps/web/src/lib/auth/session-store.ts` holds the access token in a module variable, never in
`localStorage` or `sessionStorage`. A page reload loses it deliberately; `AuthProvider` calls
`refreshSession()` once on load and the cookie restores it. The API client sends
`Authorization: Bearer <token>` and, on a `401`, refreshes once and retries once.

Refresh is **single-flight**: concurrent callers in one tab share one in-flight promise, and
across tabs `navigator.locks.request('solmira-auth-refresh', ...)` serialises refreshes. Without
this, two tabs could present the same refresh token and trip reuse detection (below), signing the
user out everywhere.

On login, register, logout and organization switch the provider calls `queryClient.clear()`, so
data cached for one identity or tenant is never shown to the next.

### Switching organization

`POST /api/v1/auth/switch-organization { organizationId }` is authenticated with the current access
token. The organization id is a request, not a fact: a new token is issued only if
`AccessContextService.resolve` finds an active membership in an active organization, otherwise the
answer is `404 Organization not found`. The session's `active_organization_id` is updated so later
refreshes stay in the new organization. The refresh token is not rotated by a switch.

## Refresh token rotation and reuse detection

Every call to `POST /api/v1/auth/refresh` consumes the presented refresh token and issues its
successor. A token that is presented a second time can only mean that two parties hold it, so
the whole session is revoked. Full rationale in [ADR-0011](../adr/0011-refresh-token-rotation.md).

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (legitimate)
  participant X as Attacker (stolen copy of RT1)
  participant I as identity-service
  participant P as PostgreSQL
  participant R as Redis

  B->>I: POST /auth/refresh (cookie RT1, x-solmira-client)
  I->>P: SELECT token, session, user WHERE token_hash = sha256(RT1) FOR UPDATE
  P-->>I: RT1 unused, session active, user active
  I->>P: INSERT RT2, UPDATE RT1 SET used_at, replaced_by_id = RT2; COMMIT
  I-->>B: 200 access token AT2, Set-Cookie RT2

  X->>I: POST /auth/refresh (cookie RT1)
  I->>P: SELECT ... WHERE token_hash = sha256(RT1) FOR UPDATE
  P-->>I: RT1 already used
  I->>P: UPDATE sessions SET revoked_at, reason = refresh_token_reuse<br/>UPDATE refresh_tokens SET revoked_at (whole chain)<br/>INSERT outbox session.revoked; COMMIT
  I->>R: SET auth:revoked:sid:<sid> EX ttl
  I-->>X: 401, cookies cleared

  B->>I: GET /api/v1/me (Bearer AT2)
  I->>R: MGET auth:revoked:sid:<sid>, ...
  R-->>I: marker present
  I-->>B: 401 This session is no longer valid
  B->>I: POST /auth/refresh (cookie RT2)
  I->>P: RT2 revoked
  I-->>B: 401, cookies cleared: user signs in again
```

Implementation details that matter:

- **Row locks serialise races.** The lookup uses `SELECT ... FOR UPDATE OF refresh_tokens, sessions`.
  Two concurrent refreshes of the same token cannot both succeed: the second waits for the first
  to commit, then sees `used_at` set and is treated as a replay.
- **Order of checks.** Unknown hash or already-revoked session → `invalid`. Used or revoked token →
  **reuse**: revoke the session. Expired token or session → `invalid`. User no longer `active` →
  revoke with reason `account_disabled`. Otherwise rotate and bump `sessions.last_seen_at`.
- **Denylist after commit.** The Redis session marker is written only after the revocation
  transaction commits, so a rolled-back revocation never leaves a stray marker.
- **Membership is re-checked on every refresh.** If the session's active organization no longer
  grants access (removed, suspended, organization suspended), the new access token has no `org`
  claim and `active_organization_id` is cleared.
- **Any refresh failure clears both cookies** in the response, so the browser stops retrying a dead
  token.

## Revocation

Access tokens are stateless, so revocation needs shared state. `RedisRevocationStore` keeps two
kinds of marker. Both expire after `ACCESS_TOKEN_TTL_SECONDS + 60`, because by then every token
they could affect has expired on its own.

| Marker                                 | Value             | Written by                                               | Effect                                                           |
| -------------------------------------- | ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `auth:revoked:sid:<sessionId>`         | `1`               | logout, device sign-out, reuse detection, password reset | Every access token of that session is rejected                   |
| `auth:revoked:member:<orgId>:<userId>` | change time in ms | member role change, suspension, removal                  | Tokens for that org and user with `iat_ms <= value` are rejected |

`AuthGuard` checks both keys with one `MGET` on every authenticated request, after signature
verification. Tokens minted after a membership change carry the new state and pass.

**Fail closed.** If Redis cannot be read, `isRevoked` throws `503 SERVICE_UNAVAILABLE` rather than
trusting the token. A Redis outage therefore makes authenticated routes unavailable; it never makes
revoked tokens valid again. This is a conscious availability-for-security trade.

## Logout

`POST /api/v1/auth/logout` (requires `x-solmira-client`) finds the session from the refresh cookie,
whether or not that token was already rotated, marks the session and all its refresh tokens
revoked, writes the Redis session marker and records `user.logged_out`. It then clears both
cookies and answers `204`. It is idempotent: no cookie or an unknown token is still `204`.
The access token held by that tab stops working immediately through the session marker; the web
app also drops it from memory and clears the query cache.

## Passwords

- **Policy** (`passwordSchema`): 12 to 128 characters, no composition rules (NIST SP 800-63B).
  Login accepts any non-empty password up to 128 characters, so a future policy change can never
  lock out existing accounts. The upper bound protects the hasher from multi-megabyte inputs.
- **Hashing:** Argon2id via `@node-rs/argon2` with `memoryCost: 19456` (19 MiB), `timeCost: 2`,
  `parallelism: 1` (the OWASP baseline). The encoded hash stores its own parameters, so they can be
  raised later without invalidating existing hashes.
- **Timing equalisation:** when no account matches the email, `verifyAgainstDummy` runs a full
  Argon2 verification against a lazily computed dummy hash. An unknown email therefore costs the
  same time as a wrong password, and both answer `401 INVALID_CREDENTIALS` with the same message.
- **Emails** are trimmed and lower-cased by `emailSchema`; the unique index is on `lower(email)`.

## Brute-force protection

Two independent layers:

1. **Per email, in identity-service.** `AttemptCounter` (prefix `auth:login-failures`) keys on
   `email:sha256(email)`, so raw addresses never land in Redis. After `LOGIN_MAX_FAILURES` (default 5) failed attempts within `LOGIN_LOCKOUT_SECONDS` (default 900), further logins are refused
   with `429 RATE_LIMITED` and a `Retry-After` header, **even with the correct password**. The window
   is fixed: it starts at the first failure and is not extended by later ones
   (`EXPIRE ... NX`), so an attacker cannot keep a victim locked out forever with a trickle of
   guesses. A successful login resets the counter. Failures for unknown emails are counted too, so
   the counter does not reveal which emails exist.
2. **Per IP, at the gateway.** Nginx zone `auth_per_ip` allows 10 requests per minute per client IP
   (burst 5) on `/api/v1/auth/(login|register|forgot-password|reset-password)`, answering `429`.
   All other API routes share `api_per_ip` (30 r/s, burst 60).

The per-email counter stops targeted guessing spread across many IPs; the per-IP limit stops
one source from spraying many accounts.

## Password reset and email verification

Both use rows in `email_tokens` (`purpose` is `verify_email` or `reset_password`), with the same
properties as refresh tokens: 256-bit random secret, only `sha256` stored, looked up by unique hash.

| Property    | Email verification             | Password reset                                                              |
| ----------- | ------------------------------ | --------------------------------------------------------------------------- |
| Lifetime    | 24 hours                       | 30 minutes                                                                  |
| Issued      | at registration                | `POST /auth/forgot-password`, active accounts only                          |
| Consumed by | `POST /auth/verify-email`      | `POST /auth/reset-password`                                                 |
| Side effect | sets `users.email_verified_at` | new Argon2id hash, **revokes every session** of the user and denylists them |

- **Single use:** consumption selects the row `FOR UPDATE` where `used_at IS NULL AND expires_at > now()`
  and sets `used_at` in the same transaction; a second use finds nothing. Issuing a new token for a
  purpose first marks any earlier unused token of that purpose as used, so only the newest link works.
- **No enumeration:** `forgot-password` always answers `202 Accepted`, whether or not the account
  exists or the throttle was hit.
- **Throttle:** at most 3 reset emails per address per hour (`auth:reset-requests`, keyed by
  `sha256(email)`); extra requests are silently dropped.
- **Invalid or expired links** answer `400 BAD_REQUEST "This link is invalid or has expired"`,
  identical for every failure cause.
- Links point at `APP_URL` (`/verify-email?token=...`, `/reset-password?token=...`). Email delivery
  is best-effort after commit; failures are logged, not surfaced.

## CSRF

The refresh cookie is the only credential the browser sends automatically, and it is sent only
to `/api/v1/auth/*`. Two defences protect the cookie-authenticated endpoints (`refresh`, `logout`):

1. `SameSite=Strict`: browsers do not attach the cookie to any cross-site request, including
   top-level navigations.
2. A custom header, `x-solmira-client`, is required (`assertFirstPartyClient`, otherwise
   `403 FORBIDDEN`). A cross-site page cannot set custom headers without a CORS preflight, and the
   API never approves one: the browser talks only to the gateway origin, so there is no CORS
   configuration at all.

All other endpoints authenticate with the `Authorization` header, which browsers never attach on
their own, so they are not CSRF-exposed.

## Token theft and replay analysis

| Scenario                                       | Outcome                                                                                                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token stolen (log, proxy, XSS read)     | Usable for at most its remaining lifetime (≤ 15 min), in the organization it names. Logout or device sign-out ends it at once through the session marker.                                            |
| Access token tampered or forged                | Signature check fails: `401`. The tenant-isolation suite rewrites the `org` claim of a valid token to another tenant and keeps the original signature to prove it.                                   |
| Refresh token stolen, attacker refreshes first | Attacker gets one rotation. The victim's next refresh presents a used token, the session is revoked and the attacker's new tokens die with it.                                                       |
| Refresh token stolen, victim refreshes first   | Attacker's replay presents a used token: session revoked, both are signed out, victim signs in again.                                                                                                |
| Refresh token stolen, victim never returns     | Attacker can keep rotating until the idle (7 d) or absolute (30 d) limit. Mitigations: session list with device sign-out, password reset revokes everything.                                         |
| Database dump leaked                           | Refresh, reset, verification and invitation tokens are stored as SHA-256 of 256 random bits: not reversible, not usable. Passwords are Argon2id.                                                     |
| Redis wiped or failed over                     | Denylist markers lost: already-revoked access tokens could work until they expire (≤ 15 min). Refresh tokens are unaffected (revocation is in PostgreSQL). A Redis read failure itself fails closed. |
| XSS in the web app                             | Can use the in-memory access token while the page is open; cannot read the `httpOnly` refresh cookie. CSP and output encoding are the main controls.                                                 |
| Cross-site request forgery                     | Blocked by `SameSite=Strict` plus the required `x-solmira-client` header.                                                                                                                            |
| Signing key compromise                         | Only identity-service holds the private key. Recovery is a key rotation (new `kid`); downstream services never hold it.                                                                              |

## Tradeoffs and known limitations

- **Strict reuse detection, no grace window.** A token is valid exactly once. Two tabs, a retry
  after a network timeout, or a browser that loses the response can present the same token twice
  and sign the user out. The web app mitigates with single-flight refresh and Web Locks; the server
  deliberately does not accept a just-rotated token for a few seconds, because that window is
  exactly what a racing attacker would use.
- **Account lockout is a denial-of-service lever.** Anyone who knows an email can lock that account
  for up to 15 minutes with 5 wrong passwords. The fixed window bounds the damage and the per-IP
  gateway limit slows mass lockouts; the alternative (no lockout) would allow distributed guessing.
  Adding a CAPTCHA or step-up challenge instead of a hard lock is a future option.
- **Registration reveals existing emails.** `POST /auth/register` answers `409 CONFLICT
"An account with this email already exists"`. This is an enumeration channel, accepted for
  usability; login and password reset do not leak. The alternative is a "check your inbox" flow for
  every registration, planned only if enumeration becomes a real concern. The gateway limit
  (10/min/IP) slows harvesting.
- **Revocation depends on Redis.** Without the denylist, logout would only take effect at access
  token expiry. The fail-closed read makes Redis a hard dependency of every authenticated request.
- **Switching organization does not revoke the previous token.** The token for the organization
  the user just left stays valid until it expires (≤ 15 min). It still reflects a real, active
  membership, so it grants nothing the user does not have.
- **Membership re-check happens at refresh.** A token's `perms` are a snapshot. Changes made through
  the member endpoints are pushed through the membership marker at once; a change made directly in
  the database (no marker) takes effect at the next refresh, within one access token lifetime.
- **Email verification is not yet enforced** for any action; it is recorded for later policies.
- **No MFA** yet.
- **Single signing key.** JWKS is published, but verifiers currently load one PEM key from
  configuration; rotating the key requires a coordinated redeploy.
- **Only identity-service registers the guard today.** Other services adopt `AuthModule.forRoot`
  with the public key as their routes are built (phase 3 onwards).

## Lessons learned

**1. `iat` is too coarse for revocation cut-offs.** The membership marker means "reject tokens for
this member issued before the change". The first version compared the change time with the JWT
`iat` claim, which has one-second precision. Take a token issued at 12:00:00.100, a role change at
12:00:00.400 and a refreshed token issued at 12:00:00.700: both tokens have the same `iat`. At
second precision the two cannot be told apart, so the cut-off either rejects the fresh token too or,
as happened here, lets the stale token, issued in the same second _before_ the change, survive with
its old role until it expired. The integration test "applies a role change immediately: old tokens
stop working" caught it intermittently, whenever setup and the role change fell into the same
second. The fix added an `iat_ms` claim (`access-token-issuer.ts`), stores the change time in
milliseconds and rejects when `iat_ms <= changedAt` (`revocation-store.ts`). A token without
`iat_ms` falls back to the first millisecond of its `iat` second, which errs towards rejecting; a
rejected client simply refreshes. General rule: an "issued before X" comparison needs the same
precision on both sides.

**2. A global guard also guards the health probes.** Registering `AuthGuard` as `APP_GUARD` made
authentication the default for every route, which is the point, but it included `/health/live` and
`/health/ready`. Load balancers and orchestrators hold no user token, so every instance would have
been reported unhealthy and taken out of rotation the moment it was deployed. `HealthController` is
now `@Public()`, and `packages/service-kit/src/auth/auth.guard.test.ts` has the regression test
"keeps health probes public so load balancers can reach them". General rule: when a default flips
from open to closed, list the callers that are not users.
