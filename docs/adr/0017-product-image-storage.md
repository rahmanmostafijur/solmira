# ADR-0017: Product images: validated uploads, tenant-scoped keys, metadata in PostgreSQL

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

Users upload product photos from the console. Uploads are the classic path for stored XSS and
malware (an "image" that is really HTML or SVG with script), for overwriting another tenant's
files through a crafted file name, and for orphaned files when a database write fails. Images
also have order (the first is the primary one), alt text for accessibility, and a limit per
product. ADR-0014 decided where bytes live; this ADR decides how they get there and how they are
tracked.

The roadmap originally planned browser-to-S3 presigned uploads. That skips the service, so the
service cannot inspect the bytes before they are stored.

## Decision

- **Uploads go through operations-service** as `multipart/form-data` (`POST
/products/:id/images`, field `file`, optional `altText`), held in memory with hard limits:
  one file, 5 MB (`MAX_IMAGE_BYTES`), five fields. Oversized bodies fail with `413` before the
  handler runs. The gateway allows 10 MB bodies.
- **Validated by content.** `validateImageUpload` identifies the type from magic bytes
  (JPEG, PNG, WebP only; SVG is excluded because it can carry script), ignores the declared MIME
  type, requires the file extension to match the detected type, and rejects empty files. The
  stored `Content-Type` is the detected one.
- **Keys the client cannot influence.** Objects are stored at
  `organizations/{organizationId}/products/{productId}/{imageId}`, where the organization comes
  from the token and the image id is a new UUIDv7. The original file name is kept only as
  sanitised display text (`sanitizeFilename` strips paths and unsafe characters), never in the key.
  `product_images_key_prefix_check` makes the database refuse any key outside the row's own
  organization and product prefix.
- **Metadata in PostgreSQL.** `product_images` holds the key, original name, detected type, size,
  `sort_order`, alt text and timestamps, under RLS and with a composite foreign key to its
  product (`ON DELETE CASCADE`). At most 12 images per product (`MAX_IMAGES_PER_PRODUCT`).
  `isPrimary` is derived as `sort_order = 0`.
- **Ordering.** `POST /products/:id/images/reorder` must list every image of the product exactly
  once; positions are rewritten to `0..n-1`. Deleting an image renumbers the rest in the same
  transaction, so the next image becomes primary and there are no gaps.
- **Write ordering that never leaves a row without a file:**
  - Upload: lock the product row, check the limit, store the object, insert the row, write the
    outbox event, commit. If anything after the store fails, the object is deleted (best effort).
  - Delete: remove the row, renumber, write the event, commit, then delete the object. A failed
    object delete leaves an unreferenced object, which a sweeper can remove later, rather than a
    row pointing at a missing file.
- **Reads return signed URLs** (ADR-0014), never keys.

Details: [`docs/architecture/object-storage.md`](../architecture/object-storage.md).

## Alternatives considered

- **Browser-to-S3 presigned `PUT` or `POST`.** Saves service bandwidth and scales better for large
  files, but bytes reach storage unchecked; validation would need an asynchronous scan and a
  quarantine state. For 5 MB images the direct path is simpler and safer. Revisit for large
  media, with a quarantine prefix and a scanner.
- **Trusting `Content-Type` or the extension.** Both are client-controlled. Rejected.
- **Keys from the original file name.** Enables path tricks and collisions and leaks names into
  URLs. Rejected.
- **Server-side image processing (thumbnails, re-encoding).** Re-encoding would also strip
  metadata and neutralise polyglot files. It needs a native image library and a worker; deferred.
- **An explicit `is_primary` column.** Two sources of truth with `sort_order`. Rejected for the
  derived flag.

## Tradeoffs

- Upload bandwidth and memory pass through the service (bounded by the 5 MB limit and one file
  per request).
- Images are stored as uploaded: EXIF metadata such as camera location is not stripped yet.
- Best-effort cleanup can leave orphaned objects after crashes; a sweeper comparing keys with
  rows is needed before production (phase 12).

## Consequences

**Positive**

- Only real JPEG, PNG and WebP files are stored, with the correct type.
- A tenant cannot write, read or overwrite another tenant's objects: the key is derived from the
  token, checked by the database, and never exposed.
- Rows never point at files that do not exist.

**Negative**

- Uploads are synchronous and sequential per file in the UI (the console uploads one at a time to
  keep the chosen order).

## Failure, scaling, security and operational implications

- **Failure:** invalid type, extension mismatch or missing file → `400` with a field message; too
  large → `413`; product archived or 12 images already → `409`; storage down → `503` and no row
  written.
- **Scaling:** move to presigned uploads with asynchronous validation if files grow; reads already
  bypass the service.
- **Security:** proven by integration tests against real MinIO: SVG with script, a script renamed
  `.jpg`, a PNG named `.jpg`, oversized upload, unsigned read (`403`), cross-tenant list, upload,
  update, reorder and delete (`404`), and read-only roles (`403`).
- **Operational:** watch for `Could not delete a stored image object` warnings in logs (orphans); the planned
  sweeper and EXIF stripping are tracked for phase 12.
