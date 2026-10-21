# Dead-letter queues

Alarm: `<name>-dead-letters-<queue>`. Not yet run on AWS; the tool itself is covered by an integration test
against a real broker.

A message lands in a dead-letter queue after its consumer failed it on every retry. The consumers are
idempotent (they record processed event ids), so putting a message back is safe even if it partly ran.

| Queue                          | Consumer     | If it stays unprocessed                        |
| ------------------------------ | ------------ | ---------------------------------------------- |
| `ingest.fan-out`               | ingest       | Messages are accepted but never get deliveries |
| `notification.endpoint-alerts` | notification | Owners are not told an endpoint was disabled   |
| `analytics.delivery-attempts`  | analytics    | Delivery statistics miss attempts              |
| `audit.admin-actions`          | audit        | The audit trail misses actions                 |

`ingest.fan-out` matters most to customers; the others do not affect delivery.

## Procedure

1. **Look.** Run the `dead-letters` one-off task with the command
   `["node","node_modules/@solmira/service-kit/dist/messaging/dead-letters-cli.js","peek","<queue>"]`.
   It prints event identities, never message bodies, and changes nothing.
2. **Find the cause** in the consumer's log (`/solmira/<environment>/<service>`), searching for the event id.
   Typical causes: a bug in a new release (roll back or fix, then requeue), a dependency that was down
   for longer than the retries covered (just requeue), a message that can never be processed.
3. **Requeue** once the cause is fixed: the same command with `requeue <queue> --limit 50`. Start with a
   small limit and watch the queue drain before doing the rest.
4. **Discard** only a message that can never succeed, by event id:
   `discard <queue> <eventId> ...`. Record the event id and the reason in the incident notes. Discarding
   an audit event loses an audit record; ask the owner first.

## Done when

The queue is empty and the alarm is OK. If anything was discarded, the incident notes say what and why.
