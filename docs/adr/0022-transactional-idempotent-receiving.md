# ADR-0022: Receiving: one transaction, row locks and an Idempotency-Key

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Receiving is where purchasing touches physical reality: goods arrive, an operator counts them,
and the system must record that exactly once. A receipt changes five things: the order lines'
received quantities, the order's status, the stock level, the inventory ledger, and the receipt
record itself. Three failure modes matter:

1. **Partial writes.** Stock goes up but the order still shows the units as outstanding (or the
   reverse), and someone receives them again.
2. **Races.** Two operators receive the last 20 units at the same moment and 40 are accepted.
3. **Retries.** A timeout on a slow warehouse network makes the client resend, and the same
   pallet is received twice.

Phase 4 recorded that stock writes were not yet retry-safe (ADR-0019, ADR-0020).

## Decision

**One transaction for everything.** `ReceivingService.receiveInTransaction` runs in a single
tenant-scoped PostgreSQL transaction:

1. Lock the order row (`SELECT … FOR UPDATE`).
2. If the `Idempotency-Key` was already used in this organization, return that receipt (see
   below); nothing else happens.
3. Check the status (`APPROVED` or `PARTIALLY_RECEIVED`), lock the warehouse row `FOR SHARE`
   (it must be active), check each line belongs to this order and does not exceed what remains
   (`409` with `lines.N.quantity: Only 20 remaining`), and check variants are still active.
4. Insert the receipt row (key, request fingerprint, receiver, time, note).
5. Add the quantities to the order lines with a guarded
   `UPDATE … WHERE received_quantity + q <= ordered_quantity`.
6. Add the stock through the Phase 4 write path `applyStockChange` (movement type
   `PURCHASE_RECEIPT`, reference = receipt id): missing levels are created in variant order,
   levels updated in level-id order.
7. Insert the receipt lines, each pointing at the ledger row it produced.
8. Set the order's status from the aggregate of its lines (`PARTIALLY_RECEIVED` or `RECEIVED`).
9. Write `inventory.received` and `purchase_order.partially_received` / `.received` to the
   outbox.

Any failure (a check, the stock ceiling on the last line, a crash) rolls all of it back. There
is no compensation code because there is nothing to compensate. A test forces a failure on the
second of two lines and proves no line, stock, ledger row, receipt or event remains.

**Concurrency.** The order row lock serializes every receipt, edit, approval and cancellation
of one order, so step 3 reads a stable "remaining" and two operators cannot both take the last
units: the second waits, then sees the first's committed quantities and gets `409`. The guarded
`UPDATE` in step 5 and `CHECK (received_quantity <= ordered_quantity)` hold even if that
reasoning were ever broken. Lock order is always order row → warehouse (share) → level rows
(variant/level order); no code path locks levels and then an order, so receipts cannot deadlock
with each other, with reservations or with transfers. Tests: 10 concurrent receipts of 5 against
20 remaining accept exactly 4; a receipt racing a cancellation never lets both win; first
receipts of the same new variants in opposite line order all succeed.

**Idempotency, implemented for receipts.** `POST /purchase-orders/:id/receipts` requires an
`Idempotency-Key` header (8–100 characters of `[A-Za-z0-9_-:.]`, typically a UUID made when the
receiving form opens). The key and a SHA-256 fingerprint of the request (order id, lines in a
canonical order, note) are stored on the receipt under `UNIQUE (organization_id,
idempotency_key)`.

- Same key, same fingerprint: the original receipt is returned with `200` and
  `replayed: true`; no stock moves. This also works after the order has since been received or
  cancelled.
- Same key, different request (other quantities, other order): `409`, "use a new key".
- Concurrent duplicates on the same order serialize on the order lock; the second sees the
  first's committed receipt in step 2. Duplicates on different orders meet at the unique
  constraint; the loser's transaction rolls back and the service re-reads the key.
- The console keeps the key for a retry after a timeout, a network error, a 5xx, a 408 or a 429,
  and makes a new one after a success or a definite refusal.

Receipts and receipt lines are append-only: `SELECT` and `INSERT` RLS policies only, and
triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` for every role. A wrong receipt is corrected
with an inventory adjustment, never by editing history.

**What remains for Phase 6.** A general mechanism for other writes (order creation first, then
inventory adjustments and reservations): a shared idempotency table keyed by organization, key
and endpoint, storing the response for replay, with expiry. Receipts keep their own column
because the key belongs to the business record it created and must live as long as the receipt.

## Alternatives considered

- **Update the order, then call inventory.** Two commits: a crash between them leaves the order
  and stock disagreeing. Rejected; this is what one database per consistency boundary is for.
- **`SERIALIZABLE` isolation instead of locks.** Correct, but conflicts surface as serialization
  failures that every caller must retry. Rejected; the explicit lock is simpler to reason about.
- **Optional idempotency key.** A client that forgets it can double-receive. The key is cheap to
  send; making it required makes retries safe by construction.
- **Deduplicating by content** (same order, same lines, within N minutes). Two genuine pallets
  of 10 look identical. Rejected; only the client knows whether it is retrying.
- **Storing responses for replay.** The receipt itself is the response; it is re-read, so the
  replay also shows the order's current state.

## Tradeoffs

- Receipts of one order are strictly one at a time. Receipts of different orders run in
  parallel, contending only on shared stock levels.
- Idempotency keys are kept forever with their receipts.
- Variant status is checked, not locked: a variant archived in the same instant as a receipt may
  still receive that one receipt. Status is policy, not integrity; the counts stay correct.

## Consequences

**Positive**

- A receipt is all or nothing, cannot over-receive, and cannot be applied twice by a retry.
- Every unit received is traceable from order line to receipt line to ledger row.

**Negative**

- Clients must generate and keep an idempotency key per receiving attempt.

## Failure, scaling, security and operational implications

- **Failure:** over-receipt and wrong status are `409`; unknown lines are `400`; a missing or
  malformed key is `400`; a database crash mid-receipt leaves nothing behind.
- **Scaling:** the order lock is held for one receipt's duration (a few round trips); receipts
  load in two queries whatever their number.
- **Security:** keys are scoped per organization; another organization reusing a key gets its
  own namespace, and a replay only ever returns the caller's own receipt.
- **Operational:** the integration suite ends with a consistency check (lines = receipt lines =
  ledger rows = stock), and the same queries work as a production reconciliation job.
