# ADR-0038: AWS deployment on ECS Fargate, written as Terraform and never applied

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

The platform runs locally with Docker Compose. Phase 12 makes it deployable to AWS and keeps it reviewable
without an AWS account. Nothing may be applied, and no money spent, without the owner's approval.

## Decision

- **Compute: ECS on Fargate**, one service per application (web, identity, ingest, dispatcher,
  notification, analytics, audit), behind one Application Load Balancer whose path routes mirror the nginx
  gateway. No servers to patch, no cluster to operate, and the images are the ones CI already builds.
  Kubernetes was not chosen: it adds an operational surface this project does not need.
- **Data: managed services.** One RDS PostgreSQL instance holding the five databases (the per-service
  ownership and the roles of ADR-0005 and ADR-0012 are kept; separate instances would multiply cost, not
  isolation). ElastiCache for Redis (Valkey), Amazon MQ for RabbitMQ (so ADR-0009 holds unchanged), and
  DynamoDB for delivery history with TTL and point-in-time recovery.
- **Secrets and keys.** Two KMS keys: one wraps webhook signing secrets (the envelope encryption behind the
  existing `SecretCipher` port, with an encryption context that binds each secret to its endpoint); one
  encrypts logs and secrets at rest. Each service has its own task role with only what it needs.
  Passwords live in Secrets Manager, one JSON secret per service.
- **Network.** Tasks run in private subnets; only the load balancer is public, behind a WAF with rate
  rules. The database, cache and broker accept connections only from task security groups. The dispatcher
  alone may reach the internet, because delivering to customer endpoints requires it (the SSRF controls are
  in the application). RDS connections verify the server certificate against the pinned RDS bundle in the
  image.
- **Terraform that is validated and planned, not applied.** CI runs `fmt -check`, `validate` and an
  offline plan (placeholder credentials, local state); a person applies, after approving a plan. First
  deployment is staged (repositories and keys, then the rest with `start_services=false`, then the
  services) so nothing starts against an empty database. The migrations and database bootstrap run as
  one-off tasks, not at service start, so no service holds schema-owner rights at runtime.
- **Operations.** No shell access to production; one-off tasks inside the network do the work. Runbooks in
  `docs/operations`.

## Alternatives considered

- **Aurora, or one RDS instance per service:** more isolation than the threat model needs, at several times
  the cost. Revisit when one service's load needs its own instance.
- **Self-hosted RabbitMQ or Redis on EC2:** cheaper, and an operational burden with no learning value here.
- **Applying the infrastructure to prove it:** cannot be done without credentials and spend the owner has
  not approved. The cost is that every runbook and every Terraform default is unproven on AWS; each says so.

## Consequences

- The configuration is reviewed by `validate`, an offline plan and a Trivy configuration scan
  (`docs/security-review.md`), which do not catch everything a real apply would (quotas, service limits,
  AWS-side validation of some arguments).
- Cost is dominated by the NAT gateways, RDS, Amazon MQ and the Fargate tasks; sizes are variables and the
  defaults are small. No figure is claimed here, because none has been measured.
- Single-instance defaults for the broker and, unless `postgres_multi_az` is set, the database are chosen
  for cost; production should switch Multi-AZ and the clustered broker on.
- Failure behavior: a failed rollout is rolled back by the ECS circuit breaker; a broker outage delays
  event-driven work only (`docs/operations/rabbitmq-failure.md`).
