# ADR-0033: Endpoint isolation, circuit breaking, auto-disable, replay and secret rotation

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

A slow, timing-out or dead endpoint must never delay deliveries to other endpoints or tenants (no
head-of-line blocking). Endpoints that keep failing must stop consuming effort and their owner must
hear about it exactly once. Failed deliveries must be recoverable, one message or many, without
losing history. Secrets must rotate without a window in which receivers reject our requests.

## Decision

**Isolation is decided where work is claimed, not after it.** A worker slot spent waiting on a dead
endpoint is a slot another endpoint did not get, so deliveries to a saturated or tripped endpoint are
not claimed at all (they stay `pending`, untouched).

- `claim_due_deliveries(limit, per_tenant, per_endpoint, lease)` counts the unexpired claims each
  endpoint already holds (across all workers) and offers an endpoint at most `per_endpoint` minus
  that. It skips endpoints whose circuit is open, and lets a half-open endpoint (one that tripped and
  has not succeeded since) carry one probe delivery at a time. The tenant cap still applies and the
  longest-waiting tenant goes first. Inside one tenant a stalled endpoint therefore cannot crowd out
  its healthy neighbours, and across tenants a backlog cannot fill a batch.
- **Circuit breaker.** Per endpoint, in PostgreSQL (shared by every worker): consecutive failures,
  the time the current failure streak began, a trip count and `circuit_open_until`. After 5
  consecutive failures the circuit opens for a cool-down that doubles with each trip (30 s up to
  10 min). After the cool-down one probe is allowed; a success resets everything, a failure opens the
  circuit again for longer. The counters are updated with atomic expressions in the same transaction
  that records the delivery outcome.
- **Auto-disable.** When an endpoint has failed continuously (no success) for the configured period
  (5 days by default), it is disabled (`disabled_reason = 'auto_failures'`) by a statement guarded on
  `enabled`, so only one worker wins, and that transaction writes the `endpoint.auto_disabled` event
  to the outbox: exactly one event per disabling. notification-service turns it into one in-app
  notification, claimed by event id. Re-enabling an endpoint resets its health.
- **Per-endpoint rate limit.** The endpoint's `rateLimitPerSecond` is enforced in Redis with a one
  second fixed window. A delivery over the limit is **deferred** (back to `pending`, due in the next
  window, no attempt counted), not failed. If Redis is down the limiter lets deliveries through and
  logs, like ingestion (ADR-0030).
- **Failed is a state, and the way back is replay.** `failed` plus the history is the dead-letter
  queue. Replay sets deliveries back to `pending` and starts a new cycle: `attempt_count` keeps
  counting (so every attempt has a unique key in the history), `cycle_base` records where the cycle
  began, and the retry schedule is indexed by `attempt - cycle_base`. Replay of one message handles
  that message's deliveries; bulk replay handles the failed deliveries of one endpoint created in a
  time range, in bounded batches. Only rows that are not already pending are touched, so repeating a
  replay changes nothing. The `webhook-id` is the same as for the first delivery, so receivers can
  deduplicate; replay of a delivery that succeeded earlier is possible for single messages.
- **Secret rotation.** Rotating makes the current secret `previous` with an expiry (24 hours by
  default) and creates a new active secret, returned once. Any older previous secret expires at once,
  so at most two secrets are valid. While a previous secret is valid the dispatcher signs with both
  (Standard Webhooks allows several signatures); after the expiry only the new one signs.

## Alternatives considered

- **Deferring after claiming.** Rejected: the claim itself would still fill the tenant's quota with the
  stalled endpoint's backlog every pass.
- **A circuit breaker in worker memory.** Rejected: each worker would learn separately and restart
  with a clean slate; the state belongs next to the endpoint.
- **Resetting `attempt_count` on replay.** Rejected: it would overwrite the earlier attempts in the
  history.
- **A queue per endpoint.** Rejected in ADR-0031 as the state of record; the claim function gives the
  same isolation without a queue per endpoint.

## Consequences

The claim function is more elaborate and is the most tested SQL in the system. A tripped endpoint's
deliveries wait, which is intended; they are neither failed nor dropped.

## Failure, scaling, security and operational implications

Caps are enforced from database state, so they hold across workers and survive restarts. The
breaker, the limiter and the disabling are all visible in the data (`circuit_open_until`,
`disabled_reason`, the outbox), which keeps incidents explainable. Rotation never exposes a secret
and every rotation and reveal is audited.
