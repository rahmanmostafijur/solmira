# Performance

Every figure on this page was produced by a run of the code in this repository, on the machine
described below, and its raw output is in [`results/`](results). Nothing here is a target, an estimate or
a number from another system. A figure from one machine says how this system behaves and what limited it
there; it is not a promise for another machine.

## How to measure

```bash
pnpm infra:up                                   # PostgreSQL, Redis, RabbitMQ, DynamoDB Local
export TEST_ADMIN_DATABASE_URL=postgres://solmira:<password>@localhost:<port>/postgres
pnpm --filter @solmira/resilience load          # ingestion, dispatch, end to end
pnpm --filter @solmira/resilience load:sweep    # dispatch capacity under different worker settings
```

The tools (`tests/resilience`) start the real ingest service and dispatcher as processes against a
throwaway database (`solmira_resilience`), a RabbitMQ vhost of their own, Redis and DynamoDB Local, create
a tenant with endpoints and API keys through the public API, and send real signed deliveries to receivers
that verify every signature. Each run writes a JSON file with its environment and settings to
`docs/performance/results`. Settings are environment variables (`LOAD_INGEST_MESSAGES`,
`LOAD_INGEST_CONCURRENCY`, `LOAD_ENDPOINTS`, `LOAD_STEADY_RATES`, `LOAD_DISPATCHER_ENV` as JSON,
`SWEEP_CONFIGS`; see the top of `load/run.ts` and `load/sweep.ts`).

What the load test measures:

1. **Ingestion**: 3,000 events through the ingestion API (`POST .../messages`, closed loop of 50 requests
   in flight, 4 API keys because one key is rate limited), with the dispatcher stopped. Events accepted per
   second and the API's response time.
2. **Dispatch**: the backlog of step 1 fanned out to 3 endpoints (9,000 deliveries), then drained by the
   dispatcher. Deliveries completed per second.
3. **End to end**: events sent at a fixed rate for 20 seconds with an empty backlog, at several rates.
   Latency is the time from sending the event to the receiver getting the signed request, per delivery
   (3 endpoints, so every event is 3 deliveries).

## Where the numbers come from

| Property | Value                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU      | AMD Ryzen 5 2400G, 8 hardware threads                                                                                                                                       |
| Memory   | 13.9 GiB                                                                                                                                                                    |
| OS       | Windows 10 (19045), Node 24.13.0                                                                                                                                            |
| Topology | Everything on this one machine: the load generator, the receivers, ingest, the dispatcher, PostgreSQL, Redis, RabbitMQ and DynamoDB Local (the last four in Docker Desktop) |
| Code     | Base commit `efd0c92` plus the changes of Phase 11 (runs were taken on the working tree before it was committed)                                                            |

One machine for everything means the services compete for the same CPU and disk, which lowers every
figure compared with separate hosts. Docker Desktop on Windows adds latency to every database call.

## Results with the default settings

From [`results/2026-10-21T07-32-43-634Z.json`](results/2026-10-21T07-32-43-634Z.json) (final code,
dispatcher at its defaults: 20 deliveries in flight, 5 per endpoint, 10 database connections).

| Measure                                    | Result                                         |
| ------------------------------------------ | ---------------------------------------------- |
| Events accepted per second (ingestion)     | 142.9 (3,000 of 3,000 accepted, none rejected) |
| API response time p50 / p95 / p99          | 341 ms / 417 ms / 443 ms                       |
| Deliveries completed per second (dispatch) | 113 (9,000 deliveries in 79.7 s)               |

Delivery latency by offered rate, 3 endpoints, empty backlog at the start:

| Offered events/s | Offered deliveries/s | p50    | p95    | p99    | Reading                       |
| ---------------- | -------------------- | ------ | ------ | ------ | ----------------------------- |
| 20               | 60                   | 465 ms | 628 ms | 666 ms | Keeping up                    |
| 40               | 120                  | 2.2 s  | 3.8 s  | 3.9 s  | Just above capacity: queueing |
| 60               | 180                  | 9.6 s  | 16.3 s | 16.8 s | Over capacity: backlog grows  |
| 80               | 240                  | 12.8 s | 23.6 s | 24.8 s | Over capacity: backlog grows  |

Read it as: on this machine one dispatcher with default settings sustains about 110 deliveries a second
to a tenant with three endpoints. Below that, delivery takes well under a second after the event is
accepted. Above it the system does not drop or fail anything (every delivery of every run succeeded on its
first attempt, with valid signatures); it queues, and latency grows with the backlog. That is the intended
failure mode, and the dispatcher's own settings are the first lever.

## Results with tuned settings

From [`results/2026-10-21T07-38-20-265Z.json`](results/2026-10-21T07-38-20-265Z.json): 50 deliveries in
flight, 20 per endpoint, 20 database connections.

| Measure                                    | Result                             |
| ------------------------------------------ | ---------------------------------- |
| Deliveries completed per second (dispatch) | 151 (9,000 deliveries in 59.6 s)   |
| Latency at 20 events/s (60 deliveries/s)   | p50 451 ms, p95 640 ms, p99 695 ms |

