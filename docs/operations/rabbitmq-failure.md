# RabbitMQ failure

Alarms: `<name>-outbox-lag`, `<name>-rabbitmq-memory`, `<name>-rabbitmq-cpu`, or the broker is unreachable.
Not yet run on AWS. The behavior below under a broker outage is exercised by the local chaos tests
(`tests/resilience`), not on Amazon MQ.

## What happens during an outage

- **Accepting messages keeps working.** Ingest writes the message, its deliveries and its outbox events in
  one database transaction; it does not need the broker for that.
- **Events pile up in the outbox.** The relay publishes them when the broker returns, in order, and marks
  them sent only after the broker confirms. `OutboxOldestAge` rises (alarm `<name>-outbox-lag`).
- **Deliveries still go out.** The dispatcher claims deliveries from PostgreSQL and does not use the broker
  for sending. What waits are the things driven by events: the fan-out of newly accepted messages (message
  to deliveries), delivery statistics, the audit trail, endpoint-disabled emails and the live feed.
- **Nothing is lost and nothing needs replaying by hand** once the broker is back: the relay catches up and
  consumers deduplicate on event id.

## Procedure

1. Check the broker in the Amazon MQ console: state, maintenance event, memory, disk, connection count.
2. **Maintenance or failover** (cluster mode only): connections drop and clients reconnect by themselves;
   wait for the outbox age to fall. A single-instance broker is unavailable during maintenance, by design
   of that size; the maintenance window is set in Terraform.
3. **Memory or disk alarm** (the broker blocks publishers): find the queue growing in the RabbitMQ console
   (linked from the Amazon MQ console). A growing consumer queue means a consumer is down: check its
   tasks. A growing `.dlq` queue is [dead letters](dead-letter-queues.md).
4. **Broker lost or replaced**: apply Terraform to recreate it, then restart the services so they redeclare
   their queues and exchanges. Messages that were queued on the lost broker are gone, but events the relay
   had not yet confirmed are still in the outbox. Events the broker had confirmed but consumers had not
   processed are lost; the affected consumers are fan-out (messages accepted without deliveries),
   analytics and audit. Find messages without deliveries by comparing recent `messages` with `deliveries`
   in the ingest database, and replay those from the console.
5. **Credentials**: the broker user and password are in each service's secret; if they were rotated, see
   [Key and credential rotation](key-rotation.md).

## Done when

`OutboxOldestAge` is near zero, consumer queues are draining, and the dead-letter queues are empty or
understood.
