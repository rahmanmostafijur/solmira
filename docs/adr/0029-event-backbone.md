# ADR-0029: Event backbone: outbox relay, consumers, retries and DLQs

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Services record events in an outbox table inside the transaction that changes their data
(ADR-0009). Something has to publish those rows to RabbitMQ without losing any, and consumers have
to process them safely when the broker or a service restarts. Delivery is at least once, so
duplicates are expected and must be harmless.

## Decision

- **Topology.** One durable topic exchange `solmira.events`; the routing key is the event type. A
  consumer owns a durable queue `<service>.<consumer>` bound to the patterns it wants, with a
  dead-letter exchange `solmira.events.dlx`. Beside it live `<queue>.retry` (a fixed queue-level
  TTL, dead-lettering back to the main queue) and `<queue>.dlq`.
- **Relay.** A relay in the producing service polls `outbox_events` in batches:
  `SELECT ... WHERE published_at IS NULL ORDER BY occurred_at, id LIMIT n FOR UPDATE SKIP LOCKED`,
  publishes each row on a confirm channel (persistent, `messageId` = event id), waits for the
  broker's confirms, marks the rows published and commits. Replicas never claim the same rows. If
  the process dies after publishing and before committing, the rows are published again; if it dies
  before publishing, they stay unpublished. Nothing is lost; duplicates are possible.
- **Consumers.** Manual acknowledgement, a prefetch limit, and a `processed_events (consumer,
event_id)` table. A handler claims the event id in the same database transaction as its side
  effect (`INSERT ... ON CONFLICT DO NOTHING`); a redelivered event finds the claim and does
  nothing.
- **Failures.** A handler that throws is retried: the message is republished to the retry queue with
  an attempt counter and returns after the TTL (5 seconds by default). After the configured number
  of attempts (5 by default) it is rejected and the broker routes it to the DLQ. A malformed
  message goes straight to the DLQ.
- **Reconnects.** The shared RabbitMQ connection tells interested components when it is
  (re)established; relay publishers and consumers rebuild their channels and topology then.
- **Ordering.** Not guaranteed across events. Handlers must not assume order; they are written so
  that each event is meaningful on its own.

## Alternatives considered

- **Publish directly from the request.** Rejected: a crash between commit and publish loses the
  event, or publishing first announces a change that may roll back.
- **Logical replication or change data capture.** Rejected for now: more infrastructure for the
  same guarantee at this scale.
- **Per-message TTL retry queues with growing delays.** Rejected: classic queues only expire the
  head message, so a long delay blocks shorter ones behind it.
- **Exactly-once consumption through RabbitMQ.** Not available; idempotent consumers give the same
  effect.

## Consequences

Operators must watch the DLQs (runbook in Phase 12). The outbox table grows until a purge job
removes published rows; the relay does not delete them.

## Failure, scaling, security and operational implications

A broker outage only delays publication; the outbox keeps accumulating and drains afterwards. The
relay batch size and poll interval bound the load on PostgreSQL. Events carry ids and never secrets.
