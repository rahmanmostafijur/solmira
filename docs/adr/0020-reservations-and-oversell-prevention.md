# ADR-0020: Reservations, and how overselling is prevented

- **Status:** Superseded by ADR-0023
- **Date:** 2026-09-30

## Context

A reservation promises units to someone: a customer order (phase 6), a trade-show sample set, a
key-account hold. The failure that matters is overselling: two buyers both told "yes" for the
last unit. It happens when "is there enough?" and "take it" are separate steps and another
transaction runs in between (a read-then-write race). The fix must hold across several service
replicas and must not serialize the whole system.

## Decision

**The check and the take are one statement.** Reserving `q` units runs, inside the request's
transaction:

```sql
UPDATE inventory_levels
   SET reserved = reserved + $q, updated_at = now()
 WHERE organization_id = $org AND id = $level
   AND on_hand + 0 >= reserved + $q          -- enough available
   AND reserved + $q >= 0
   AND on_hand + 0 <= 1000000000
RETURNING *;
```

PostgreSQL takes the row lock for the `UPDATE`. A concurrent transaction targeting the same row
waits; when the first commits, READ COMMITTED re-evaluates the second's `WHERE` against the new
row version. If the units are gone it matches zero rows and the service answers
`409 INSUFFICIENT_STOCK`. There is no window between checking and taking, no application lock and
no `SERIALIZABLE` retry loop. The `CHECK (reserved <= on_hand)` is the backstop if code ever
bypasses the guard.

**Holds are rows.** `inventory_reservations` records each hold (level, quantity, `ACTIVE` or
`RELEASED`, a human reference such as an order number, who created and released it). The
`reserved` counter always equals the sum of `ACTIVE` reservations; the test suite checks this.

**Multi-line reservations are all or nothing.** `reserveLines` validates every line, then
applies the guarded `UPDATE`s in ascending level-id order, a single global lock order, so two
concurrent multi-line requests can never hold one row each while waiting for the other's
(deadlock). If any line is short, every short line is reported (`lines.N.quantity`) and the
transaction rolls back, so nothing is half-reserved. `reserveLines(tx, …)` runs in the caller's
transaction: order confirmation in phase 6 will call it inside the same transaction that moves
the order to `CONFIRMED`.

**Release** locks the reservation row, returns if it is already `RELEASED` (idempotent), applies
a `RELEASE` movement (`reserved - q`), and marks the row released. Consuming a reservation when
goods ship arrives with fulfillment (phase 6).

**Evidence.** Integration tests against real PostgreSQL fire 30 concurrent single-unit
reservations at 10 units (exactly 10 succeed, 20 get `409`, `reserved = 10`), 12 concurrent
3-unit requests at 10 units (exactly 3 succeed), 20 concurrent opposite transfers (all succeed,
no deadlock, total conserved) and 10 concurrent write-offs at 5 units (exactly 5 succeed).

## Alternatives considered

- **`SELECT … FOR UPDATE`, check in code, then `UPDATE`.** Correct, but two round trips while
  holding the lock and more code to get wrong. The single guarded `UPDATE` is shorter and
  equivalent.
- **`SERIALIZABLE` isolation.** Also correct, but conflicts surface as serialization failures
  that every caller must retry. Rejected for the hot path.
- **Optimistic concurrency with a `version` column.** Good for human edits (last write loses);
  under a burst of buyers it turns into retry storms on the same row. Rejected here.
- **Redis or advisory locks.** A second system that can disagree with the database, and still
  needs the database check. Rejected.
- **Reservations with expiry.** Useful for checkout carts; nothing here needs it yet. An
  `expires_at` column and a sweeper can be added without changing the guard.

## Tradeoffs

- Writers to the same level serialize on its row. Throughput per SKU and warehouse is bounded by
  how fast one row can be updated, far above the expected load for a back-office system.
- Reserving is not idempotent yet (ADR-0019): a retried request may create a second hold. The
  phase 6 `Idempotency-Key` mechanism closes this before orders depend on it.
- Counter and ledger consistency is guaranteed by the single write path and verified by tests,
  not by a database trigger. A deferred constraint trigger could add a database-level check if
  hand-written maintenance queries ever become common.

## Consequences

**Positive**

- No overselling, proven under concurrency against the real database, with no extra
  infrastructure.
- One reusable, transaction-scoped reservation function for orders.

**Negative**

- A caller that already holds level locks must not call `reserveLines` in a different order;
  phase 6 has to keep the lock order global (order lines are sorted the same way).

## Failure, scaling, security and operational implications

- **Failure:** shortage → `409` with per-line details; any failure rolls back the whole request.
- **Scaling:** no global lock; contention is per level row only.
- **Security:** reservations are tenant rows under RLS; releasing another organization's
  reservation is a `404`.
- **Operational:** `reserved` can be reconciled against active reservations and the ledger with
  one query (see [inventory.md](../architecture/inventory.md)).
