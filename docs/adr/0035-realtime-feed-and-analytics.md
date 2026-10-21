# ADR-0035: Realtime delivery feed and analytics

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Tenants want to watch deliveries as they happen and to see how an application and each endpoint are
doing: success rate, attempts per delivery, and latency percentiles. Both need to know about every
attempt, and the dispatcher is the only place that does.

## Decision

- **One event per real send.** The dispatcher adds `delivery.attempted` to the outbox in the same
  transaction that records the outcome (ADR-0029), so the event exists exactly when the recorded outcome
  does. It carries ids, the event type name, attempt number, result (`succeeded`, `retrying`, `failed`),
  status code, error class, duration and times. It never carries a URL, header, payload or response
  body. Refusals that sent nothing (a disabled endpoint) produce no event. To build it the dispatcher
  role may read the `id`, `organization_id` and `name` columns of `event_types`, nothing else.
- **The feed is in notification-service**, the service that pushes things to people. It is a WebSocket
  at `/ws/v1/deliveries`. The first frame must be `{"type":"auth","token":<access token>}`; browsers
  cannot set headers on a WebSocket and a token in the URL ends up in logs. The token is verified like
  any request (signature, expiry, revocation list), must carry an organization and `messages.read`, and
  decides the tenant: a connection is registered under the organization in its token and nothing the
  client sends can change that. The connection closes at token expiry and the client reconnects with a
  fresh token. No cookie is used, so a page on another origin cannot ride on a user's session.
- **Fan-out.** Each instance has its own exclusive queue bound to `message.created`,
  `delivery.attempted` and `endpoint.auto_disabled` and forwards to its own connections. Only named
  fields are copied to clients. The feed is live only: it stores nothing and a client that was away
  reloads from the REST API (the console does this on every reconnect and polls while the feed is down).
- **Limits.** 50 connections per organization (configurable), a 4 KiB limit on client frames, and a
  client that falls more than 1 MiB behind is dropped (close 1013) rather than buffered.
- **Analytics are in analytics-service**, which stores one row per attempt in its own database with RLS,
  keyed by the event id and unique per (delivery, attempt), so redelivered events change nothing. Figures
  are computed from the rows at query time: success rate is successful attempts over attempts, attempts
  per delivery is attempts over distinct deliveries in the range, and latency percentiles are linearly
  interpolated (`percentile_cont`) over the duration of every attempt, per endpoint and per application.
  Ranges are at most 31 days, rows are kept 35 days and purged hourly by a bounded job.

## Alternatives considered

- **Rolled-up counters and histograms per hour.** Cheaper at large volume but hides the arithmetic and
  cannot give exact percentiles. Raw rows keep every number checkable against a fixture; roll-ups can be
  added when the load test (Phase 11) shows the query cost.
- **Reading attempts from DynamoDB for analytics.** It is derived data with a 30-day TTL and no
  aggregation; the events give a durable, tenant-keyed source of their own.
- **Durable per-client queues for the feed.** Resumable streams cost a queue per connection and are not
  needed for a view that can be reloaded from state.
- **A token in the WebSocket URL or a cookie.** Rejected for log leakage and cross-site hijacking.

## Consequences

One more outbox row per attempt, so write volume on the ingest database grows by that much; the outbox
is purged after its retention period. Every instance of notification-service receives every feed event
and drops those with no local listener. Percentile queries scan the attempts of the range for one tenant
using the (organization, application, time) indexes.

## Failure, scaling, security and operational implications

If the broker is down the feed stops and the console polls; attempts queue in the outbox and reach
analytics afterwards. A malformed event is dead-lettered by analytics and ignored by the feed. The
cross-tenant test publishes events for two organizations and checks that each client receives only its
own. Closing codes are 4400 (protocol), 4401 (authentication or expiry), 4403 (no organization or
permission) and 1013 (too many connections or too slow).
