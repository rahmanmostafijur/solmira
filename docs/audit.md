# Solmira application audit

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| Date           | 2026-11-15                                                                |
| Branch audited | `phase-13/product-gaps` at `583aa67`                                      |
| Scope          | Whole repository: console, six services, shared packages, infra, CI, docs |
| Changes made   | None. This was a read-only audit.                                         |

## 1. How to read this document

### 1.1 Method

- The web console (`apps/web`, 112 tracked files) was read in full.
- The backend services, shared packages, infrastructure, CI and documentation were read in three
  parallel passes: identity; ingest and dispatcher; everything else.
- The console's own checks were run: 79 unit tests pass, `tsc --noEmit` and `eslint` report nothing.

### 1.2 Limits of the evidence

- **The application was not run.** Docker was not running, so no page was opened in a browser. The
  UI and responsive assessment comes from reading the code, not from screenshots.
- **No backend test suite, build or migration was run.** Backend findings come from reading code.
- **Nothing was measured.** Every performance finding is reasoned from code and marked as such.

### 1.3 Severity

| Level  | Meaning                                                                          |
| ------ | -------------------------------------------------------------------------------- |
| High   | Data is lost or wrong, a user is locked out, or a stated guarantee does not hold |
| Medium | A real defect or gap with a workaround, or one that appears only at volume       |
| Low    | Minor defect, inconsistency or polish                                            |

No finding was rated Critical: nothing found lets one tenant read another tenant's data.

### 1.4 Evidence labels

| Label     | Meaning                                                                           |
| --------- | --------------------------------------------------------------------------------- |
| Verified  | Read in a first pass and then re-checked directly against the file                |
| Traced    | Followed through the code once; not re-checked and not reproduced                 |
| Suspected | Plausible from the code; depends on load or runtime behaviour that was not tested |

Line numbers are those at commit `583aa67`.

## 2. Summary

Solmira is a multi-tenant webhook delivery platform. A tenant sends events with an API key; Solmira
fans each one out to subscribed endpoints as a signed HTTP request, retries with backoff, isolates
failing endpoints, and lets the tenant inspect and replay.

The backend is well ahead of the console. Tenant isolation, the SSRF guard, refresh-token rotation
and request signing held up under review. The console works as an admin tool but is not yet a
product: it has no real dashboard, shallow navigation, and several backend features with no screen.

The findings that matter most:

| ID     | Finding                                                                                      | Severity |
| ------ | -------------------------------------------------------------------------------------------- | -------- |
| BE-01  | Identity events are never published, so the audit log misses member and organization actions | High     |
| BE-02  | Disabling an endpoint loses messages that cannot be replayed                                 | High     |
| BE-03  | Cleanup removes at most 5,000 rows per table per hour; several tables are never pruned       | High     |
| BE-04  | A JSON Schema with a top-level `$id` can break ingestion, across tenants                     | High     |
| BE-05  | Two owners can demote each other and leave an organization with no owner                     | High     |
| BE-06  | Events published before a consumer queue exists are dropped silently                         | High     |
| BE-07  | A failed consumer or relay channel is never rebuilt; health stays green                      | High     |
| GIT-01 | Five finished console commits are unmerged on `phase-13/console-gaps`                        | High     |
| FE-01  | The dashboard shows no delivery information                                                  | High     |
| MF-05  | Analytics has no time series, so no chart can be built                                       | High     |

## 3. Technology stack

| Layer        | What is used                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Console      | Next.js 16 (app router), React 19, Tailwind CSS 4, TanStack Query, react-hook-form with zod, lucide icons; hand-written UI primitives |
| Services     | NestJS 12 on Node 24 (ESM), Drizzle ORM; identity, ingest, dispatcher, notification, analytics, audit                                 |
| Data         | PostgreSQL 18 per service with row-level security, Redis, RabbitMQ, DynamoDB (attempt history)                                        |
| Shared       | `contracts` (zod schemas), `service-kit` (platform layer), `webhooks` (receiver verification), `attempt-history`, `telemetry`         |
| Edge and ops | Nginx gateway, Docker Compose, Terraform for AWS (never applied), GitHub Actions                                                      |
| Tests        | Vitest unit and integration tests against real infrastructure, one Playwright flow, four chaos scenarios                              |

## 4. Feature status

| Area                                           | Backend                             | Console                                    |
| ---------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| Sign up, sign in, password reset, verification | Working                             | Working                                    |
| Session list and revoke                        | Working                             | Working, placed on the dashboard           |
| Change name and password while signed in       | Working                             | No screen                                  |
| Organizations, switching, settings             | Working                             | Working                                    |
| Members, invitations, fixed roles              | Working                             | Working                                    |
| Applications                                   | Working, including edit             | Create, archive, restore; edit is unmerged |
| Event types with JSON Schema                   | Working, including edit and restore | Create and archive only                    |
| Endpoints, signing secrets, rotation           | Working                             | Working; restore is unmerged               |
| API keys                                       | Working, including rename           | Create and revoke only; rename is unmerged |
| Ingestion, fan-out, retries, circuit breaker   | Working                             | Not applicable                             |
| Message inspector, attempt timeline, replay    | Working                             | Working, basic                             |
| Realtime feed                                  | Working                             | Working (drives refreshes)                 |
| Delivery analytics                             | Single totals only, no time series  | One panel per application                  |
| Notifications                                  | One type, in-app only               | No screen                                  |
| Audit log                                      | Working for ingest events only      | Working; shows user ids, not names         |
| Service status page                            | Working locally                     | Working locally; broken in the AWS design  |

## 5. Git and branch state

