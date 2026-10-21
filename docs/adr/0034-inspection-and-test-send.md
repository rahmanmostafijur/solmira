# ADR-0034: Message inspection and test send

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

The console needs to show a message, where it went and what happened on each attempt, and a tenant
needs a way to check that an endpoint works without sending a real event.

## Decision

- **Inspection lives in ingest-service**, the owner of the API. It reads current state from PostgreSQL
  (messages, deliveries, endpoints) and the attempt timeline from DynamoDB through the shared
  `@solmira/attempt-history` package, with read access only. The dispatcher uses the same package to
  write. A request for one message is a handful of queries: the message, its deliveries, and one
  DynamoDB query keyed by the tenant and the message id.
- **The history is optional for a response.** If DynamoDB cannot be read, the message detail still
  answers with its deliveries and `attemptsAvailable: false`; the console says the history is
  unavailable instead of failing the page.
- **Permission.** `messages.read` (every role) covers listing messages, reading one, and listing an
  endpoint's deliveries. Payloads are tenant data; the permission is checked per organization like
  every other read.
- **Test send** (`POST .../endpoints/{id}/test`, needs `endpoints.update`) creates a message with the
  platform's own event type `solmira.test` and a delivery to that one endpoint, directly, in one
  transaction, and records an `endpoint.test_sent` event. It deliberately skips `message.created`, so
  fan-out cannot reach the application's other endpoints. The event type is created lazily per
  organization; names starting with `solmira.` are reserved and cannot be created by tenants. The
  delivery then follows the normal path: signing, retries, history, circuit breaking.
- **Disabled endpoints cannot be test-sent** (409): the dispatcher would refuse it anyway.

## Alternatives considered

- **A separate read service.** Rejected: it would need the same tables and add a deployment for no gain.
- **Test send through the public ingestion path with a special flag.** Rejected: it would fan out.
- **Sending the test request synchronously from the API.** Rejected: it would bypass every protection
  the dispatcher enforces (target checks, limits) and create a second, less safe sender.

## Consequences

Test events appear in the message list like any other message, which is what a tenant debugging an
endpoint wants to see. Tests and real messages share the retention of the history.

## Failure, scaling, security and operational implications

Inspection queries are bounded by pagination and by the tenant and application filters. The
history read is tenant-prefixed by construction (ADR-0032). Test send is rate limited by the gateway
like any API call and by the endpoint's own limits when it is delivered.
