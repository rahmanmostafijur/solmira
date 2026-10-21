# Phase 12: Production readiness on AWS

Branch `phase-12/aws-readiness`, merged into `pivot/webhook-platform`.

**Nothing was applied to AWS.** No account, credential or spend was used. Everything below that concerns AWS
is a configuration that validates and plans offline, not a system that has run.

## What changed

- **Infrastructure as code** (`infra/terraform`, [README](../../infra/terraform/README.md),
  [ADR-0038](../adr/0038-aws-deployment.md)): VPC, ALB with WAF and certificate, ECS Fargate services (seven
  applications and an OpenTelemetry sidecar), RDS PostgreSQL, ElastiCache, Amazon MQ, DynamoDB, two KMS
  keys, per-service task roles and Secrets Manager secrets, one-off tasks for the database bootstrap,
  migrations and the dead-letter tool. The offline plan creates 291 resources and changes nothing.
  `start_services=false` stages the first deployment.
- **Observability as code** ([ADR-0039](../adr/0039-observability.md)): metrics as CloudWatch Embedded
  Metric Format log lines, OpenTelemetry tracing in `@solmira/telemetry` (off unless a collector is
  configured), a dashboard and about 35 alarms, and dispatcher scaling on the age of the oldest due delivery.
- **Application changes the deployment needed**: signing secrets behind an asynchronous cipher with a KMS
  implementation (encryption context binds a secret to its endpoint); a dispatcher that defers, rather than
  sends unsigned, a delivery whose secret cannot be decrypted; `delivery_backlog()` for the backlog
  metrics; identity publishes previous public keys during a rotation; a dead-letter tool
  (peek, requeue, discard) that never prints message bodies.
- **Images**: the RDS certificate bundle is pinned by checksum in the service and bootstrap images, and a
  `db-bootstrap` image creates the databases and roles.
- **Runbooks** ([`docs/operations`](../operations/README.md)): first deployment, deploying and rolling back,
  delivery backlog, dead-letter queues, RabbitMQ failure, key and credential rotation, restore, and the
  certificate bundle.
- **Security review** ([`docs/security-review.md`](../security-review.md)): method, the scanner's findings,
  and 14 findings with a status each; what is still open is listed under "before production".
- **CI**: a `terraform` job (`fmt -check`, `validate`, offline plan) and the `db-bootstrap` image in the
  image matrix.

## Criteria

1. **Terraform validates and plans; nothing applied.** `fmt -check`, `validate` and the offline plan pass
   (291 to add, 0 to change, 0 to destroy); the Trivy configuration scan is clean with six documented
   suppressions. Nothing was applied.
2. **Logs, metrics, traces, dashboards and alerts as code.** `observability.tf`, `alarms*.tf`,
   `dashboard.tf`, `scaling.tf`, and the instrumentation in `service-kit`, `@solmira/telemetry` and the
   dispatcher.
3. **Runbooks and a written security review.** Dead-letter handling, RabbitMQ failure, key rotation and
   restore are in `docs/operations`; the review lists findings and their status.

## Tests added

- Cipher and key-service units (KMS envelope, caching, shared configuration rules), tracing and span units,
  metric encoding and registry units, the identity previous-keys test.
- Integration: dead-letter tooling and queue-depth metrics against a real broker; dispatcher behavior when a
  secret cannot be decrypted, and its metrics.
- A race in the new broker tests (publishing before the consumer was attached) was found while verifying,
  and the tests now wait for an attached consumer; five consecutive runs of the service-kit suite passed.

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip && pnpm turbo run lint typecheck test build --concurrency=4
docker run --rm -v "$PWD/infra/terraform:/work" -w /work --entrypoint sh hashicorp/terraform:latest \
  -c 'terraform fmt -check -recursive && terraform init -backend=false && terraform validate && ./offline-plan.sh'
pnpm infra:up
export TEST_ADMIN_DATABASE_URL=postgres://solmira:<password>@localhost:<port>/postgres
export TEST_DATABASE_URL=$TEST_ADMIN_DATABASE_URL
for s in service-kit identity-service ingest-service dispatcher notification-service analytics-service audit-service; do
  pnpm --filter @solmira/$s test:integration; done
pnpm --filter @solmira/resilience chaos
POSTGRES_PORT=<port> pnpm --filter @solmira/web test:e2e
```

Local result of the final run: format, knip, lint, types, unit tests and builds passed (51 turbo tasks;
with default concurrency one web unit test run failed under load and passed alone and at lower
concurrency); integration suites passed with 17, 68, 151, 31, 17, 11 and 10 tests; the four chaos
scenarios passed; the browser test passed. The GitHub CLI is not authenticated here, so CI has not been
observed.

## Known limitations

- **Never applied.** Quotas, service limits and AWS-side validation of arguments are unchecked, and the IAM
  policies, security groups and WAF rules have not been exercised.
- **The runbooks have not been run**, and no restore or recovery time has been measured.
- **No AWS performance figures**: none were measured, so none are claimed.
- Open security findings (image scanning, MFA, account-level detection, network egress filtering, bulk
  re-encryption, TLS for the JWKS fetch) are in the security review.
- Alarm thresholds are starting points from development-machine load tests, not tuned against traffic.
