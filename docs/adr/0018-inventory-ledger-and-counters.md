# ADR-0018: Inventory as counters plus an append-only ledger

- **Status:** Superseded by ADR-0023
- **Date:** 2026-09-30

## Context

Phase 4 adds stock: how many units of each variant sit in each warehouse, how many of those are
promised, and every change that led there. Two needs pull in different directions:

- **Fast, safe decisions.** "Can I reserve 3 of SKU-100 in WH-DHK?" is asked on the order path
  (phase 6) and must be answered and acted on atomically under concurrency.
- **An auditable history.** Operations, finance and audit (phase 10) need to know who changed
  what, when, why, and what the balance was afterwards. A number that is simply overwritten
  cannot answer "where did 40 units go?".

## Decision

Three tables in operations-service, all tenant-owned (`organization_id`, unique
`(organization_id, id)`, composite foreign keys, Row Level Security):

- **`inventory_levels`**: one row per `(organization_id, warehouse_id, variant_id)` with counters
  `on_hand` and `reserved`, a database-generated `available = on_hand - reserved`, and an
  optional `reorder_point`.
  `CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand)` makes a negative or oversold
  balance impossible to store, whatever the code does.
- **`inventory_movements`**: the ledger. One row per change, with both signed deltas
  (`on_hand_change`, `reserved_change`), both balances after the change, the type (`ADJUSTMENT`,
  `TRANSFER_OUT`, `TRANSFER_IN`, `RESERVATION`, `RELEASE`), the reason for adjustments, a
  reference (`TRANSFER` / `RESERVATION` + id), a note, the actor and the correlation id.
  A `CHECK` ties each type to exactly one counter and one direction. Ordering comes from a
  database identity column `sequence`, assigned at insert while the level's row lock is held.
- **`inventory_reservations`**: holds (ADR-0020).

**Append-only is enforced by the database.** The ledger has only `SELECT` and `INSERT` RLS
policies, so the runtime role can never update or delete a movement (such statements match zero
rows), and a trigger raises on `UPDATE`, `DELETE` and `TRUNCATE` for every role, the owner
included. A mistake is corrected with a new, compensating movement.

**One write path.** Every change goes through `applyStockChange` (`stock-ledger.ts`): a guarded
single-statement `UPDATE` of the counters, then the ledger row with the returned balances, then
a low-stock check, all in the caller's transaction. The ledger and counters therefore commit
together or not at all.

**Levels are created lazily** by the first stock-adding operation (`INSERT … ON CONFLICT DO
NOTHING` on the unique key), not when a warehouse or variant is created.

## Alternatives considered

- **Ledger only (event sourcing), balances computed by `SUM`.** A pure audit trail, but every
  reservation would have to lock and aggregate history, and the oversell guard becomes a
  serializable-isolation problem. Rejected for the hot path; the ledger can still rebuild every
  counter, and a test proves it does.
- **Counters only.** Fast, but no history. Rejected.
- **Counters maintained by a trigger on the ledger.** Keeps one source of truth, but hides the
  guard in a trigger, makes the failure "insufficient stock" a database exception, and still
  needs the lock. The explicit guarded `UPDATE` is easier to read, test and reuse.
- **A `damaged` counter** (listed in the original architecture sketch). Damaged units are written
  off with an `ADJUSTMENT` of reason `DAMAGED`; quarantine locations can arrive later as their
  own warehouse or bin. YAGNI for now.
- **Order movements by `created_at`.** Found wrong by a test: `now()` is the transaction start,
  and concurrent transactions apply in lock order, not start order. Hence `sequence` (and
  `clock_timestamp()` for `created_at`).

## Tradeoffs

- Two representations of the same truth must agree. The single write path makes that the
  default, and the integration suite checks after every run that each level equals the sum of
  its movements and its latest movement's balances.
- The ledger grows without bound. Partitioning by time or archiving to the event history
  (phase 10) is the plan when volume requires it.

## Consequences

**Positive**

- Negative stock and `reserved > on_hand` are impossible at the storage layer.
- Every unit is traceable: who, when, why, reference, correlation id, balance after.

**Negative**

- Counters are hot rows: all writers to one SKU in one warehouse serialize on one row lock.
  That is the intended behaviour, and the throughput ceiling is per SKU, not global.

## Failure, scaling, security and operational implications

- **Failure:** a failed guard returns no row and the caller raises `409 INSUFFICIENT_STOCK`; the
  transaction rolls back, including any level it created.
- **Scaling:** indexes lead with `organization_id`; the ledger list uses
  `(organization_id, inventory_level_id, sequence DESC)`; the low-stock filter has a partial
  index covering only levels at or under their reorder point.
- **Security:** RLS on all three tables; the ledger cannot be rewritten even by a compromised
  runtime credential.
- **Operational:** reconciliation is a query (sum of deltas per level versus counters), shown in
  [inventory.md](../architecture/inventory.md).
