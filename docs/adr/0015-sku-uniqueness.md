# ADR-0015: SKU uniqueness per organization, among live variants

- **Status:** Superseded by ADR-0023
- **Date:** 2026-09-30

## Context

The SKU is how warehouse staff, suppliers and integrations identify an item. Three questions
decide whether it is reliable:

- **Scope.** Two customers of Solmira will both have a "TSHIRT-M"; that must not collide.
- **Equality.** `abc-1`, `ABC-1` and `ABC-1` with a trailing space are the same SKU to a person
  scanning a shelf.
- **Lifetime.** Businesses retire items and reuse codes. A retired variant must stay in history
  (orders and stock movements will reference it) but should not block its code forever.

Uniqueness checked only in application code races: two concurrent requests both see "free" and
both insert.

## Decision

- **Unique per organization, enforced by the database**, with a partial unique index:
  `product_variants_org_sku_live_key UNIQUE (organization_id, sku) WHERE status <> 'ARCHIVED'`.
  The index is the arbiter under concurrency; the service maps its violation to
  `409 "This SKU is already used by another variant"`.
- **One canonical form.** `skuSchema` (shared by the API and the web app) trims and upper-cases,
  then allows `[A-Z0-9][A-Z0-9._/-]{0,63}`. The database refuses anything else with
  `product_variants_sku_normalised_check` (`sku = upper(btrim(sku))` plus the pattern), so a
  script or a future service that skips the API cannot store a second spelling of the same code.
- **Archiving frees the code.** An archived variant keeps its SKU (history stays readable) but
  leaves the partial index, so a new variant may take the code. Restoring the archived variant
  fails with `409` if its SKU has been reused meanwhile.
- **Barcodes follow the same rule** (`product_variants_org_barcode_live_key`), validated as
  GTIN-8/12/13/14 with the check digit.
- **Search by SKU** uses a trigram index on `(organization_id, sku)`; the exact-SKU filter
  normalises its input the same way.

## Alternatives considered

- **Globally unique SKUs.** Wrong scope for a multi-tenant product and leaks existence across
  tenants through conflict errors. Rejected.
- **Unique for all rows, including archived.** Simpler index, but codes could never be reused,
  which operations teams do routinely. Rejected.
- **Case-insensitive index on `lower(sku)` without normalising.** Would prevent duplicates but
  store mixed spellings, making exact matching and display inconsistent. Rejected for one stored
  form.
- **Check-then-insert in the service.** Races under concurrency. Kept only as user-friendly
  messaging on top of the index.
- **Unique per product only.** Two products could share a SKU, which breaks scanning and
  purchasing. Rejected.

## Tradeoffs

- Reusing a code after archiving means an old order line and a new variant can show the same
  SKU; order lines snapshot SKU and name at order time (phase 6) and reference the variant id, so
  history remains unambiguous.
- Upper-casing is opinionated: a tenant that wants lower-case SKUs cannot have them.

## Consequences

**Positive**

- Duplicate SKUs are impossible within an organization, including under concurrent requests,
  and for writers that bypass the API.
- The same SKU can exist independently in every organization.
- Codes can be recycled without losing history.

**Negative**

- Restore can fail when the code was reused, and the user must rename one of the variants.

## Failure, scaling, security and operational implications

- **Failure:** a collision is a `409` on the `sku` field; an invalid format is a `400` from the
  shared schema before any query runs.
- **Scaling:** the partial unique index is also the lookup index for exact SKU matches per tenant.
- **Security:** conflicts are only ever reported within the caller's organization, so they reveal
  nothing about other tenants (proven by the "same SKU in another organization" test).
- **Operational:** imports should upper-case and trim SKUs before loading; rows that do not match
  the canonical form are rejected by the check constraint rather than stored.