### GIT-01 Finished console work is unmerged

- **Severity:** High. **Evidence:** Verified.
- **Detail:** `phase-13/console-gaps` is five commits ahead of `phase-13/product-gaps` and touches
  29 files (1,112 insertions): edit an application, edit and restore event types, show and restore
  archived endpoints, rename API keys and list revoked ones, and wait out restarting services.
- **Impact:** Any console redesign started from the current branch will conflict with these pages.
- **Files:** `apps/web/src/app/(console)/**`, `apps/web/src/components/webhooks/*`,
  `apps/web/src/lib/api/client.ts`, `apps/web/src/lib/webhook-queries.ts`, new
  `apps/web/src/lib/api/retry-policy.ts` and `apps/web/src/components/ui/query-feedback.tsx`.

### GIT-02 `main` is still at the pre-pivot commit

- **Severity:** Medium. **Evidence:** Verified.
- **Detail:** `main` and `origin/main` point at `cf9372f`, the last commit of the earlier
  order-and-inventory product. All webhook work lives on `pivot/webhook-platform` and phase branches.
- **Impact:** The default branch shows a different product. Moving it is recorded as an owner
  decision in `docs/phases/PROGRESS.md`.

### GIT-03 Four leftover worktrees

- **Severity:** Low. **Evidence:** Verified.
- **Detail:** `.claude/worktrees/` holds worktrees for `phase-13/validation-errors`,
  `phase-13/console-gaps`, `phase-13/account-api` and `phase-13/lifecycle-api`. All but
  `console-gaps` are fully merged into `phase-13/product-gaps`.

### GIT-04 The progress log does not match the tree

- **Severity:** Low. **Evidence:** Verified.
- **Detail:** Every Phase 13 box in `docs/phases/PROGRESS.md` is unticked, although the account
  API, lifecycle API, validation errors and CI-on-phase-branches work is merged.
- **Files:** `docs/phases/PROGRESS.md:25-41`.

## 6. Backend findings

### 6.1 Identity service

#### BE-01 Identity's outbox is never published

- **Severity:** High. **Evidence:** Verified.
- **Detail:** Only ingest-service registers `OutboxRelayModule`, and that relay reads ingest's own
  database. Identity writes events to its `outbox_events` table and nothing publishes them.
- **Impact:** `organization.created/updated`, `member.invited/joined/role_changed/status_changed/removed`
  and `invitation.revoked` are declared audited but never reach audit-service. The audit log has no
  record of who invited, promoted, suspended or removed anyone. The outbox table also grows forever.
- **Files:** `apps/identity-service/src/app.module.ts:20-32`,
  `apps/ingest-service/src/app.module.ts:44`, `packages/contracts/src/audit.ts:59-66`,
  `docs/architecture/tenant-isolation.md:121` (stale claim).

#### BE-05 The last-owner check can be raced

- **Severity:** High. **Evidence:** Traced.
- **Detail:** The check counts other active owners without locking them; only the target row is
  locked, at the default isolation level. Owner A demoting owner B while B demotes A passes both
  checks.
- **Impact:** An organization with no owner. Admins cannot grant ADMIN or OWNER, so no API path
  recovers it. The same race applies to suspend and remove. No test covers the last-owner rule.
- **Files:** `apps/identity-service/src/organizations/members.service.ts:192-211`.

#### BE-08 Expired invitations block re-inviting and are invisible

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** The unique index on open invitations ignores `expires_at`, while the list hides
  expired rows.
- **Impact:** After seven days, inviting the same email returns "already pending", and the console
  cannot show the row to revoke it.
- **Files:** `apps/identity-service/src/database/schema.ts:225-227`,
  `apps/identity-service/src/organizations/invitations.service.ts:140`.

#### BE-09 Any refresh error signs the user out

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** The refresh handler catches every error and clears the cookies. If rotation commits
  and a later step throws, the new token is never delivered.
- **Impact:** A brief PostgreSQL or Redis blip forces a new sign-in.
- **Files:** `apps/identity-service/src/auth/auth.controller.ts:84-92`,
  `apps/identity-service/src/auth/auth.service.ts:144-148`.

#### BE-10 Email verification cannot be retried

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** The verification token is issued only at registration and lives 24 hours. No resend
  route exists. Mail is sent best-effort after commit and failures are swallowed.
- **Impact:** A lost email leaves the account permanently unverified. Nothing is gated on
  verification, so the user-visible effect today is a banner that never goes away.
- **Files:** `apps/identity-service/src/auth/auth.service.ts:89`,
  `apps/identity-service/src/auth/account-recovery.service.ts:166-172`.

#### BE-11 Mail can be dropped silently in production

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** `SMTP_URL` is optional in every environment. Without it a disabled sender logs a
  warning and drops the mail. There is no retry or outbox for mail.
- **Files:** `apps/identity-service/src/config.ts:79`,
  `apps/identity-service/src/mail/email-sender.ts`,
  `apps/identity-service/src/organizations/invitations.service.ts:260-271`.

#### BE-12 No retention in identity

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** No maintenance job exists. `sessions`, `refresh_tokens` (one row per refresh),
  `email_tokens`, `invitations` and `outbox_events` grow without bound.
- **Files:** `apps/identity-service/src/database/schema.ts`.

#### BE-13 Login looks up users without a usable index

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** Login, forgot-password and the invitation member check filter on `users.email = $1`,
  but the only index is on `lower(email)`. Each is a sequential scan.
- **Files:** `apps/identity-service/src/auth/auth.service.ts:102`,
  `apps/identity-service/src/auth/account-recovery.service.ts:107`,
  `apps/identity-service/src/organizations/invitations.service.ts:70`.

