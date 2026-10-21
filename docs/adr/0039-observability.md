# ADR-0039: Observability with CloudWatch metrics from logs, OpenTelemetry traces and alarms as code

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Operators need to know whether customers are served and whether deliveries are moving, and to be told when
they are not. The services already write structured JSON logs with request ids.

## Decision

- **Logs** stay structured JSON on stdout (pino), collected by the ECS log driver into CloudWatch Logs
  encrypted with the data key. Sensitive headers are redacted by the logger, and trace ids are added to
  every line for correlation.
- **Metrics are written as CloudWatch Embedded Metric Format log lines**, flushed from an in-process
  registry every 60 seconds when `METRICS_ENABLED` is set. No agent, no metrics library with its own
  exporter, no extra permissions beyond writing logs. The set is small and chosen for alarms: attempts and
  attempt duration, deferred and rejected deliveries and messages, rate limiting, signing-secret decrypt
  failures, deliveries due and in flight, oldest due age, outbox size and age, queue, retry and
  dead-letter depth. Dimensions are a fixed small set per metric, never tenant ids (cardinality and cost).
- **Traces use OpenTelemetry**, isolated in `@solmira/telemetry`, exported over OTLP to an AWS Distro for
  OpenTelemetry sidecar that forwards to X-Ray. Tracing is off unless a collector is configured, so local
  development and tests are unaffected. Ids are X-Ray compatible and both W3C `traceparent` and
  `X-Amzn-Trace-Id` are propagated; each delivery attempt is a span.
- **Dashboards and alarms are Terraform.** One dashboard ordered by the operator's questions; alarms on
  customer-visible symptoms first (5xx rate, latency, delivery backlog age), then causes (outbox lag, dead
  letters, decrypt failures, task counts, CPU and memory, database, cache, broker and table health). Every
  alarm that needs action has a runbook (`docs/operations`).
- The dispatcher scales on `OldestDueAge`, the same signal that alarms.

## Alternatives considered

- **Prometheus and Grafana:** the right choice on Kubernetes; on Fargate it means running and securing
  more infrastructure to get what CloudWatch already provides.
- **The CloudWatch agent or the SDK's `PutMetricData`:** an agent to operate, or a network call and
  permission per service for something a log line does for free.
- **Per-tenant metrics:** useful, and unbounded in cardinality. Per-tenant views come from the delivery
  history, which is a queryable store, not from alarms.

## Consequences

- Metrics have up to a minute of delay and are only as good as the logs reaching CloudWatch.
- The alarm thresholds are starting points chosen from the load tests on a development machine
  (`docs/performance`), not tuned against production traffic. Expect to adjust them after the first weeks.
- X-Ray sampling is a variable (`trace_sample_ratio`); full sampling is a cost decision.
