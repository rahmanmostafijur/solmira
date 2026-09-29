# ADR-0009: RabbitMQ for integration events

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Service boundaries (ADR-0004) move side effects out of the transaction: when an order is
confirmed, notification-service sends an alert, analytics-service updates `daily_sales`,
audit-service records the change, and operations-service's own low-stock evaluator reacts to
`inventory.reserved`. These must happen reliably but asynchronously, without order confirmation
waiting on or failing because of any consumer.

Requirements:

- No lost events even if the broker is down at commit time; duplicates are acceptable if handled.
- Per-consumer routing by event type (`order.*`, `inventory.low_stock`, `shipment.*`).
- Per-consumer retry with backoff and a dead-letter destination an operator can inspect and
  replay (phase 7 DLQ runbook).
- Modest volume (orders per second, not millions of events per second); ordering needed only
  loosely per entity.
- Runs locally in Docker and as a managed service in AWS.

## Decision

Use **RabbitMQ** with the transactional outbox.

- **Topology:** one durable **topic exchange** `solmira.events`; routing key = event type
  (`order.confirmed`). Each consumer owns a durable quorum queue `<service>.events` bound to the
  patterns it needs (analytics binds `order.#`, `inventory.#`, `purchase_order.#`, `shipment.#`).
- **Retries:** on a transient failure the consumer republishes to `<service>.events.retry` with a
  per-message TTL (for example 1s, 5s, 30s, 2m, 10m) whose dead-letter target is the main queue;
  the attempt count travels in a header. After N attempts the message goes to
  `<service>.events.dlq`. Validation failures (payload fails its zod schema) go straight to DLQ.
- **Producers:** events are inserted into `outbox_events` in the business transaction. A relay
  claims batches with `FOR UPDATE SKIP LOCKED`, publishes with **publisher confirms**, and marks
  rows sent only after the broker acks.
- **Consumers:** **at-least-once** delivery with manual acks and bounded prefetch. Idempotency by
  inserting `(consumer, event_id)` into `processed_events` in the same transaction as the side
  effect; a unique violation means "already done", so ack and skip.
- Envelope and payloads validated with zod from `packages/contracts`; `correlationId` and trace
  context travel in the envelope and headers.
- **AWS:** **Amazon MQ for RabbitMQ**, keeping the same AMQP topology and client code.

## Alternatives considered

- **Kafka (or MSK).** Durable replayable log, high throughput, per-partition ordering. Rejected:
  the volume does not need it; per-message retry and DLQ are not native (they become extra
  topics and consumer logic); running a cluster locally and in AWS (MSK) costs more than the
  problem justifies. Replay needs are covered by the DynamoDB event history (phase 10).
- **SNS + SQS.** Fully managed, fan-out via subscriptions, native DLQ with redrive. Rejected as
  primary because local parity requires an emulator, filtering is by message attributes rather
  than topic patterns, and delay-based backoff is limited (SQS delay max 15 minutes, per queue or
  per message with caveats). It would be the choice for an AWS-only team.
- **Direct HTTP calls from operations-service to consumers.** Simplest, but couples order
  confirmation latency and availability to every consumer; a notification outage would fail or
  slow confirmations, and retries would live in the caller.
- **Redis Streams.** Already in the stack, but weaker durability guarantees and hand-built
  routing, retry and DLQ semantics.

## Tradeoffs

- At-least-once means every consumer must be idempotent; this is enforced by the
  `processed_events` pattern and tested with duplicate-delivery tests (phase 7).
- No global ordering. Consumers that care (analytics status durations) use `occurredAt` and
  entity versions rather than arrival order; retries can reorder messages.
- The outbox adds a table, a relay process and a small publish delay.

## Consequences

**Positive**

- Order confirmation commits without touching the broker; a broker outage delays side effects
  but never loses them (they wait in `outbox_events`).
- Each consumer fails, retries and dead-letters independently.
- Topic patterns make adding a consumer a binding, not a producer change.

**Negative**

- More infrastructure to operate (broker, queues, DLQs) and to monitor.
- Debugging spans producer, relay, broker and consumer; correlation IDs and tracing are required.

## Failure, scaling, security and operational implications

- **Failure:** broker down means outbox backlog grows and alarms fire on outbox age; consumer
  down means queue depth grows. Poison messages stop at the DLQ, not in a hot loop.
- **Scaling:** consumers scale on queue depth; multiple relay replicas are safe thanks to
  `SKIP LOCKED`; quorum queues replicate across broker nodes.
- **Security:** per-service broker credentials with permissions scoped to their own queues and
  publish rights only on `solmira.events` for producers; TLS to Amazon MQ.
- **Operational:** DLQ runbook covers inspect, fix, and shovel back to the main queue; alarms on
  DLQ depth greater than zero, outbox age and consumer lag.
