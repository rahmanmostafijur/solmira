# Chaos tests

Four scenarios run the real ingest service and the real dispatcher as separate processes against real
PostgreSQL, Redis, RabbitMQ and DynamoDB Local, and break something the way an outage would. They prove
two properties: **no event is lost**, and **one endpoint's trouble does not slow the others**. Nothing is
mocked; the receivers are small HTTP servers that verify every signature.

```bash
pnpm infra:up
export TEST_ADMIN_DATABASE_URL=postgres://solmira:<password>@localhost:<port>/postgres
pnpm --filter @solmira/resilience chaos
```

The harness (`tests/resilience/src`) provisions a throwaway database and a RabbitMQ vhost of its own, so a
run never touches a developer's data. The broker scenario stops and starts the compose `rabbitmq`
container, so run it on a stack you can disturb. CI runs the suite as the `chaos` job.

| Scenario       | What breaks                                                        | What must hold                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint down  | One of four endpoints refuses connections while 60 events are sent | The other three stay within twice the latency of a control burst without the fault and under 5 s at p95; when the endpoint returns, it receives all of its 60 events; every delivery ends as delivered |
| Endpoint slow  | One of four answers after twice the sender's timeout               | The same bound for the other three (the slow endpoint may use only its own share of the workers); when it recovers, all 20 deliveries complete                                                         |
| Broker restart | RabbitMQ is stopped while events are sent, then started            | The API keeps answering 202; nothing fans out while the broker is down; after it returns every one of the 45 events reaches both endpoints with a valid signature                                      |
| Worker crash   | The dispatcher is killed with SIGKILL with requests in flight      | The interrupted deliveries (20 of them in the recorded run) are claimed again after their leases expire and delivered; a repeat carries the same `webhook-id`                                          |

The isolation scenarios begin with a **control burst** (the same traffic with every endpoint healthy) and
compare against it, so the bound is on what the fault added, not on the pipeline's own cost.

## What a recorded run measured

From one run on the machine described in [`../performance`](../performance/README.md), commit base
`efd0c92` plus Phase 11 (send to receipt, healthy endpoints, milliseconds):

| Scenario      | Control p95 | With the fault p95 | Bound                |
| ------------- | ----------- | ------------------ | -------------------- |
| Endpoint down | 3,900       | 2,807              | 5,000 and 2x control |
| Endpoint slow | 1,555       | 1,628              | 5,000 and 2x control |

The down-endpoint control is slower than the faulted burst because it ran first on a cold process (the
first burst of a run pays for connection and JIT warm-up); the claim is only that the fault added nothing
visible, not that it made things faster. These are single runs; they are checks against a bound, not
benchmarks.

## What they do not cover

- A tenant-wide outage of the database, or loss of the DynamoDB history (the message inspector degrades,
  covered by an integration test, not here).
- Several brokers or a network partition; one broker is stopped and started.
- Duration: each scenario lasts seconds to a minute.

The scenarios found no defect in loss or isolation. The load test (`docs/performance`), run for the same
phase, found a throughput defect under concurrency (more workers made things slower) and a pause in the
worker loop that waited while work was due; both are addressed in ADR-0037.