#### BE-14 Smaller identity defects

| Finding                                                                                                                      | Severity | Files                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| Session list shows sessions whose refresh token has idle-expired (listed until day 30)                                       | Low      | `apps/identity-service/src/auth/sessions.service.ts:175-180`         |
| Member, invitation, session and organization lists have no pagination                                                        | Low      | `apps/identity-service/src/organizations/members.service.ts:132`     |
| Password reset does not clear the login lockout, so a reset user can still get 429                                           | Low      | `apps/identity-service/src/auth/account-recovery.service.ts:123-137` |
| Refresh clears the active organization when that membership is gone instead of falling back to another                       | Low      | `apps/identity-service/src/auth/auth.service.ts:141-146`             |
| Organization list includes suspended organizations without saying so; switching then 404s                                    | Low      | `apps/identity-service/src/organizations/`                           |
| Identity verifies with one signing key while publishing previous keys, so old tokens 401 on identity routes after a rotation | Low      | `apps/identity-service/src/app.module.ts:22-27`                      |
| Columns never read: `users.disabled_at`, `refresh_tokens.replaced_by_id`, `sessions.ip_address`                              | Low      | `apps/identity-service/src/database/schema.ts`                       |
| `organizations.currency` is a leftover from the earlier product                                                              | Low      | `apps/identity-service/src/database/schema.ts`                       |
| STAFF and VIEWER hold identical permissions; MANAGER and STAFF are names from the earlier product                            | Low      | `packages/contracts/src/access.ts:104-105`                           |

### 6.2 Ingest service and dispatcher

#### BE-02 Disabling an endpoint loses messages

- **Severity:** High. **Evidence:** Verified (fan-out), Traced (dispatcher).
- **Detail:** Fan-out creates deliveries only for endpoints that are enabled and not archived, so a
  message sent while an endpoint is disabled gets no delivery row for it. Replay only updates
  existing rows. Deliveries already pending are claimed and failed as `endpoint_unavailable` with
  nothing sent, and no `delivery.attempted` event is written.
- **Impact:** Messages sent during the disabled period can never be delivered to that endpoint.
  The console tells the user that failed deliveries can be replayed afterwards.
- **Files:** `apps/ingest-service/src/fan-out/fan-out.service.ts:46-64`,
  `apps/dispatcher/src/delivery/delivery-processor.ts:133,172-175`,
  `apps/ingest-service/src/replay/replay.service.ts:48,81`,
  `apps/web/src/app/(console)/applications/[applicationId]/endpoints/[endpointId]/page.tsx:109-113`.

#### BE-03 Cleanup is capped and several tables are never pruned

- **Severity:** High. **Evidence:** Verified (ingest job), Traced (others).
- **Detail:** The hourly job runs one batch of 5,000 rows per table with no loop. One API key at
  84 requests a minute creates idempotency rows faster than they are removed. `messages`,
  `deliveries`, `processed_events` and expired secrets are never deleted. Analytics has the same
  5,000-row cap; notification-service has no cleanup at all.
- **Files:** `apps/ingest-service/src/maintenance.service.ts:13-14,41-55`,
  `apps/analytics-service/src/analytics/maintenance.service.ts:13-14,37-43`,
  `apps/audit-service/src/audit/maintenance.service.ts`.

#### BE-04 A schema with a top-level `$id` breaks ingestion

- **Severity:** High. **Evidence:** Traced (into the Ajv source).
- **Detail:** Payload schemas are compiled on one shared engine and never removed. Ajv registers a
  schema's `$id` and throws on the next compile of the same id. Editing such an event type, cache
  eviction, or a second tenant using the same `$id` triggers it.
- **Impact:** Every ingest of that event type returns 500 until the service restarts. The same
  path leaks one compiled schema per recompile. No test covers `$id`.
- **Files:** `apps/ingest-service/src/event-types/payload-validator.ts:46`,
  `apps/ingest-service/src/event-types/payload-schema.ts:15`.

#### BE-15 Header values the API accepts fail every delivery

- **Severity:** Medium. **Evidence:** Traced (into the undici source).
- **Detail:** The contract rejects only control characters in custom header values. The HTTP client
  rejects anything above U+00FF, and the error is classified as `network`.
- **Impact:** Eight retries per message, an open circuit, and eventual auto-disable with a
  misleading reason.
- **Files:** `packages/contracts/src/endpoints.ts:20,76`,
  `apps/dispatcher/src/delivery/http-sender.ts:171-173`.

#### BE-16 One busy endpoint is capped at about 10 deliveries a second per worker

- **Severity:** Medium. **Evidence:** Traced, not measured.
- **Detail:** An empty claim sleeps 500 ms. With one busy endpoint the loop claims five (the
  per-endpoint cap), claims none, then sleeps. A configured rate limit above that is unreachable.
- **Files:** `apps/dispatcher/src/dispatcher.service.ts:73-76`.

#### BE-17 Fan-out can dead-letter an accepted message

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** Consumers retry five times, five seconds apart. A database outage longer than about
  25 seconds sends `message.created` to the dead-letter queue. The message was accepted with 202
  but has no deliveries until an operator requeues it. Nothing reconciles messages without
  deliveries.
- **Files:** `apps/ingest-service/src/fan-out/fan-out.service.ts:23-27`,
  `packages/service-kit/src/messaging/event-consumer.ts:22-23`.

#### BE-18 Attempt history is truncated silently

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** The store issues one DynamoDB query and ignores the continuation key. Past 1 MB the
  timeline is incomplete while still reported as available.
