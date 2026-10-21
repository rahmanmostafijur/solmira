# Phase 11: Testing depth, load and chaos

Branch `phase-11/testing-depth`, merged into `pivot/webhook-platform`.

## What changed

- **`tests/resilience`** (new workspace package): a harness that runs the real ingest service and
  dispatcher as processes against a throwaway database, a broker vhost of their own, Redis and DynamoDB
  Local, with receivers that verify every signature, and can stop the broker and kill the dispatcher.
- **Four chaos scenarios** ([`docs/resilience`](../resilience/README.md)): an endpoint down, an endpoint
  slow, a broker restart, a worker crash mid-delivery. Each asserts no event is lost; the two isolation
  scenarios compare the healthy endpoints with a control burst.
- **A load test and a sweep** ([`docs/performance`](../performance/README.md)) that write their results,
  with the environment they ran on, to `docs/performance/results`. Only measured figures appear in the docs.
- **Two findings from measuring, both fixed** (ADR-0037):
  - more dispatcher workers made draining slower (four workers at 35 deliveries a second against 115 for
    one): the claim picked before it locked. Claims now take turns through an advisory lock (migration
    0011), which also makes the per-endpoint cap exact across workers;
  - the worker loop slept for the poll interval while work was due; it now waits for a free slot.
- The throughput ceiling of the defaults (about 115 deliveries a second for a tenant with three endpoints)
  was identified as the per-endpoint cap of 5, not CPU, database or DynamoDB; the document says how to tune
  it and what each setting costs.
- CI: a `chaos` job. The load test is not in CI: its figures describe one machine.

## Decisions

See ADR-0037. Also: results are kept as raw JSON with the environment; unexplained outliers are recorded
as unexplained instead of being dropped or explained away.

## Tests added

- chaos: endpoint down, endpoint slow, broker restart, worker crash (4 scenarios, about two minutes).
- ingest and dispatcher integration suites unchanged and passing with the new claim and loop.

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip && pnpm turbo run lint typecheck test build
pnpm infra:up
export TEST_ADMIN_DATABASE_URL=postgres://solmira:<password>@localhost:<port>/postgres
for s in service-kit identity-service ingest-service dispatcher notification-service analytics-service audit-service; do
  pnpm --filter @solmira/$s test:integration; done
pnpm --filter @solmira/resilience chaos
```

Local result of the final run: 47 turbo tasks passed; integration suites 12, 68, 150, 17, 11, 10 and 26
tests passed; the four chaos scenarios passed; the browser test passed with the new claim. One earlier full
run of the ingest and dispatcher suites, taken right after a load run, showed failures that did not recur in
five later full runs of the same suites; the cause was not found and is recorded rather than dismissed. CI
runs the same checks; the GitHub CLI is not authenticated here, so CI has not been observed.

## Known limitations

- Figures are from one shared desktop machine; AWS figures come with Phase 12.
- Two stalls on that machine are unexplained (see `docs/performance`).
- The claim query still grows with the backlog (measured: 5 ms to 18 ms from 5 to 4,500 due deliveries).
- One tenant in the load test; cross-tenant fairness is covered for correctness, not speed.
