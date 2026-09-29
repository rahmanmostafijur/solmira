# ADR-0014: Object storage behind a port, S3 API everywhere, MinIO locally

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

Product images are the first binary data in Solmira. They do not belong in PostgreSQL (backups,
replication and memory would carry megabytes per row), and they must work the same way on a
laptop, in CI and on AWS (phase 12). Tests must exercise real storage behaviour (signatures,
private buckets, deletes), not a mock that always succeeds.

## Decision

- **A port in the service.** `ObjectStorage` (`apps/operations-service/src/storage/object-storage.ts`)
  has four operations: `put(key, body, contentType)`, `delete(key)`,
  `signedReadUrl(key, ttlSeconds)` and `ping()`. Services depend on the interface, injected
  under the `OBJECT_STORAGE` token.
- **One adapter: the S3 API.** `S3ObjectStorage` uses `@aws-sdk/client-s3` and
  `@aws-sdk/s3-request-presigner`. The same code talks to MinIO locally and in CI, and to Amazon
  S3 in deployed environments. Only configuration differs: `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`,
  `S3_REGION` and, locally only, static keys. On AWS the endpoint and keys are left unset and the
  SDK uses the task role.
- **Two clients.** Requests from the service go to `S3_ENDPOINT` (inside Docker:
  `http://minio:9000`); signed URLs are generated with `S3_PUBLIC_ENDPOINT` when set
  (`http://localhost:9000`), because a signature covers the host and the browser cannot resolve
  `minio`.
- **Private bucket, short-lived signed reads.** The bucket has no anonymous access
  (`mc anonymous set none` in `minio-init`; Block Public Access on AWS). The API never returns
  object keys; it returns a signed `GET` URL valid for `IMAGE_URL_TTL_SECONDS` (default 300) and
  its expiry time. Objects are written with `Cache-Control: private` and
  `Content-Disposition: inline`.
- **MinIO in Compose** from `cgr.dev/chainguard/minio` (the upstream image is no longer published
  on Docker Hub). It has a health check (`mc ready local`), and a one-off `minio-init` container
  creates the bucket and exits. Nothing waits on storage indefinitely: `minio-init` depends on a
  health check with bounded retries, and the CI job waits at most 60 seconds.
- **Storage is not critical for readiness.** `/health/ready` reports `object-storage` with
  `critical: false`: a storage outage degrades image endpoints (they answer `503`) but does not
  take the catalog API out of rotation.

Details: [`docs/architecture/object-storage.md`](../architecture/object-storage.md).

## Alternatives considered

- **Images in PostgreSQL (`bytea`).** Transactional and simple, but bloats backups and WAL and
  serves bytes through the API. Rejected.
- **Local filesystem volume.** Works on one host; breaks with more than one replica and has no
  signed URLs. Rejected.
- **A different SDK per environment** (MinIO client locally, AWS SDK in production). Two code
  paths, so the tested one would not be the deployed one. Rejected.
- **Public bucket with unguessable keys.** Links would leak through logs, referrers and browser
  history and never expire. Rejected.
- **CloudFront signed URLs or signed cookies.** Better caching for large catalogs; planned with
  the AWS work in phase 12. The port does not change.

## Tradeoffs

- Signed URLs expire, so pages that stay open refetch them (the web app refreshes image lists
  every four minutes and once on a broken image).
- Every image view is a direct request to storage, without a CDN until phase 12.
- Deletes are not transactional with the database (see ADR-0017 for the ordering rules).

## Consequences

**Positive**

- One adapter, tested against real MinIO in CI, is the one that runs on AWS.
- Swapping providers means a new adapter, not changes in business code.
- Readiness stays meaningful: the catalog keeps serving when storage has trouble.

**Negative**

- Two endpoint settings (`S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`) must be kept consistent per
  environment.
- MinIO and S3 differ in edge cases (for example error codes for missing buckets); the tests
  cover the operations the service uses.

## Failure, scaling, security and operational implications

- **Failure:** storage errors are logged with their cause and returned as `503` with a safe
  message; the health check reports the outage without failing readiness.
- **Scaling:** storage scales independently of the service; images never pass through the API on
  reads.
- **Security:** private bucket, no keys in responses, 5-minute read signatures, least-privilege
  credentials (on AWS: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on one bucket prefix).
- **Operational:** the bucket is created by `minio-init` locally and by Terraform in phase 12;
  credentials come from the environment, never from code.