- **Files:** `packages/attempt-history/src/attempt-store.ts:116-121`.

#### BE-19 Endpoint health is stored but not returned

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** `consecutive_failures`, `first_failure_at`, `circuit_open_until`, `circuit_trips` and
  `disabled_at` exist but the endpoint view returns only `disabledReason`.
- **Impact:** A failing endpoint or an open circuit looks the same as a healthy one in the console.
- **Files:** `apps/ingest-service/src/endpoints/endpoint-views.ts:16`,
  `apps/dispatcher/src/database/endpoint-health.ts`.

#### BE-20 Performance risks at volume

All suspected; none measured.

| Finding                                                                                                 | Severity | Files                                                                    |
| ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| The claim function aggregates over every due row on every claim, under one advisory lock                | Medium   | `apps/ingest-service/drizzle/0011_claim_serialized.sql:30-61`            |
| Message and delivery lists count every matching row on each page load                                   | Medium   | `apps/ingest-service/src/inspection/inspection.service.ts:40-56,126-137` |
| The secrets join on each delivery attempt cannot use the partial index                                  | Low      | `apps/dispatcher/src/database/delivery-repository.ts:137-140`            |
| No `(endpoint_id, status)` index for bulk replay and the status-filtered delivery list                  | Low      | `apps/ingest-service/src/database/schema.ts`                             |
| Ten connections per origin are shared by all endpoints on one host; queued requests can time out unsent | Low      | `apps/dispatcher/src/delivery/http-sender.ts:115`                        |

#### BE-21 Smaller delivery-path defects

| Finding                                                                                                                       | Severity | Files                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| Auto-disable fires when the first failure is 120 hours old, even if the endpoint was healthy in between                       | Medium   | `apps/dispatcher/src/database/endpoint-health.ts:65-69`               |
| Every failure class retries the same way; `Retry-After`, 410 and 4xx get no special handling                                  | Low      | `apps/dispatcher/src/delivery/delivery-processor.ts`                  |
| The payload is re-serialized, so large integers, key order and duplicate keys change; the contract says "delivered unchanged" | Low      | `apps/dispatcher/src/delivery/delivery-request.ts:29`                 |
| The `messages:read` API key scope can be selected and grants nothing                                                          | Low      | `packages/contracts/src/api-keys.ts`                                  |
| Concurrent secret rotations: the loser gets 404 "Signing secret not found"                                                    | Low      | `apps/ingest-service/src/endpoints/endpoint-secrets.service.ts:75-86` |
| Message replay without an endpoint answers 200 with zero replayed for disabled endpoints; the docs say 409                    | Low      | `apps/ingest-service/src/replay/replay.service.ts`                    |
| The dispatcher reads `AWS_REGION` outside its validated configuration                                                         | Low      | `apps/dispatcher/src/dispatcher.module.ts:65,86`                      |

### 6.3 Notification, analytics and audit services

#### BE-22 Analytics returns totals only

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** Two routes return one aggregate per application or endpoint over a single window.
  There is no time series, organization total, per-event-type figure, error breakdown or count of
  failed deliveries (`successRate` is per attempt). Statistics are computed from raw rows on every
  request with no cache.
- **Impact:** A dashboard chart cannot be built without a new endpoint (see MF-05).
- **Files:** `apps/analytics-service/src/analytics/analytics.service.ts:98-147`,
  `packages/contracts/src/analytics.ts`.

#### BE-23 Smaller defects in the supporting services

| Finding                                                                                                                 | Severity | Files                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| The 31-day analytics cap is skipped when only `from` is supplied                                                        | Low      | `packages/contracts/src/analytics.ts:20-25`                                  |
| An unknown application id returns 200 with zeros instead of 404                                                         | Low      | `apps/analytics-service/src/analytics/analytics.service.ts:98-120`           |
| `processed_events` grows forever in analytics and notification                                                          | Medium   | `apps/analytics-service/src/database/schema.ts`                              |
| The realtime feed gives clients no signal when the broker is down, so the console stops polling while nothing arrives   | Medium   | `apps/notification-service/src/realtime/feed.consumer.ts`                    |
| Realtime frames carry no event id or sequence, so clients cannot detect gaps                                            | Low      | `packages/contracts/src/realtime.ts`                                         |
| Only one notification type exists (`endpoint.auto_disabled`), in-app only; read state is per organization, not per user | Medium   | `apps/notification-service/src/notifications/notifications.service.ts:50-80` |
| Audit list accepts `from` later than `to` and returns nothing                                                           | Low      | `packages/contracts/src/audit.ts:118-119`                                    |
| Audit records hold actor ids only, no names                                                                             | Low      | `apps/audit-service/src/audit/`                                              |

### 6.4 Platform layer (`service-kit`)

#### BE-06 Unroutable events are dropped

- **Severity:** High. **Evidence:** Traced.
- **Detail:** The relay publishes without the `mandatory` flag, there is no alternate exchange,
  and rows are then marked published. If a consumer's queue does not exist yet (first deploy, a new
  consumer, a deleted queue), those events are gone.
- **Files:** `packages/service-kit/src/messaging/outbox-relay.ts:67`,
  `packages/service-kit/src/messaging/topology.ts`.

#### BE-07 Failed channels are never rebuilt

- **Severity:** High. **Evidence:** Traced.
- **Detail:** A channel error is only logged, with no close handler and nothing that reattaches.
  Attaching aborts the remaining consumers on the first failure. The relay and the realtime feed
  consumer follow the same pattern. Readiness reports only that the connection exists.