The 40 events/s phase of that run shows p50 740 ms but p95 31.9 s: about a twentieth of the deliveries
waited about 31 seconds before being sent. Every delivery succeeded on its first attempt and no send took
longer than 60 ms, so the wait was before the send, not in a hung request. It did not recur in three
repeats of that rate with the same settings
([`results/2026-10-21T07-41-32-659Z.json`](results/2026-10-21T07-41-32-659Z.json): p95 0.73 to 1.7 s). The
cause is **not known**. One other unexplained stall was seen (a sweep row of 37 deliveries a second where
six repeats of the same setting gave 80 to 91). Both happened on this shared desktop while it ran a
database, a broker and the services at once; neither can be attributed to the code without a cleaner
environment. They are recorded here so that they are not mistaken for a result or forgotten.

## What the measurements found

1. **Adding workers made the system slower** (`sweep-2026-10-21T07-02-58-119Z.json`): four workers
   drained the backlog at 35 deliveries a second against 115 for one, each using 7% of a core. The claim
   picked its candidates before locking them, so concurrent workers picked the same deliveries, the losers
   got nothing and slept. Fixed by serializing claims (migration 0011, ADR-0037); the same sweep afterwards
   (`sweep-2026-10-21T07-23-42-468Z.json`): four workers 88 deliveries a second. It also makes the
   per-endpoint cap exact across workers, where it had been approximate.
2. **The ceiling of about 115 deliveries a second was the per-endpoint cap, not the machine.** Throughput
   did not change with worker concurrency (20, 50, 100) or database pool (10, 20, 50), and the worker used
   between half and seven tenths of a core. With the cap at 5 and 3 endpoints, at most 15 requests are ever in flight, and 15
   divided by the time of one delivery is about 115 a second. Raising the cap to 20
   (`sweep-2026-10-21T07-27-46-443Z.json`) gave 139 a second with the worker at 90% of a core, and a
   second worker 172. The cap exists to protect receivers; the setting is per deployment.
3. **A single dispatcher process is CPU bound at about 140 deliveries a second on this CPU**, roughly
   6.5 ms of CPU per delivery. It scales out by adding workers (172 a second with two on this machine,
   which also runs everything else).
4. **The claim query grows with the backlog**: 5 ms with 5 due deliveries, 15 ms with 500, 18 ms median
   (p95 206 ms) with 4,500. It aggregates every due delivery to choose organizations. At millions of
   deliveries this needs an index-backed organization queue; it is the known limit from Phase 7, now
   measured.
5. **The dispatcher loop slept while work was waiting.** It now waits for a free slot instead. The measured
   effect (103 to 113 deliveries a second between two single runs) is inside the 89 to 117 spread of
   repeated runs of one configuration, so no improvement is claimed from it; the change is kept because
   the old behaviour capped throughput at slots per pause by construction.
6. **Neither PostgreSQL nor DynamoDB Local was the limit**: measured separately on this machine, about
   1,500 to 1,700 committed inserts a second and 500 to 550 DynamoDB Local writes a second, against about
   110 to 140 deliveries a second, each needing one write to DynamoDB and several transactions.

Run-to-run spread on this machine is large: one configuration gave 89 to 117 deliveries a second across
sessions. Differences smaller than that are not findings.

## Known limits of this measurement

- One machine, shared by every component; no network between them.
- DynamoDB Local is not DynamoDB; AWS figures need their own run (Phase 12).
- One tenant. Fairness across tenants is tested for correctness (Phase 7), not measured for speed here.
- Receivers answer instantly from memory; real receivers are slower, which lowers throughput at a fixed
  number of requests in flight.
- Phases last tens of seconds: this is a load test, not a soak test.

## Raw results

| File                                  | What it is                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-10-21T06-41-16-901Z.json`       | First load run, original dispatcher loop and claim                                                                                             |
| `2026-10-21T06-48-29-143Z.json`       | Load run after the loop change, before serialized claims                                                                                       |
| `sweep-2026-10-21T06-54-40-957Z.json` | Concurrency and pool sweep, one worker, before serialized claims                                                                               |
| `sweep-2026-10-21T07-02-58-119Z.json` | One to four workers, before serialized claims (the collapse)                                                                                   |
| `sweep-2026-10-21T07-23-42-468Z.json` | One to four workers after serialized claims                                                                                                    |
| `sweep-2026-10-21T07-27-46-443Z.json` | The per-endpoint cap, after                                                                                                                    |
| `sweep-2026-10-21T07-47-44-780Z.json` | Six repeats of two settings, after (variance; the 37 a second did not recur)                                                                   |
| `2026-10-21T07-32-43-634Z.json`       | Load run, final code, default settings (the table above)                                                                                       |
| `2026-10-21T07-38-20-265Z.json`       | Load run, final code, tuned settings                                                                                                           |
| `2026-10-21T07-41-32-659Z.json`       | Three repeats of 40 events a second, tuned (its ingestion and dispatch figures come from a short 600-event backlog and are not representative) |
