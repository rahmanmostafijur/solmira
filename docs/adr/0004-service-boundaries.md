# ADR-0004: Service boundaries along consistency boundaries

- **Status:** Superseded by ADR-0024
- **Date:** 2026-09-29

## Context

Solmira must decide how many deployable services to run and where to cut them. This ADR is also
the answer to "why microservices at all?", so it states the costs as plainly as the benefits.

The costs of any service split are real and permanent:

- **Operational overhead:** each service is another image, pipeline, database, connection pool,
  dashboard, alarm set and on-call surface.
- **Distributed debugging:** a failed order confirmation may span gateway, operations-service,
  RabbitMQ and three consumers; without correlation IDs and tracing it is guesswork.
- **Eventual consistency:** anything across a service boundary is no longer covered by a database
  transaction, so the business must tolerate a window where two services disagree.

The most correctness-sensitive rule in the domain is **no overselling**. Confirming an order
must move the order `PENDING -> CONFIRMED` and increase `inventory.reserved` for every line, or do
neither. Receiving a purchase order must increase `purchase_order_items.received_quantity`,
`inventory.on_hand` and append `inventory_movements` together.

## Decision

Cut services along **consistency boundaries**: data that must change atomically lives in one
service and one database; everything else communicates by events (ADR-0009).

| Service      | Owns                                                                               | Reason for the seam                                                                 |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| identity     | users, orgs, memberships, roles, sessions, invitations                             | Security-critical, sole holder of the JWT signing key, different change cadence     |
| operations   | catalog, suppliers, customers, warehouses, inventory, POs, orders, shipments       | Order confirmation, reservation and receiving must be one ACID transaction          |
| notification | notifications, preferences, delivery attempts, sockets                             | Pure consumer; scales with connected clients; its failure must never block an order |
| analytics    | daily_sales, daily_product_sales, inventory_value_snapshots, fulfillment_durations | Heavy aggregate reads must not share a database with the order path                 |
| audit        | audit_logs, DynamoDB event history                                                 | Append-only, high volume, long retention, compliance access                         |

operations-service is a **modular monolith**: `catalog`, `inventory`, `purchasing`, `orders`,
`fulfillment` are NestJS modules (ADR-0002) that call each other only through exported services,
never another module's tables. Every seam we did cut is one where eventual consistency is
already acceptable to the business: a notification or dashboard tile arriving a second late is
fine; a reservation arriving a second late is an oversell.

## Alternatives considered

- **One service per noun (order-service, inventory-service, product-service, ...).** Rejected.
  Confirming an order would become a saga: order-service marks `CONFIRMING`, calls or messages
  inventory-service to reserve, waits, then confirms or compensates. Two buyers racing for the
  last unit would be resolved by message ordering and compensation logic instead of a single
  guarded `UPDATE inventory ... WHERE on_hand - reserved >= $q`. Partial failures (reserved but
  confirmation lost, confirmation retried after reservation expiry) each need a compensating
  path and a test. That is the most expensive possible place to introduce distribution.
- **A single monolith for everything.** Simplest to run, and honestly adequate for the load.
  Rejected because analytics rollups and audit writes would compete with the order path on one
  database, notification outages (SMTP, sockets) would share a process with order confirmation,
  and the identity signing key would live in the same blast radius as the whole app.
- **Serverless functions per endpoint.** Fine-grained scaling, but cold starts, per-function
  connection pools against PostgreSQL, and no home for the modular-monolith transaction.

## Tradeoffs

- We accept five services' worth of ops cost to buy fault isolation for side effects, workload
  isolation for analytics, and a smaller blast radius for identity.
- operations-service stays large; its internal module discipline must be enforced or it becomes
  a big ball of mud.

## Consequences

**Positive**

- The oversell-critical path is one transaction in one database, testable with a concurrency
  integration test (phase 4).
- Notification, analytics and audit can be down, slow or redeployed without affecting order
  intake; they catch up from their queues.

**Negative**

- Read models (analytics, audit) lag the source of truth; the UI must present them as such.
- Cross-service reads (web showing actor names from identity on an order) require composition in
  the client or denormalized fields carried in events.

## Extraction criteria (when a module may leave operations-service)

A module is extracted only when **all** hold: (1) it no longer needs to share a transaction with
another module, i.e. its invariants can be protected locally and its interactions tolerate
events; (2) it has a measurably different scaling or availability profile (for example catalog
read traffic 20x order writes); (3) a team or release cadence benefits from owning it
separately; (4) its outbound events already exist, so consumers need no changes. `catalog` is the
likeliest first candidate (read-heavy, orders already snapshot SKU/name/price). `orders` and
`inventory` stay together unless reservation moves to a dedicated ledger with its own guarantees.

## Failure, scaling, security and operational implications

- **Failure:** only operations and identity are on the synchronous request path for writes;
  consumer outages degrade freshness, not correctness.
- **Scaling:** each service scales on its own signal (HTTP latency, socket count, queue depth).
- **Security:** only identity holds the private signing key; others hold the public key.
- **Operational:** correlation IDs from day one, OpenTelemetry in phase 10, per-service DLQ
  runbooks; this is the price of the seams and is budgeted in the roadmap.
