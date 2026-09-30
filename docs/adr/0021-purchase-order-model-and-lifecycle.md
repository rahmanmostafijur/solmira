# ADR-0021: Purchase orders: model, lifecycle and money

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Phase 5 lets an organization buy stock from its suppliers: draft an order, have it approved,
receive the goods into a warehouse. Purchasing touches suppliers, warehouses, variants and
inventory, and receiving must change inventory atomically with the order (ADR-0022). The model
must make wrong states hard to store, keep an honest history, compute money exactly, and keep
the person who spends money from also approving it.

## Decision

**Boundary.** Purchasing is a module of operations-service, not a service. Receiving changes
order lines and stock in one transaction, which is only possible inside one database
(ADR-0004). Purchasing reads suppliers, warehouses and variants through catalog-owned rule
functions (`supplier-references.ts`, `purchasable-variants.ts`, `stock-references.ts`).

**Tables** (all tenant-owned, RLS, composite foreign keys):

- `purchase_orders`: number, supplier, warehouse, status, currency, expected delivery date,
  notes, stored totals, and who/when for creation, submission, approval, receipt and
  cancellation.
- `purchase_order_items`: product, variant, ordered and received quantities, unit cost, tax rate
  and the line's stored amounts. The foreign key `(organization_id, product_id, variant_id) →
product_variants (organization_id, product_id, id)` makes "variant of another product" and
  "variant of another organization" impossible to store; the product id is derived on the
  server, never taken from the client. One line per variant per order.
- `purchase_order_counters`: one row per organization and year, behind the numbers.
- Receipts: see ADR-0022.

**Numbers.** `PO-2026-000001`: the year (UTC) and a per-organization sequence, taken with
`INSERT … ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING` in the creating
transaction. Unique per organization (`purchase_orders_org_number_key`); other organizations
count independently. The UUID stays the internal key and the URL id; the number is what people
say and print.

**No supplier or warehouse snapshots.** Orders reference suppliers and warehouses by key and
join them for display. Both are master data that is deactivated, never deleted (`RESTRICT`),
so the reference always resolves, and nothing today needs "the name as it was when ordered".
If a printed document or an integration needs that, a snapshot column is added then.

**State machine** (`PURCHASE_ORDER_TRANSITIONS` in `@solmira/contracts`, enforced by the API
under a row lock on the order, and by timestamp `CHECK`s in the database):

```
DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──receipt──▶ PARTIALLY_RECEIVED ──receipt──▶ RECEIVED
  │                   │                     │ └───────────receipt of everything──────────────────────▲
  └──────cancel───────┴───────cancel────────┴────────────cancel (closes the rest)──────▶ CANCELLED
```

- Each move is an explicit action endpoint with its own permission: `POST …/submit`
  (`purchase_orders.submit`), `…/approve` (`.approve`), `…/cancel` (`.cancel`, reason
  required), `…/receipts` (`.receive`). Status is never a writable field.
- **Drafts** may change anything, including lines. After submission only `notes` and
  `expectedDeliveryDate` may change (a supplier moving the date is normal); every other field
  answers `409` with `Locked after submission` per field. Closed orders change nothing.
- **Submission** re-validates the order: at least one line, active supplier, active warehouse,
  active variants, totals within limits. Approval re-checks supplier and warehouse.
- **Separation of duties:** the approver may not be the user who created or submitted the
  order, whatever their permissions (`403`). One-person organizations therefore need a second
  member to approve; that is the point of approval.
- **Cancelling** is allowed from every open state and requires a reason. On a partially
  received order it closes the outstanding quantity; received stock and receipts stay.
- A draft's currency cannot change once it has lines: their costs are in the old currency.

**Money.** Integer minor units in PostgreSQL `bigint` and TypeScript `number`, the project
convention. Limits (unit cost ≤ 10¹⁰, line ≤ 10¹², order ≤ 10¹⁴) keep every value far below
2⁵³, so numbers stay exact; `lineAmounts` computes with `BigInt` (subtotal = quantity × unit
cost; tax = subtotal × rate in basis points, rounded half-up to the minor unit) and reports
anything past exact range as too large. Order totals are summed from the stored lines by the
database in the statement that writes them. A client never sends a total. The database checks
`subtotal = quantity × unit cost`, `line total = subtotal + tax` and
`order total = subtotal + tax + shipping`. Currencies are never converted or summed together.

**Permissions** added: `purchase_orders.update`, `.submit`, `.cancel`, next to the existing
`.read`, `.create`, `.approve`, `.receive`. Managers, admins and owners hold all; staff read and
receive; viewers read.

## Alternatives considered

- **A purchasing microservice.** Would turn receiving into a distributed transaction or a saga
  with compensating stock movements. Rejected (ADR-0004).
- **`PATCH { status }`.** One endpoint for five business actions with different permissions and
  rules, and no place to say which one the caller meant. Rejected for explicit actions.
- **A PostgreSQL sequence per organization, or `max(number) + 1`.** Per-tenant sequences are an
  administrative burden; `max + 1` races. The counter row is locked briefly, by order creation
  only.
- **`numeric` money or floats.** `numeric` would work but needs string handling throughout
  TypeScript; floats are wrong. Integer minor units match the rest of the system.
- **Order-level tax.** Suppliers mix taxable and exempt goods; a per-line rate is the smallest
  model that handles it.
- **Letting owners approve their own orders.** Convenient, and exactly the control approval
  exists for. Rejected; a per-organization setting can come if small customers ask.

## Tradeoffs

- Order creation serializes per organization on the counter row for a few milliseconds.
- There is no "return to draft" for a submitted order; the approver cancels it and the buyer
  creates a new one.
- Actors are stored as user ids; the console shows names where it can.

## Consequences

**Positive**

- Invalid states (receiving an unapproved order, received above ordered, wrong-tenant or
  wrong-product lines, totals that do not add up) cannot be stored.
- Every step of every order is attributable and timestamped.

**Negative**

- One-person organizations cannot complete a purchase order alone.

## Failure, scaling, security and operational implications

- **Failure:** invalid transitions are `409 CONFLICT`; invalid references are `400` on the
  field; other tenants' ids are `404` or "not found", never confirmed.
- **Scaling:** lists use `(organization_id, status | supplier_id | warehouse_id, created_at)`
  indexes and a trigram index for number search; line counts come from an index-backed
  subquery in the same statement.
- **Security:** tenant from the token, RLS and composite keys under every table, one explicit
  permission per action, separation of duties in the service.
- **Operational:** purchase permissions changed; identity's `db:migrate` re-syncs roles.
