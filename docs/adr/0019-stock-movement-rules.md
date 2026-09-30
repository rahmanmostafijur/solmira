# ADR-0019: Stock movement rules: adjustments, counts and transfers

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

With counters and a ledger in place (ADR-0018), the service needs rules for who may change stock,
in which direction, and for which catalog records. Warehouse staff receive goods before purchase
orders exist (phase 5), count shelves, write off damage, and move stock between sites. Mistakes
here either lose units silently or let the API promise units that do not exist.

## Decision

**Adjustments** (`POST /inventory/adjustments`, permission `inventory.adjust`) always carry a
reason, and the reason fixes the direction (`ADJUSTMENT_DIRECTIONS` and `adjustmentIssue` in
`@solmira/contracts`, enforced by the request schema and reused by the console):

| Reason                          | Direction | Input                 |
| ------------------------------- | --------- | --------------------- |
| `RECEIVED`, `FOUND`, `RETURNED` | adds      | `quantityChange > 0`  |
| `DAMAGED`, `LOST`               | removes   | `quantityChange < 0`  |
| `CORRECTION`                    | either    | `quantityChange ≠ 0`  |
| `COUNT` (stocktake)             | either    | `countedQuantity ≥ 0` |

- **A count states what is on the shelf.** The service locks the level and computes
  `countedQuantity - on_hand` itself, so a reservation or receipt that lands between reading the
  screen and pressing save is never overwritten. A count equal to the current quantity changes
  nothing and writes no movement.
- **On hand never falls below reserved.** Reserved units are promised; removing them requires
  releasing the reservation first. The answer is `409 INSUFFICIENT_STOCK` with the available
  quantity (or, for a count, the reserved quantity) in the field details.
- **A ceiling of 1,000,000,000 units per level** (`MAX_STOCK_QUANTITY`), in the guard and in a
  `CHECK`, keeps counters far from the `integer` limit: an increase past it is a `400`, never an
  overflow error. One request moves at most 1,000,000 units.

**Catalog rules for holding stock** are owned by the catalog (`warehouses/stock-references.ts`)
and called by inventory:

- Adding stock (positive adjustments, the destination of a transfer) and reserving require an
  `ACTIVE` warehouse and an `ACTIVE` variant whose product is not `ARCHIVED`. Receiving stock for
  a `DRAFT` product is allowed: stock usually arrives before launch.
- Taking stock out (negative adjustments, the source of a transfer, releases) is always allowed,
  so a deactivated warehouse can be emptied and a retired variant written off.
- Warehouses and variants that ever held stock cannot be deleted (`ON DELETE RESTRICT`); both
  already retire through statuses rather than deletion (ADR-0013, ADR-0016).

**Transfers** (`POST /inventory/transfers`, `inventory.adjust`) move available units from one
warehouse to another in one transaction: a `TRANSFER_OUT` and a `TRANSFER_IN` movement share one
transfer id. The two level rows are updated in ascending level-id order (plain string comparison,
never locale-dependent collation), so two opposite transfers running at the same time (A→B and
B→A) lock in the same sequence and cannot deadlock. Transfers are **immediate**; goods in transit
are not modeled.

**Reorder points** are configuration on the level (`PATCH /inventory/levels/:id`), not stock
movements: they write no ledger row. When available stock crosses from above the reorder point to
at or below it (through any movement, or by raising the reorder point), `inventory.low_stock` is
written to the outbox once; it fires again only after the level recovers and crosses again.

**Permissions** come from the existing catalog: `inventory.read` (every operational role),
`inventory.adjust` and `inventory.reserve` (managers and staff; admins and owners hold all).

## Alternatives considered

- **A signed change without reasons.** Faster to build, useless for audit and for spotting
  shrinkage. Rejected.
- **Counts as a delta computed by the client.** The client's `on_hand` is stale by the time the
  request arrives. Rejected in favour of computing under lock.
- **Allow on hand below reserved and resolve later.** That is overselling by another name.
  Rejected.
- **In-transit transfers** (ship, then receive). Real, but it needs its own document, statuses
  and a location for units on the road. Deferred until fulfillment needs it; immediate transfers
  are correct for moves completed within a working day.
- **Block all stock changes for inactive warehouses and variants.** Would trap stock in a closed
  site. Rejected; only additions are blocked.

## Tradeoffs

- Adjustments and reservations are not idempotent yet: a client that retries a timed-out request
  may apply it twice. The console disables the action while a request is in flight. An
  `Idempotency-Key` mechanism lands with order creation (phase 6) and will cover these endpoints
  before orders reuse the reservation code.
- The actor on a movement is a user id. Showing names needs the member directory, which only
  holds warehouse managers today (ADR-0016); names arrive with member events (phase 7).

## Consequences

**Positive**

- The reason and direction of every manual change are explicit and validated by one shared
  function, used by the API and the console.
- Counting, receiving and reserving the same level at the same time cannot lose an update.

**Negative**

- Staff must release a reservation before writing off reserved units. That is deliberate.

## Failure, scaling, security and operational implications

- **Failure:** validation errors are `400` with field paths; shortages are `409
INSUFFICIENT_STOCK`; a warehouse or variant of another organization is a `400` "not found" on
  the field, never a stock number.
- **Scaling:** an adjustment locks one row; a transfer locks two, in a fixed order.
- **Security:** tenant from the token only; RLS and composite foreign keys under every write.
- **Operational:** until purchase orders exist, receipts are `RECEIVED` adjustments; phase 5
  replaces them with PO receiving, which writes its own movement type.