- **Impact:** A consumer or the relay can stop for good while every health check stays green.
- **Files:** `packages/service-kit/src/messaging/event-consumer-host.ts:96-107`,
  `packages/service-kit/src/infra/rabbitmq.module.ts:78-92`,
  `packages/service-kit/src/messaging/outbox-relay.service.ts:51-53,76`,
  `apps/notification-service/src/realtime/feed.consumer.ts:39-41`.

#### BE-24 Duplication across services

- **Severity:** Low. **Evidence:** Traced.
- **Detail:** The database module, maintenance service, migration runner, JWT configuration lines,
  `processed_events` claim logic and test application helper are copied across the small services.
  `service-kit` also carries SSRF and KMS code that only ingest and the dispatcher use.
- **Files:** `apps/*/src/database/database.module.ts`, `apps/*/test/support/test-app.ts`.

### 6.5 Infrastructure, tooling and CI

#### BE-25 The AWS design has routing and health-check faults

Terraform has never been applied, so none of this has been observed.

| Finding                                                                                                                                   | Severity | Files                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/v1/roles` and `/permissions` match no rule and return 404 (pattern verified)                                                    | Medium   | `infra/terraform/alb.tf:163,198-216`                                                                 |
| Rate-limit blocks return 403 with no JSON body; the API reference promises 429 with `Retry-After`, and Nginx sends 429 without the header | Medium   | `infra/terraform/waf.tf:17-19,48-50`, `infra/docker/gateway/templates/solmira.conf.template:137-140` |
| The status page has no `/internal/*` rule to reach, so every service reads as down                                                        | Medium   | `infra/terraform/ecs.tf:61`, `apps/web/src/lib/service-status.ts:41`                                 |
| Load balancer, task and image health checks all use the liveness probe, so readiness gates nothing                                        | Medium   | `infra/terraform/alb.tf:122`, `infra/docker/service.Dockerfile:45-46`                                |
| The gateway proxies `/graphql` to a route that does not exist                                                                             | Low      | `infra/docker/gateway/templates/solmira.conf.template:91-95`                                         |
| RabbitMQ 4 locally and in CI, 3.13 on Amazon MQ                                                                                           | Low      | `docker-compose.yml:53`, `infra/terraform/variables.tf:140`                                          |

#### BE-26 Local setup does not work as written

- **Severity:** Medium. **Evidence:** Verified (`stack:up`), Traced (quick start).
- **Detail:** `pnpm stack:up` uses a Compose profile that no file defines, so it starts
  infrastructure only. The README quick start skips the notification, analytics and audit
  migrations; `DEVELOPMENT.md` builds two services and then migrates five. Neither copies the
  dispatcher's `.env.example`.
- **Files:** `package.json:22`, `README.md:93-99`, `DEVELOPMENT.md:30-43`.

#### BE-27 CI gaps

- **Severity:** Medium. **Evidence:** Verified (coverage), Traced (rest).
- **Detail:** No coverage is measured or enforced anywhere. There is no image vulnerability scan
  (security review F8), no static analysis or secret scan, no dependency update automation, and one
  end-to-end spec.
- **Files:** `.github/workflows/ci.yml`, `vitest.service.config.ts`, `apps/web/e2e/webhook-flow.spec.ts`.

#### BE-28 Documentation contradicts the code

- **Severity:** Medium. **Evidence:** Verified (README), Traced (rest).

| Document                              | Stale statement                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `README.md:10-14,44,68-69,79,124-125` | Says only phases 1 to 6 are built; lists the dispatcher, replay, DynamoDB history and the consumers as planned         |
| `ARCHITECTURE.md:143`                 | Lists a `/graphql` endpoint that does not exist                                                                        |
| `ARCHITECTURE.md:77`                  | Describes pre-aggregated statistics; the code aggregates raw rows per request                                          |
| `ARCHITECTURE.md:185,278-280`         | Marks messages, deliveries, idempotency and observability as planned                                                   |
| `ARCHITECTURE.md:259`                 | Queue names do not match the real ones                                                                                 |
| `docs/architecture/authorization.md`  | Says the catalog has 10 permissions (it has 31); role table is out of date                                             |
| `docs/architecture/authentication.md` | Describes a single signing key; previous keys are supported                                                            |
| `SECURITY.md:128-129`                 | Says the realtime socket closes on revocation and that audit records are written in the same transaction as the change |
| `docs/api/README.md:20,178-182,287`   | Rate-limit response, a table broken by pipe characters inside code spans, the 31-day cap                               |
| `docs/security-review.md:54`          | Describes single-instance defaults; the Terraform defaults are highly available                                        |

## 7. Security findings

Areas that were checked and found sound: tenant isolation (token-derived tenant, composite foreign
keys, row-level security), refresh rotation with reuse detection, hash-only storage of tokens and
API keys, envelope-encrypted signing secrets with audited reveal, the SSRF guard (deny lists, DNS
pinned inside the connection lookup, no redirects), and constant-time signature verification.

### SEC-01 Invitation mail can be abused as a relay

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** Registration needs no verification, any signed-in user can create organizations with
  no cap, and invitations have no per-organization or per-user limit. The subject line carries the
  organization name, which the sender chooses. The only brake is 30 requests a second per IP.
- **Files:** `apps/identity-service/src/organizations/invitations.service.ts:265`,
  `infra/docker/gateway/templates/solmira.conf.template:45-62`.

### SEC-02 The realtime socket outlives revocation

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** Revocation is checked once at connect. A removed or downgraded member keeps receiving
  the organization's events until the token expires, up to 15 minutes.
- **Files:** `apps/notification-service/src/realtime/realtime.gateway.ts:112`.

### SEC-03 The row-level-security safety check is not enforced in the AWS design

- **Severity:** Medium. **Evidence:** Traced.
- **Detail:** Readiness fails when the runtime database role could bypass row-level security, but
  no health check consumes readiness (see BE-25). A task started with an owner role would serve
  traffic.
- **Files:** `packages/service-kit/src/database/rls-enforcement.ts:5-7`, `infra/terraform/alb.tf:122`.

### SEC-04 The reserved `solmira.` prefix is not enforced at ingestion

- **Severity:** Low. **Evidence:** Traced.
- **Detail:** Once a test send has created `solmira.test`, an API key can ingest that type and it
  fans out to every endpoint. Users can also archive it or attach a schema to it.
- **Files:** `packages/contracts/src/messages.ts:11-15`,
  `apps/ingest-service/src/test-send/test-send.service.ts`.

### SEC-05 Tenant-authored regular expressions run on the request thread

- **Severity:** Medium. **Evidence:** Suspected.
- **Detail:** JSON Schema `pattern` uses the default regular-expression engine with no timeout. A
  catastrophic pattern with a crafted payload could block ingestion for every tenant.
- **Files:** `apps/ingest-service/src/event-types/json-schema.ts:14`.

### SEC-06 Smaller security items

| Finding                                                                                                                       | Severity | Evidence  | Files                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| Forgot-password answers faster for unknown emails than for known ones                                                         | Low      | Traced    | `apps/identity-service/src/auth/account-recovery.service.ts:103-119`                                                      |
| Login lockout is check-then-act, so parallel requests exceed five guesses per window                                          | Low      | Traced    | `apps/identity-service/src/auth/auth.service.ts:99-108`                                                                   |
| Three forgot-password calls an hour exhaust a victim's reset quota                                                            | Low      | Traced    | `apps/identity-service/src/auth/account-recovery.service.ts:101`                                                          |
| Revoking an invitation has no rank check, so an admin can revoke an owner's invitation                                        | Low      | Traced    | `apps/identity-service/src/organizations/invitations.service.ts:153-179`                                                  |
| The WebSocket path has no connection limit before authentication, and the 50-connection cap is per organization, not per user | Low      | Traced    | `infra/docker/gateway/templates/solmira.conf.template:78-82`, `apps/notification-service/src/realtime/realtime.hub.ts:36` |
| No HSTS or content security policy is set for console pages                                                                   | Low      | Suspected | `infra/docker/gateway/templates/solmira.conf.template:27-32`, `apps/web/next.config.ts`                                   |
| The SSRF guard does not restrict ports                                                                                        | Low      | Traced    | `apps/dispatcher/src/delivery/http-sender.ts`                                                                             |

### SEC-07 Open items in the existing security review

`docs/security-review.md` lists these as open: F1 bulk re-encryption after key replacement, F3
database passwords rather than IAM authentication, F5 manual rotation, F6 no CloudTrail or
GuardDuty, F8 images not scanned in CI, F9 no multi-factor authentication, F12 AWS controls never
exercised, F13 runbooks never run, F14 no security contact. It does not cover BE-06, BE-07, BE-25,
SEC-02 or SEC-03.

## 8. Frontend findings

What is sound: consistent design tokens, semantic tables and labelled fields, a skip link, focus
rings, native dialogs, permission-aware controls, secrets shown once, tenant-scoped cache keys, and
access tokens held in memory only.

### 8.1 Structure and navigation

#### FE-01 The dashboard shows no delivery information

- **Severity:** High. **Evidence:** Verified.
- **Detail:** The page shows a permissions checklist and the signed-in devices list. There are no
  delivery numbers, recent failures, endpoints needing attention or setup steps. It also prints a
  `solmira.app/<slug>` address that does not exist.
- **Files:** `apps/web/src/app/(console)/dashboard/page.tsx`.

#### FE-02 Navigation loses context

- **Severity:** Medium. **Evidence:** Verified.
- **Detail:** Breadcrumbs show only the sidebar section, never the application or endpoint.
  Messages are reached through a small text link. The application page has no tabs, and nothing
  finds a message by id. Notifications and profile have no navigation entry because they have no
  screen.
- **Files:** `apps/web/src/components/shell/navigation.ts`,
  `apps/web/src/components/shell/top-bar.tsx:13-30`,
  `apps/web/src/app/(console)/applications/[applicationId]/page.tsx:45-52`,
  `apps/web/src/components/shell/user-menu.tsx`.

#### FE-03 No error, not-found or loading routes

- **Severity:** Medium. **Evidence:** Verified.
- **Detail:** `apps/web/src/app` has no `error.tsx`, `not-found.tsx`, `global-error.tsx` or
  `loading.tsx`. A render error or a bad URL falls through to the framework defaults.
- **Files:** `apps/web/src/app/`.

### 8.2 Feedback and safety

#### FE-04 Destructive and expensive actions run without confirmation

- **Severity:** Medium. **Evidence:** Verified.
- **Detail:** Archive application, disable endpoint, "Replay to all endpoints" and "Replay range"
  act on one click. Replay also offers itself for deliveries that already succeeded.
- **Files:** `apps/web/src/app/(console)/applications/page.tsx:113-127`,
  `apps/web/src/app/(console)/applications/[applicationId]/endpoints/[endpointId]/page.tsx:89-100`,
  `apps/web/src/app/(console)/applications/[applicationId]/messages/[messageId]/page.tsx:56-60,86-95`,
  `apps/web/src/components/webhooks/replay-range.tsx`.

#### FE-05 Test send gives no result

- **Severity:** Medium. **Evidence:** Verified.
- **Detail:** The button shows "Test event queued" and nothing more. The delivery list below
  defaults to the Failed filter, so a healthy new endpoint shows "No deliveries match".
- **Files:** `apps/web/src/app/(console)/applications/[applicationId]/endpoints/[endpointId]/page.tsx:53,73-84`.

#### FE-06 The disabled-endpoint message is misleading

- **Severity:** Medium. **Evidence:** Verified.
- **Detail:** The alert says failed deliveries can be replayed afterwards. Messages sent while the
  endpoint was disabled have no delivery to replay (BE-02).
- **Files:** `apps/web/src/app/(console)/applications/[applicationId]/endpoints/[endpointId]/page.tsx:109-113`.

#### FE-07 The message filter is fragile

- **Severity:** Medium. **Evidence:** Verified (behaviour of the code), Suspected (validation error while typing).
- **Detail:** The event-type filter sends a request on every keystroke and the API matches exact
  names against a strict pattern, so partial input is likely to return a validation error. The
  API's `from` and `to` filters are not offered.
- **Files:** `apps/web/src/app/(console)/applications/[applicationId]/messages/page.tsx:20-49`,
  `packages/contracts/src/messages.ts:36-40`.

#### FE-08 The audit log shows ids instead of people

- **Severity:** Medium. **Evidence:** Verified.
- **Detail:** The actor is the first eight characters of a user id, and the target is a truncated
  id. Only the action filter is offered although the API supports actor, target and date.
- **Files:** `apps/web/src/components/audit/audit-format.ts:23-26`,
  `apps/web/src/app/(console)/settings/audit-log/page.tsx`.

#### FE-09 Leftovers from the earlier product

- **Severity:** Low. **Evidence:** Verified.
- **Detail:** Settings has a Currency field described as "for reports and documents". A comment
  refers to `orders.cancel`.
- **Files:** `apps/web/src/app/(console)/settings/page.tsx:66-101`,
  `apps/web/src/components/access/permission-groups.ts:22`.

### 8.3 Presentation and polish

| ID    | Finding                                                                                                                              | Severity | Files                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FE-10 | No dark mode and no reduced-motion handling                                                                                          | Medium   | `apps/web/src/app/globals.css`                                                                                                                         |
| FE-11 | Dates are raw locale strings everywhere; no relative time                                                                            | Low      | All pages under `apps/web/src/app/(console)/`                                                                                                          |
| FE-12 | Tables have no search or sorting; endpoints, event types and API keys are fetched at 100 with no paging                              | Medium   | `apps/web/src/components/ui/table.tsx`, `apps/web/src/lib/webhook-queries.ts:96-101,122-129,195-200`                                                   |
| FE-13 | Payloads and response bodies are plain text with no copy button or highlighting                                                      | Low      | `apps/web/src/app/(console)/applications/[applicationId]/messages/[messageId]/page.tsx:64-68`, `apps/web/src/components/webhooks/attempt-timeline.tsx` |
| FE-14 | No code snippets for sending an event or verifying a signature                                                                       | Medium   | `apps/web/src/components/webhooks/api-keys-panel.tsx`                                                                                                  |
| FE-15 | The endpoint and API key forms use hand-rolled state and one error banner; the other forms use react-hook-form with per-field errors | Low      | `apps/web/src/components/webhooks/endpoint-form.tsx`, `apps/web/src/components/webhooks/api-keys-panel.tsx:144-203`                                    |
| FE-16 | Error toasts disappear after five seconds                                                                                            | Low      | `apps/web/src/components/ui/toast.tsx:15`                                                                                                              |
| FE-17 | "Copied" never resets, and a clipboard failure is not handled                                                                        | Low      | `apps/web/src/components/ui/secret-display.tsx:24-27`                                                                                                  |
| FE-18 | The event type list shows "Validated" or "None"; the schema itself cannot be viewed                                                  | Low      | `apps/web/src/app/(console)/event-types/page.tsx:113`                                                                                                  |
| FE-19 | The unverified-email banner has no action                                                                                            | Low      | `apps/web/src/app/(console)/dashboard/page.tsx:119-123`                                                                                                |
| FE-20 | A session-expired redirect keeps the path but drops the query string                                                                 | Low      | `apps/web/src/components/auth/require-session.tsx:26`                                                                                                  |
| FE-21 | The delivery health panel is fixed at 24 hours with no range choice                                                                  | Low      | `apps/web/src/components/webhooks/delivery-health-panel.tsx:11`                                                                                        |

### 8.4 Responsive behaviour

Assessed from the code only.

| ID    | Finding                                                                                                | Severity | Files                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| FE-22 | Tables scroll sideways instead of adapting; members and roles force a minimum width                    | Medium   | `apps/web/src/app/(console)/settings/members/page.tsx:146`, `apps/web/src/app/(console)/settings/roles/page.tsx:28` |
| FE-23 | The endpoint page uses the full URL as its title beside four buttons                                   | Medium   | `apps/web/src/app/(console)/applications/[applicationId]/endpoints/[endpointId]/page.tsx:67-107`                    |
| FE-24 | The toast stack is a fixed 320px wide and can overflow narrow screens                                  | Low      | `apps/web/src/components/ui/toast.tsx:40`                                                                           |
| FE-25 | Breadcrumbs and the environment label are hidden below the `sm` breakpoint with nothing in their place | Low      | `apps/web/src/components/shell/top-bar.tsx:92-101`                                                                  |

### 8.5 Accessibility

| ID    | Finding                                                                             | Severity | Files                                                          |
| ----- | ----------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| FE-26 | The mobile navigation drawer does not move or trap focus                            | Medium   | `apps/web/src/components/shell/top-bar.tsx:33-85`              |
| FE-27 | The dropdown menu has no arrow-key navigation and does not move focus into the menu | Medium   | `apps/web/src/components/ui/dropdown-menu.tsx`                 |
| FE-28 | The select field does not link its error text with `aria-describedby`               | Low      | `apps/web/src/components/ui/field.tsx:111-136`                 |
| FE-29 | Member status is plain coloured text, with no badge or icon                         | Low      | `apps/web/src/app/(console)/settings/members/page.tsx:199-201` |

### 8.6 Frontend tests

#### FE-30 Thin page-level and end-to-end coverage

- **Severity:** Medium. **Evidence:** Verified.
- **Detail:** 79 unit tests in 19 files pass. Pages have no component tests, and there is one
  Playwright flow. Coverage is not measured.
- **Files:** `apps/web/src/**/*.test.{ts,tsx}`, `apps/web/e2e/webhook-flow.spec.ts`.

## 9. Missing features

Only what a user of this kind of product would reasonably expect.

### 9.1 Console screens for existing APIs

| ID    | Feature                                                                         | Severity | Files                                                                                                                    |
| ----- | ------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| MF-01 | Notifications list with mark read and mark all read                             | Medium   | `apps/notification-service/src/notifications/notifications.controller.ts`                                                |
| MF-02 | Profile: change name and password                                               | Medium   | `apps/identity-service/src/organizations/account.controller.ts`, `apps/identity-service/src/auth/password.controller.ts` |
| MF-03 | Edit application, edit and restore event type, restore endpoint, rename API key | Medium   | Built on `phase-13/console-gaps` (GIT-01)                                                                                |
| MF-04 | Message date filter; audit filters by actor, target and date                    | Low      | `packages/contracts/src/messages.ts:36-40`, `packages/contracts/src/audit.ts:113-120`                                    |

### 9.2 Features that need backend work

| ID    | Feature                                                                                                                     | Severity | Files to extend                                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| MF-05 | Time-series analytics (volume, success rate and failures over time, per organization)                                       | High     | `apps/analytics-service/src/analytics/`                                                                                    |
| MF-06 | Endpoint health in the API response (failure streak, circuit state, disabled time)                                          | Medium   | `apps/ingest-service/src/endpoints/endpoint-views.ts`                                                                      |
| MF-07 | Message filter by delivery status and endpoint; lookup by id or idempotency key; an application-wide failed-deliveries list | Medium   | `apps/ingest-service/src/inspection/inspection.service.ts`                                                                 |
| MF-08 | Resend verification email and resend invitation                                                                             | Medium   | `apps/identity-service/src/auth/`, `apps/identity-service/src/organizations/invitations.service.ts`                        |
| MF-09 | Recover messages missed while an endpoint was disabled                                                                      | Medium   | `apps/ingest-service/src/replay/replay.service.ts`                                                                         |
| MF-10 | Retry now for a delivery that is waiting                                                                                    | Low      | `apps/ingest-service/src/replay/replay.service.ts`                                                                         |
| MF-11 | Alerts for exhausted deliveries and open circuits; an email channel                                                         | Medium   | `apps/notification-service/src/notifications/`                                                                             |
| MF-12 | Leave an organization; sign out everywhere                                                                                  | Low      | `apps/identity-service/src/organizations/members.service.ts:179-180`, `apps/identity-service/src/auth/sessions.service.ts` |
| MF-13 | Retention setting for messages and deliveries                                                                               | Medium   | `apps/ingest-service/src/maintenance.service.ts`                                                                           |
| MF-14 | A published API specification and a public release of the verification library                                              | Low      | `packages/webhooks/package.json`, `packages/service-kit/src/bootstrap.ts:48-56`                                            |
| MF-15 | Developer quick-start snippets in the console                                                                               | Medium   | `apps/web/src/app/(console)/applications/[applicationId]/page.tsx`                                                         |

### 9.3 Confirmed absent and not recommended now

Multi-factor authentication (owner decision, security review F9), single sign-on, custom roles,
organization deletion (owner decision), email change, account deletion, payload transformations,
per-endpoint retry schedules, event-type schema versions, a customer-facing portal, usage quotas,
export, batch ingestion, hard delete of resources.

## 10. Recommended order of work

| Step | Work                                                                                                                                                                        | Covers                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| P0   | Merge `phase-13/console-gaps`, remove leftover worktrees, decide when `main` moves                                                                                          | GIT-01 to GIT-04                    |
| P1   | Correctness and data integrity in the backend                                                                                                                               | BE-01 to BE-11, BE-15, BE-17, BE-18 |
| P2   | Console redesign: shell and navigation, real dashboard with onboarding, component primitives with dark mode, missing screens, confirmations, error routes, mobile behaviour | FE-01 to FE-30, MF-01 to MF-07      |
| P3   | Product polish: snippets, failure alerts, retry now, audit actor names, removal of leftovers                                                                                | MF-08 to MF-15, FE-08, FE-09        |
| P4   | Release hardening: documentation, coverage, more end-to-end flows, AWS faults, open security items                                                                          | BE-12 to BE-28, SEC-01 to SEC-07    |

Risks:

- A redesign started before P0 will conflict with the unmerged console work.
- P2 depends on two backend additions, MF-05 and MF-06.
- Renaming roles and removing the currency field touch the database and the permission catalog and
  need a migration.
- Time-series analytics over raw rows will be slow at scale without roll-ups.
- Every performance finding should be measured before it is optimised.
