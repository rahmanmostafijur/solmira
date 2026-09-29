# ADR-0013: Catalog modeling: products, variants, categories and suppliers

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

Phase 3 adds the catalog that every later phase depends on: inventory is kept per variant
(phase 4), purchase orders buy variants from suppliers (phase 5) and customer orders sell them
(phase 6). The shape chosen now is expensive to change once stock and orders reference it. The
forces:

- Most B2B catalogs have "one product, many sellable options" (sizes, colours, pack sizes), but a
  large share of items are simple products with a single option.
- Once something has been sold, history must stay intact: an order line must keep pointing at a
  real row, and a later edit must not rewrite what a customer bought.
- Every row belongs to exactly one organization, and a reference must never cross tenants, even
  with a guessed UUID (ADR-0006, ADR-0012).
- Search, filtering and sorting run on every list page, so the model must be indexable.

## Decision

- **Product → variants.** A `product` holds shared, descriptive data (name, brand, description,
  category, supplier, base price and cost, tax category, dimensions). A `product_variant` is the
  sellable unit: its own SKU, optional barcode, a small flat `attributes` object
  (`{ size: "42", color: "Black" }`, at most 10 keys), and an optional price, cost and weight that
  override the product's. `effectivePrice = variant.price ?? product.basePrice` is computed by the
  API, never stored. A simple product is a product with one variant; creating a product can
  create that first variant in the same transaction (`initialVariant`).
- **Lifecycles, not deletes.** Products move through `DRAFT → ACTIVE ⇄ INACTIVE → ARCHIVED`,
  with `ARCHIVED → INACTIVE` as the only way back and no path back to `DRAFT`
  (`PRODUCT_STATUS_TRANSITIONS` in `@solmira/contracts`, shared by the API and the UI). Variants
  have `ACTIVE ⇄ INACTIVE → ARCHIVED`. `DELETE /products/:id` archives. An `ACTIVE` product
  must keep at least one `ACTIVE` variant: activation and variant deactivation both check this
  under a row lock on the product. `archived_at` is set if and only if the status is `ARCHIVED`
  (`products_archived_at_check`).
- **Categories** form a tree of at most three levels (`MAX_CATEGORY_DEPTH`), stored as an
  adjacency list (`parent_id`). Cycles and depth are checked in the service with recursive CTEs
  under the tenant's RLS scope; the database adds `categories_not_own_parent_check`. Categories
  are labels, not history, so an empty category is really deleted; one that still has products
  or children is protected by `ON DELETE RESTRICT` and reported as `409`.
- **Suppliers** are companies the organization buys from: contact data, ISO country, payment
  terms and lead time. They are deactivated, never deleted. Company names are unique per
  organization, case-insensitively (`lower(company_name)`).
- **Tenant-safe references everywhere.** Every catalog table has `organization_id`, a unique key
  on `(organization_id, id)`, and every reference is a composite foreign key onto that pair
  (`products_category_fk`, `products_supplier_fk`, `product_variants_product_fk`,
  `product_images_product_fk`, `categories_parent_fk`). A product in organization A can therefore
  not point at a supplier in organization B, even if application code tried. Row Level Security
  is enabled on all seven tenant tables with one `FOR ALL` policy each.
- **Assignable references must be active.** A product may only be given an `ACTIVE` category and
  supplier of its own organization; anything else is a `400` field error on `categoryId` or
  `supplierId`. Existing links to a since-deactivated supplier are kept.
- **Money and measures.** `bigint` minor units plus an ISO-4217 `currency` per product; integer
  grams and millimetres. No floats anywhere in the path.
- **Search without a search engine.** `pg_trgm` GIN indexes (with `btree_gin`, leading with
  `organization_id`) back case-insensitive substring search on names, brands, company names and
  SKUs. `%` and `_` in user input are escaped, so they match literally.
- **Lists** use offset pagination (`page`, `pageSize ≤ 100`) with a total, a whitelisted `sort`
  field and direction, and filters validated by the same zod schemas the web app uses. Summaries
  are produced by one query per page with correlated sub-selects (variant count, primary SKU),
  so there is no N+1.
- **Events.** Every change writes a catalog event (`product.created`, `variant.status_changed`,
  `supplier.updated`, …, typed in `CatalogEventPayloads`) to `outbox_events` in the same
  transaction. Publishing them to RabbitMQ is phase 7.

Details: [`docs/architecture/catalog.md`](../architecture/catalog.md).

## Alternatives considered

- **Products only, options as JSON.** Simple until inventory, purchasing and orders all need a
  stable key per option; then every consumer parses JSON. Rejected.
- **Variants only (no product row).** Duplicates descriptions, categories and supplier across
  every size. Rejected.
- **EAV attribute tables** (`attributes`, `attribute_values`, `variant_attribute_values`). Fully
  normalised and queryable, but heavy for what is display data in this phase. A flat, bounded
  `jsonb` object is enough; option types can be promoted to tables if faceted search needs them.
- **Hard delete with `ON DELETE CASCADE`.** Would erase what orders and stock movements refer to.
  Rejected for status lifecycles.
- **Soft delete via a `deleted_at` column on everything.** Every query would need to remember the
  filter. Explicit statuses are part of the domain and are filtered deliberately.
- **Materialized path or `ltree` for categories.** Faster subtree queries, but a depth of three
  and a small tree make recursive CTEs cheap, and moves stay a single-row update.
- **Cursor pagination** (the roadmap's original plan). Better for infinite scroll and very deep
  pages; the console needs page numbers and totals, and catalogs are thousands, not millions, of
  rows per tenant. Offset with a hard `pageSize` cap is simpler and sufficient; revisit if a
  tenant's catalog makes deep offsets slow.
- **Elasticsearch or OpenSearch.** More relevance features, but a second store to keep in sync
  and to secure per tenant. PostgreSQL trigram search is enough for SKU and name lookup.

## Tradeoffs

- Price lives in two places (product base price, optional variant override). The rule is simple
  and computed in one function, but reports must use `effectivePrice`.
- Correlated sub-selects per list row are cheap at `pageSize ≤ 100` but must be watched with
  `EXPLAIN` as catalogs grow.
- Offset pagination can skip or repeat a row when data changes between page loads.

## Consequences

**Positive**

- Inventory, purchase and order lines can reference `(organization_id, variant_id)` with a
  composite key, so the tenant guarantee extends to every later table.
- History is safe: nothing that could be referenced is ever deleted.
- The UI never offers an action the API would refuse: both read the same transition tables.

**Negative**

- Archived rows accumulate; lists filter by status and indexes lead with it.
- Two status machines (product and variant) interact; the "last active variant" rule is enforced
  in service code under a lock, not by a constraint.

## Failure, scaling, security and operational implications

- **Failure:** invalid transitions and last-variant violations are `409` with a readable message;
  references to missing, foreign or inactive rows are `400` field errors; unique violations are
  mapped by constraint name to `409`. Nothing is partially written: each command is one
  transaction including its outbox event.
- **Scaling:** every index leads with `organization_id`; list filters match composite indexes
  (`products_org_status_updated_idx`, `products_org_category_idx`, …); trigram indexes keep
  substring search off sequential scans.
- **Security:** tenant from the token only, RLS on every table, composite foreign keys even for the
  owner role, `404` for other tenants' ids. Proven by 26 database-level and 48 HTTP-level
  integration tests (see the catalog document).
- **Operational:** the permission catalog gained `categories.*` and split `suppliers.*` /
  `warehouses.*` into create, update and delete. identity-service syncs roles on every migration,
  so deploying Phase 3 requires running identity's migration job before users see the new rights.
