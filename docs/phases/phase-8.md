# Phase 8: Console

Branch `phase-8/console`, merged into `pivot/webhook-platform`.

## What changed

- **Inspection API** (ADR-0034) in ingest-service: list messages, show a message with its deliveries and
  the attempt timeline, list an endpoint's deliveries by status. Attempts are read from DynamoDB through the
  new `@solmira/attempt-history` package, shared with the dispatcher; if the history is unreachable the
  response says `attemptsAvailable: false` and everything else still works.
- **Test send**: `POST .../endpoints/{id}/test` creates a `solmira.test` message and one delivery to that
  endpoint only. The `solmira.` event-type prefix is reserved.
- **Console pages**: applications (list, create, archive), application detail (endpoints, API keys with the
  key shown once), event types, endpoint detail (edit, enable and disable, archive, test send, reveal and
  rotate the signing secret, deliveries filtered by status, replay of a time range), messages list and the
  message inspector (payload, deliveries, attempt timeline, replay of one delivery or all). Every page and
  action is shaped by the caller's permissions; the API still enforces them.
- **Fixes found on the way**: auth forms now `method="post"` (a form submitted before hydration used GET and
  put the password in the URL), and the session store returns a stable server snapshot (React reported a
  possible infinite loop).

## Decisions

- Messages and the inspector refresh every three seconds while anything is still in flight; the realtime
  feed replaces polling in Phase 9.
- Secrets are never kept in client state longer than the dialog or panel that shows them.
- New dev dependencies, web only: `@testing-library/react`, `@testing-library/dom`,
  `@testing-library/user-event` and `jsdom` (component tests; jsdom 29 because 30 needs Node 24.15) and
  `@playwright/test` (the browser test).

## Tests added

- ingest-service: inspection and test-send integration suites, including other tenants and permissions.
- web: component tests for the endpoint, event type and replay forms, the attempt timeline and the secret
  display (53 unit and component tests in total).
- web end-to-end (`pnpm --filter @solmira/web test:e2e`): sign-up, event type, application, API key,
  endpoint, ingestion, a delivery whose signature the test verifies with its own HMAC code, a failing
  receiver, the inspector, replay, and test send, against the real services and the gateway.

## How to verify

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm knip && pnpm turbo run lint typecheck test build
pnpm infra:up
for s in service-kit identity-service ingest-service dispatcher notification-service; do
  pnpm --filter @solmira/$s test:integration; done
pnpm --filter @solmira/web exec playwright install chromium
pnpm --filter @solmira/web test:e2e
```

Local result of the final run: 44 turbo tasks passed; integration suites 12, 68, 150, 5 and 23 tests
passed; the browser test passed on repeated runs. CI runs the browser test as the `e2e` job; the GitHub CLI
is not authenticated here, so that job has not been observed yet.

## Known limitations

- The console has no screens for editing an application or an event type, or for viewing the in-app
  notifications; their APIs exist.
- The browser test covers one tenant. Cross-tenant behaviour is proven at the API and database level.
- Attempt response bodies are shown as stored (truncated by the dispatcher), as text only.
