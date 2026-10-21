# ADR-0037: Serialized claims and a worker loop that waits for a free slot

- **Status:** Accepted (amends ADR-0031 and ADR-0033)
- **Date:** 2026-10-21

## Context

The load test (Phase 11, `docs/performance`) drained one backlog with one to four dispatcher workers.
Four workers were three times slower than one (35 against 115 deliveries a second), and each used about
7% of a core: they were waiting, not working.

The claim function picked its candidate deliveries first and locked them afterwards (`FOR UPDATE SKIP
LOCKED`). Concurrent callers picked the same head-of-queue rows, the losers locked nothing and got an
empty result, and an empty claim sleeps for the poll interval. Adding workers therefore added empty
claims. The same structure made the per-endpoint cap approximate across workers (ADR-0033): two calls
could each count the same leases.

Separately, a worker slept for the poll interval whenever a claim had filled its free slots, so it also
slept while work was waiting.

## Decision

- **Claims take turns.** `claim_due_deliveries` starts with a transaction advisory lock. A call sees the
  leases of the call before it, so no call is empty because of another, and the per-endpoint cap is exact
  across workers. A claim takes milliseconds (5 ms with a small backlog, about 18 ms at 4,500 due
  deliveries on the measured machine) and never waits on delivery work, only on another claim.
- **The worker waits for a slot, not for a pause.** With every slot busy it wakes when one finishes; it
  sleeps only after an empty claim. After a non-empty claim it claims again at once.

## Alternatives considered

- **Lock-aware selection inside one query.** `FOR UPDATE SKIP LOCKED` cannot be combined with the window
  functions and aggregates that implement the per-organization and per-endpoint caps, which are the point of
  ADR-0033.
- **Random offsets or per-worker partitions of the queue.** Spreads contention without removing it, and
  cannot keep the caps exact.
- **Do nothing and add workers.** Measured to make things worse.

## Consequences

Claim throughput is bounded by one claim at a time. At the measured cost that allows several hundred
deliveries a second per database, well above what the rest of the pipeline reached on the test machine, but
it is a ceiling: beyond it the lock can be split by hash of the organization, which keeps fairness inside
each slice. Four workers no longer collapse (88 deliveries a second against 35 before, one worker 115 in the same
sweep, and single-worker runs of one configuration varied from 89 to 117 between sessions). Whether more
workers add throughput depends on what else is shared; on the test machine that is a CPU shared with the
database and the receivers.

## Failure, scaling, security and operational implications

The lock is held for the statement and released at commit or crash, so a dead worker cannot hold it. A
claim that waits behind another cannot be starved forever: advisory locks queue. The function keeps its
privileges and stays `SECURITY DEFINER`; the lock key is a constant.
