# ADR-0011: Refresh token rotation with whole-session reuse detection

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The refresh token (ADR-0010) is the long-lived credential: up to 30 days, stored in a browser
cookie. The roadmap rates refresh-token theft as a high-impact risk. A stolen, non-rotating
refresh token gives an attacker indefinite access that the victim cannot notice and the server
cannot distinguish from legitimate use. The design must:

- make a stolen refresh token detectable, and limit what it buys;
- behave correctly when the same client sends two refreshes at once (tabs, retries);
- keep the database, not a cache, as the source of truth for session state;
- bound session lifetime both by inactivity and absolutely.

## Decision

**Every refresh consumes the presented token and issues a successor. Presenting a consumed token
revokes the entire session.**

- A **session** row (`sessions`) owns a chain of `refresh_tokens` rows. Each row stores
  `token_hash = sha256(token)` (unique), `expires_at`, `used_at`, `revoked_at` and
  `replaced_by_id` pointing to its successor.
- `POST /api/v1/auth/refresh` runs one transaction (`SessionsService.rotate`):
  1. `SELECT token, session, user.status ... WHERE token_hash = $1 FOR UPDATE OF refresh_tokens, sessions`.
  2. Unknown hash or revoked session → `invalid`.
  3. Token already `used_at` or `revoked_at` → **reuse**: set `sessions.revoked_at`,
     `revoke_reason = 'refresh_token_reuse'`, revoke every token of the session, record
     `session.revoked` in the outbox.
  4. Token or session expired → `invalid`. User not active → revoke with `account_disabled`.
  5. Otherwise insert the successor, mark the presented token `used_at` + `replaced_by_id`, update
     `last_seen_at`, commit.
- After a reuse revocation commits, the Redis session marker is written so the session's live
  access tokens stop working immediately.
- Lifetimes: successor expires at `min(now + 7 days, session.expires_at)`; `sessions.expires_at` is
  fixed at creation (30 days) and never extended.
- Any failed refresh clears the refresh and hint cookies.
- The web client makes refresh single-flight within a tab and serialises it across tabs with
  `navigator.locks`, so a well-behaved client never presents the same token twice.
- **No grace window.** A consumed token is never accepted again, not even for a few seconds.

## Alternatives considered

- **No rotation (static refresh token until expiry).** Theft is undetectable. Rejected.
- **Rotation without reuse detection.** An attacker who refreshes first simply takes over the
  chain and the victim is silently logged out. Rejected.
- **Revoke only the reused token's descendants.** Equivalent to revoking the session in this
  model (one linear chain per session) but more complex; the whole session is revoked.
- **Revoke all of the user's sessions on reuse.** Stronger, but punishes every other device for a
  problem on one. Rejected as the default; password reset does revoke everything.
- **Grace window (accept the previous token for N seconds).** Tolerates lost responses and tab
  races, but the window is exactly the attack window for a racing thief, and it needs extra state
  to return the same successor. Rejected; client-side serialisation removes the benign races.
- **Store refresh tokens in Redis.** Faster, but session state would then depend on cache
  durability. PostgreSQL row locks give the serialisation needed for free.
- **Sender-constrained tokens (DPoP, mTLS).** Would bind the token to a key the thief does not have.
  Not broadly practical for a browser application today; revisit if needed.

## Tradeoffs

- Strictness costs occasional false positives: a network failure after the server rotated but
  before the browser stored the new cookie signs that device out.
- Every refresh writes two rows and updates two; `refresh_tokens` grows by one row per refresh per
  session and needs periodic pruning of rows belonging to ended sessions.
- A thief who uses a stolen token while the victim is away for good keeps access until the idle or
  absolute limit, unless the victim ends the session from the session list or resets the password.

## Consequences

**Positive**

- Any use of a stolen refresh token alongside the legitimate client is detected at the next
  refresh by either party and ends the session for both.
- Concurrent refreshes are correct by construction: the row lock makes the second one a replay.
- Revocation state is durable and auditable (`revoke_reason`, `session.revoked` events).

**Negative**

- Clients must coordinate refreshes; a naive client with parallel retries will sign itself out.
- Table maintenance is needed for used and expired token rows.

## Failure, scaling, security and operational implications

- **Failure:** if the Redis write after a reuse revocation fails, the session is still revoked in
  PostgreSQL (refresh is impossible) but its access tokens remain valid until they expire
  (≤ 15 min). A database failure fails the refresh; the client signs in again.
- **Scaling:** refresh is on the auth path only, roughly once per access-token lifetime per active
  session; the lock is per token row, so there is no global contention.
- **Security:** only hashes are stored; the cookie is `httpOnly`, `Secure`, `SameSite=Strict`,
  scoped to `/api/v1/auth`, and refresh requires the `x-solmira-client` header (CSRF).
- **Operational:** `revoke_reason = 'refresh_token_reuse'` spikes are a signal worth alerting on
  (theft, or a client bug causing parallel refreshes). Integration tests cover rotation, reuse
  revoking the whole session, expiry, the CSRF header and hash-only storage.
