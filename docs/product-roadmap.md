# Solmira product roadmap

|              |                                                                             |
| ------------ | --------------------------------------------------------------------------- |
| Created      | 2026-11-15                                                                  |
| Based on     | [`docs/audit.md`](audit.md) (audit of `phase-13/product-gaps` at `583aa67`) |
| Goal         | Turn Solmira into a production-quality webhook delivery product             |
| Approval     | **Approved by the owner on 2026-11-15** (answers in section 4.2)            |
| Engineering  | Earlier engineering phases 1 to 13: [`ROADMAP.md`](ROADMAP.md)              |
| Progress log | [`phases/PROGRESS.md`](phases/PROGRESS.md)                                  |

Every future session starts from this file. It is meant to be enough on its own: each task names
the audit finding it closes (IDs such as `BE-02` refer to sections of `docs/audit.md`) and the files
that are likely involved. Read the cited audit sections, not the whole audit, and read only the
files relevant to the current phase.

## 1. How to work from this roadmap

### 1.1 Session protocol

1. Read this file. Find the first phase in section 3 whose status is not `Done`.
2. Read that phase's section, the audit findings it cites, and the files it lists.
3. Inspect the current implementation, then write a short plan for the session before changing code.
4. Implement in small tasks, test-first (write a failing test, make it pass, refactor).
5. Run the checks in section 1.3. Use the browser when the stack can run.
6. At the end of the session, update this file: the phase status in section 3, the phase's
   **Session log** (completed, remaining, decisions, what could not be verified), and any decision in
   section 4. Tick the matching items in `docs/phases/PROGRESS.md`.

One phase per session. Phases 1 and 4 are split into work packages because they may need more than
one session; mark each work package done in the session log as it lands.

### 1.2 Rules that apply to every phase

- **No invented data.** Every number on screen comes from an API. Every performance claim comes
  from a measurement. If an API is missing, build it properly or leave the screen out.
- **No invented contracts.** Snippets, docs and UI use the real routes and shapes from
  `packages/contracts` and `docs/api/README.md`.
- **Only working controls.** A button, tab or link appears only when what it does exists.
- **Security is not traded for anything.** Tenant isolation, row-level security, authorization,
  the SSRF guard, webhook signing and secret handling stay intact. Every new route is
  permission-guarded and gets role tests and cross-tenant tests.
- **API or database changes** come with zod contracts, a Drizzle migration, integration tests and
  an update to `docs/api/README.md`.
- **Non-obvious decisions** get an ADR in `docs/adr/` (the next number is `0041`).
- **Dependencies:** none are added without a stated reason. Section 4.2 lists the ones that need
  approval.
- **Git:** one branch per phase (naming fixed in Phase 0). Conventional commit messages. No
  destructive Git operation (force push, reset, branch or worktree deletion, history rewrite)
  without the owner's approval. No AI or assistant attribution anywhere: code, comments, docs,
  commit messages, PR text.
- **Preserve behaviour** unless this roadmap or an ADR records why it changes.
- **Report honestly.** If Docker or a service is unavailable, the session log says what was not
  verified.

### 1.3 Checks before a phase is called done

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, unit tests, and `pnpm build`.
- Integration suites of every service the phase touched, against real infrastructure.
- `pnpm --filter @solmira/web test` and the Playwright flows that exist at that point.
- A browser pass of every screen the phase touched, at 375, 768, 1280 and 1920 px wide, in light
  and dark theme once Phase 2 is done, using the keyboard as well as the mouse.

### 1.4 Environment notes

These are as last recorded on 2026-10-21. Phase 0 confirms them.

- Solmira PostgreSQL is published on host port 5434. Point `TEST_DATABASE_URL` and
  `TEST_ADMIN_DATABASE_URL` at it.
- Mailpit SMTP is on host port 2525 (Windows reserves 1025 to 1124).
- `gh` is not logged in. PR descriptions are written to `docs/phases/` and pushed with the branch.
- After a change to the permission catalog, run
  `pnpm --filter @solmira/identity-service db:migrate` so roles pick up new permissions.
- Use the Edit tool for file edits. PowerShell `Get-Content`/`Set-Content` round trips corrupt UTF-8.
- ECC hooks are kept on: a fact gate before the first shell command and before each new file, and
  protection of `eslint.config.mjs`.

## 2. Product direction

### 2.1 The journey

Connect an application, configure endpoints, send events, monitor deliveries, debug failures,
replay messages. The console is organised around four jobs:

| Job     | What the user does                                         | Where                                                            |
| ------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Connect | Create an application, event types, endpoints and API keys | Onboarding checklist, application workspace, developer guide     |
| Monitor | See volume, success, latency and what needs attention      | Overview dashboard, application overview and analytics           |
| Debug   | Find a message and see why each delivery failed            | Message list and inspector, deliveries list, endpoint health     |
| Recover | Retry, replay and recover held messages                    | Inspector, endpoint page, deliveries list, all with confirmation |

### 2.2 The data model the UI must show accurately

- An **application** groups endpoints, messages and API keys.
- **Event types** are a catalog shared by every application in the organization (Phase 4 decision,
  see `docs/phases/PROGRESS.md`). They are not owned by one application.
- An **endpoint** belongs to one application and subscribes to event types.
- A **message** is one event accepted from the API. It fans out to one **delivery** per subscribed
  endpoint.
- Each delivery has one or more **attempts** (HTTP requests). Attempt history lives in DynamoDB
  and can be unavailable or, until `BE-18` is fixed, incomplete.
- **Replay** starts a new delivery cycle on an existing delivery and keeps the attempt numbering.

The inspector shows these three levels as levels: the message, its deliveries (one row per
endpoint), and each delivery's attempt timeline.

### 2.3 Information architecture

Sidebar (organization level):

| Section    | Items                                                  |
| ---------- | ------------------------------------------------------ |
| (top)      | Overview                                               |
| Webhooks   | Applications, Event types                              |
| Monitor    | Notifications (Phase 5)                                |
| Developers | Getting started (Phase 6)                              |
| Settings   | Organization, Members, Roles, Audit log; System status |

Organizations move into the organization switcher. Profile and sessions move into the user menu
(`/account`). The top bar holds breadcrumbs with application and endpoint names, a "go to ID"
search, the notification bell (Phase 5), the theme toggle and the user menu.

Application workspace at `/applications/[applicationId]/…`, with a header that always names the
application and a tab bar:

| Tab         | Route segment | Content                                                        | Phase |
| ----------- | ------------- | -------------------------------------------------------------- | ----- |
| Overview    | (index)       | Stats, charts, quick-start card, recent failures               | 2, 3  |
| Messages    | `messages`    | Every event sent; inspector at `messages/[messageId]`          | 2, 4  |
| Deliveries  | `deliveries`  | Application-wide deliveries, with a failed view                | 4     |
| Endpoints   | `endpoints`   | List with health; detail at `endpoints/[endpointId]`           | 2, 4  |
| Event types | `event-types` | The shared catalog, labelled as shared, with usage by this app | 4     |
| Analytics   | `analytics`   | Time series and per-endpoint performance                       | 4     |
| API keys    | `api-keys`    | Keys, scopes, create, rename, revoke                           | 2, 4  |
| Settings    | `settings`    | Name, description, archive and restore                         | 2, 4  |

The request lists "Events" and "Messages" as separate tabs. In Solmira they are the same thing,
so they become **Messages** (what was sent) and **Deliveries** (what happened to it). See D-03.

### 2.4 Design principles

Reference products for quality, not templates: Linear, Vercel, Stripe, Supabase, Hookdeck.

- Dense, calm and legible. A neutral palette with one accent. Status colours are used for status
  only and always come with an icon and text.
- A small type scale. Page titles are modest. Monospace for IDs, URLs, payloads and code.
- Tables are the main surface: aligned columns, sortable headers, toolbars, and a stacked layout on
  narrow screens.
- Borders before shadows. Shadows only on overlays.
- Motion is short and functional, and is turned off under `prefers-reduced-motion`.
- No decorative gradients, illustrations or oversized hero sections.

## 3. Phase status

| Phase | Theme                                 | Status      | Branch     | Work packages              |
| ----- | ------------------------------------- | ----------- | ---------- | -------------------------- |
| P0    | Git and repository preparation        | In progress | (existing) |                            |
| P1    | Backend reliability                   | Not started | (Phase 0)  | 1A, 1B, 1C, 1D, 1E         |
| P2    | Design system and application shell   | Not started | (Phase 0)  |                            |
| P3    | Dashboard and onboarding              | Not started | (Phase 0)  |                            |
| P4    | Core developer workflows              | Not started | (Phase 0)  | 4A resources, 4B debugging |
| P5    | Account and organization management   | Not started | (Phase 0)  |                            |
| P6    | Developer experience and final polish | Not started | (Phase 0)  |                            |
| P7    | Testing and QA                        | Not started | (Phase 0)  |                            |

Product phases are numbered P0 to P7 so they do not clash with engineering phases 1 to 15 in
`PROGRESS.md`. Section 7 maps the open Phase 13, 14 and 15 items onto this roadmap.

## 4. Decisions

### 4.1 Made in this roadmap (all accepted by the owner on 2026-11-15)

| ID   | Decision                                                                                                                                                                                                                                               | Why                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| D-01 | Keep and extend the hand-written UI primitives. No shadcn/ui, Radix or chart library. Charts are a few small SVG components. This replaces the shadcn/Radix line in `PROGRESS.md` Phase 14.                                                            | The audit rates the primitives sound. The gaps (dropdown keys, drawer focus) are small. Fewer dependencies, as the brief asks. |
| D-02 | Event types stay an organization-level catalog. The application tab shows the same catalog, labelled as shared, plus which of them this application's endpoints subscribe to.                                                                          | Matches the backend. Showing them as owned by an application would misrepresent the data.                                      |
| D-03 | "Events" and "Messages" become the **Messages** and **Deliveries** tabs.                                                                                                                                                                               | One message, many deliveries, many attempts is the real model (section 2.2).                                                   |
| D-04 | The audit log resolves actor ids to names in the console from the organization's member list. Unknown ids show as "Former member" with the id.                                                                                                         | No new cross-service call or stored personal data. Closes the Phase 10 deferral "names for actors".                            |
| D-05 | The onboarding checklist is derived from real data (counts of applications, event types, endpoints, API keys, messages, successful deliveries). It ticks itself off and hides when complete. Dismissal is per user and organization in `localStorage`. | Nothing fabricated, and no backend state for a convenience setting.                                                            |
| D-06 | Statistics ownership: analytics-service owns time series and history. It also consumes `message.created` to count events received. Ingest owns current state (pending and retrying deliveries). Recorded as an ADR in Phase 3.                         | Analytics consumes only `delivery.attempted` today (checked on 2026-11-15), so event volume has no source.                     |
| D-07 | A message sent while an endpoint is disabled is kept: fan-out creates the delivery in a held state that the dispatcher does not claim. On re-enable the user releases or discards held deliveries. Recorded as an ADR in Phase 1.                      | Closes the data loss in `BE-02` and is the basis for `MF-09`. Archived endpoints still get no deliveries.                      |
| D-08 | Theme is light, dark or system. A class on `<html>`, set by a small inline script before paint, persisted in `localStorage`.                                                                                                                           | No flash of the wrong theme, no dependency.                                                                                    |
| D-09 | Performance findings (`BE-16`, `BE-20`) are changed only after a measurement shows the cost. The one exception is the `(endpoint_id, status)` index, which the new failed-deliveries view needs.                                                       | The audit marks them suspected and asks for measurement first.                                                                 |
| D-10 | Success rate is shown per delivery (deliveries that succeeded divided by deliveries that finished). Attempt-level success is labelled as such where it appears.                                                                                        | Analytics today reports per attempt (`BE-22`), which reads lower than users expect and is easy to misread.                     |

### 4.2 Owner answers (2026-11-15)

The roadmap and every decision in section 4.1 were approved on 2026-11-15. These are the owner's
answers to the open questions. They are binding on the phases that follow.

| ID   | Question                                                                                                                                                                                      | Owner answer                                                                                                                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-01 | Integration target. `main` (`cf9372f`), `pivot/webhook-platform` (`58f876f`) and `phase-13/product-gaps` (`615500c`) are one straight line, so both can fast-forward with no history rewrite. | **Approved as recommended.** After Phase 0 merges `console-gaps` and the checks pass, fast-forward `pivot/webhook-platform` and `main` to `phase-13/product-gaps` and push. One branch per phase, cut from `main` as `product/pN-<slug>` and merged back with a merge commit.                                              |
| Q-02 | Remove the four leftover worktrees in `.claude/worktrees/` and delete the local phase-13 branches once merged (`GIT-03`).                                                                     | **Approved with a condition.** Before removing any worktree or branch, check each one for uncommitted changes, untracked files and commits not on its remote or not merged, and show the owner what exists. Remove nothing that holds such work without the owner's go-ahead. Remote branches stay.                        |
| Q-03 | Signing secrets. The console has an audited "Reveal secret" button for owners and admins (`endpoint_secrets.reveal`). The brief says secrets are never exposed after their first display.     | **Remove "Reveal secret" and its API route** (and the `endpoint_secrets.reveal` permission, with a permission sync and an ADR). Rotation must keep a grace period in which both the old and the new secret are valid; the period is configurable, not hardcoded; the UI shows when the old secret expires.                 |
| Q-04 | `SEC-05`: tenant-authored regular expressions. A safe engine (`re2`, a native module) is the robust fix but adds a dependency with a native build.                                            | **Do the spike in Phase 1. Ask the owner before adding `re2`.** The fallback without a dependency is to refuse risky patterns when a schema is saved and to cap payload string length during validation.                                                                                                                   |
| Q-05 | Default retention for messages and deliveries (`BE-03`). Today they are never deleted. A per-organization setting (`MF-13`) is deferred.                                                      | **30 days by default, configurable, not hardcoded** (validated configuration with the default in one place). Held deliveries for disabled endpoints (D-07) fall under the same retention: a held delivery older than the period is removed with its message, and the endpoint page says how long held deliveries are kept. |
| Q-06 | `organizations.currency` is left over from the earlier product (`FE-09`).                                                                                                                     | **Approved as recommended.** Remove it from the UI and contracts and drop the column in a migration (Phase 5).                                                                                                                                                                                                             |
| Q-07 | Notification read state is per organization: one member marking read hides the item for everyone (`BE-23`).                                                                                   | **Approved as recommended.** Make it per user, with a migration (Phase 5).                                                                                                                                                                                                                                                 |
| Q-08 | Dev dependencies for Phase 7: `@vitest/coverage-v8` (coverage, `BE-27`) and `@axe-core/playwright` (accessibility checks).                                                                    | **Approved as recommended.** Add both. They are test-only.                                                                                                                                                                                                                                                                 |

## 5. Phases

### P0: Git and repository preparation

**Goal:** one integration branch that contains all finished work, a stack that starts as
documented, and a progress log that matches the tree.

**Facts checked read-only on 2026-11-15:** `phase-13/console-gaps` is 5 commits ahead of the merge
base `ec44aa5` (29 files). Since then `phase-13/product-gaps` changed only
`apps/web/playwright.config.ts` and `docs/audit.md`, neither of which `console-gaps` touches, so
the merge is expected to apply cleanly. All other phase-13 branches are merged.

| Task | Work                                                                                                                                                                                                                                                  | Audit         | Likely files                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| P0-1 | Confirm a clean tree, Docker availability and the environment notes in section 1.4. Record results in the session log.                                                                                                                                |               |                                                                                                          |
| P0-2 | Merge `phase-13/console-gaps` into `phase-13/product-gaps` (a normal merge, no rewrite). Run web lint, typecheck, unit tests and build.                                                                                                               | GIT-01, MF-03 | `apps/web/src/app/(console)/**`, `apps/web/src/lib/webhook-queries.ts`, `apps/web/src/lib/api/client.ts` |
| P0-3 | Check each open Phase 13 item in `PROGRESS.md` against the tree (CI on phase branches, CI green from clean checkout, stale delivery status, dev-mode restarts) and tick what is done.                                                                 | GIT-04        | `docs/phases/PROGRESS.md`, `.github/workflows/ci.yml`                                                    |
| P0-4 | Make local setup work as written: fix the missing Compose profile behind `pnpm stack:up`, and correct the quick start (all migrations, every `.env.example`).                                                                                         | BE-26         | `package.json`, `docker-compose.yml`, `README.md`, `DEVELOPMENT.md`, `apps/dispatcher/.env.example`      |
| P0-5 | Start the full stack and sign in through the browser once, so later phases can do browser checks.                                                                                                                                                     |               |                                                                                                          |
| P0-6 | After approval of Q-01: fast-forward `pivot/webhook-platform` and `main`, push, and record the branch convention here.                                                                                                                                | GIT-02        | this file, `docs/phases/PROGRESS.md`                                                                     |
| P0-7 | Q-02: first list, per worktree and local branch, any uncommitted changes, untracked files and unpushed or unmerged commits, and show the owner. Then remove leftover worktrees and merged local branches, keeping anything the owner has not cleared. | GIT-03        | `.claude/worktrees/`                                                                                     |
| P0-8 | In `PROGRESS.md`, note that the Phase 14 and 15 lists are superseded by this roadmap (section 7).                                                                                                                                                     |               | `docs/phases/PROGRESS.md`                                                                                |

**Acceptance:** `console-gaps` is merged and all web checks pass; `pnpm stack:up` plus the
documented steps give a working stack; `PROGRESS.md` matches the tree; the integration target and
branch convention are written in this file.

**Session log (2026-11-15 and 2026-11-16, one session):**

Completed:

- **P0-1.** Starting tree: only `docs/ROADMAP.md` (a link) and this file, both uncommitted. Docker
  Desktop was not running; started it. Host ports 5433 (Postgres) and 8000 (DynamoDB) were held by
  containers of other projects, which were left alone. The stack was started with
  `POSTGRES_PORT=5434` and `DYNAMODB_PORT=8001`. The repository default is still 5433 (compose,
  `.env.example` files, DEVELOPMENT.md); the 5434 note in section 1.4 is a local override, not the
  default. Mailpit SMTP on 2525 matches. The `.env` files for all six services and the web app exist.
- **P0-2.** `phase-13/console-gaps` merged into `phase-13/product-gaps` as `0419b4f` (merge commit, no
  conflicts, dry run first). Web lint, typecheck, unit tests (24 files, 110 tests) and build pass.
  `pnpm format:check` on the whole tree fails only inside `.claude/worktrees/` (three files of the
  `console-gaps` worktree's uncommitted work, see P0-7); the files of the repository itself pass.
- **P0-3.** Phase 13 items checked against the tree and ticked in `PROGRESS.md`: CI triggers on
  phase branches, editing and restoring applications, event types, endpoints and API keys, stale
  delivery status (fixed in the live bridge, with tests), dev-mode restarts (now documented),
  validation errors. Left open: CI green from a clean checkout, notifications screen (P5-3), profile
  name and password (P5-1), and the re-check of role and cross-tenant tests for the lifecycle routes.
- **P0-4.** `pnpm stack:up` used a Compose profile that does not exist, so it started only the
  infrastructure. It now uses `docker-compose.yml` plus `docker-compose.apps.yml`; `pnpm stack:down`
  added. Quick start (README and DEVELOPMENT.md) now copies the dispatcher `.env`, builds every
  service and runs all five migrations. DEVELOPMENT.md gained sections on dev-mode restarts and on
  running the services in containers.
  **Found while doing this:** the overlay ran ingest and the dispatcher with `NODE_ENV=production`
  and the development encryption key, which production refuses (`secret-cipher-config.ts`), so both
  crash-looped and `/internal/health/ingest` and `/dispatcher` answered 503. Fixed by setting
  `NODE_ENV=development` for those two services in the overlay only (comment in the file). The
  services' production checks are unchanged. Not changed: the other four services still run with
  `NODE_ENV=production` in the overlay.
- **P0-5.** Full stack running from `stack:up`: five migration jobs exited 0; the gateway and all six
  services answer 200 on their health routes. Browser pass: registered, signed in, created an
  organization and reached the dashboard. One 401 console error was seen (probably the session probe
  before sign-in; not confirmed). A throwaway account (`p0-check@example.test`, organization "P0 Check
  Org") now exists in the local database.
- **P0-8.** `PROGRESS.md`: Phase 14 and 15 lists marked superseded by this roadmap.

Awaiting the owner (nothing below has been done):

- **P0-6.** Fast-forward `pivot/webhook-platform` (`58f876f`) and `main` (`cf9372f`) to the
  `phase-13/product-gaps` tip and push the three branches. Needs the owner's approval of the exact
  commands before they run, and a commit of the P0 changes first. The branch convention (Q-01:
  `product/pN-<slug>` from `main`, merged back with a merge commit) is to be recorded here after.
- **P0-7.** Inventory (read-only):
  - Worktree `agent-a81db53fa26e1b37d` (`phase-13/console-gaps`) holds **uncommitted work**:
    modified `navigation.ts`, `navigation.test.ts`, `top-bar.tsx`, `packages/contracts/src/notifications.ts`;
    untracked `(console)/notifications/`, `components/notifications/`, `notification-bell.tsx`,
    `notification-bell.test.tsx`, `lib/notification-queries.ts`. It is on no branch and no remote. It
    must not be removed without the owner's decision (commit it, save a patch, or discard).
  - Worktrees `validation-errors`, `account-api` and `lifecycle-api`: clean, no stash, every commit
    is contained in `phase-13/product-gaps`. Their branches have no remote; the commits are safe once
    `product-gaps` is pushed.
  - The four `worktree-agent-*` branches point at `cf9372f` (`main`): no unique commits.
  - Phase 3 to 12 branches are merged and exist on the remote.

Decisions: ingest and the dispatcher run with `NODE_ENV=development` in the local container overlay
(see P0-4). No ADR: it changes no production behaviour.

Not verified: the container stack was not exercised beyond health checks and one sign-in (no send,
no delivery). Terraform was not run. `gh` is not logged in, so no CI run was observed. Dependency
audit fails with 12 findings (2 critical, 4 high); not touched in P0, tracked in P7-7.

Also noticed, outside P0: the README "Limitations" section still says the webhook features are not
built (P6-7 covers the docs).

### P1: Backend reliability

**Goal:** no accepted message or audit event is lost, no organization can be locked out, and one
tenant cannot break ingestion for another.

#### 1A: Messaging platform

| Task | Work                                                                                                                                                                                                             | Audit        | Likely files                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1A-1 | Stop dropping unroutable events: publish with `mandatory` or an alternate exchange into an `unrouted` queue, never mark a returned event published, and declare every consumer queue and binding at startup.     | BE-06        | `packages/service-kit/src/messaging/outbox-relay.ts`, `packages/service-kit/src/messaging/topology.ts`                                                                         |
| 1A-2 | Rebuild failed channels: close and error handlers, reconnect with backoff, attach each consumer independently. Readiness reports consumer and relay health, not only the connection.                             | BE-07        | `packages/service-kit/src/messaging/event-consumer-host.ts`, `packages/service-kit/src/infra/rabbitmq.module.ts`, `packages/service-kit/src/messaging/outbox-relay.service.ts` |
| 1A-3 | The realtime feed consumer uses the same recovery and tells clients when the broker is down, so the console falls back to polling.                                                                               | BE-07, BE-23 | `apps/notification-service/src/realtime/feed.consumer.ts`, `packages/contracts/src/realtime.ts`, `apps/web/src/lib/realtime/feed-status.ts`                                    |
| 1A-4 | Register the outbox relay in identity-service so organization, member and invitation events reach audit-service. Check that audit ingestion is idempotent for the existing backlog. Fix the stale claim in docs. | BE-01        | `apps/identity-service/src/app.module.ts`, `packages/contracts/src/audit.ts`, `docs/architecture/tenant-isolation.md`                                                          |

Tests: an integration test that publishes before a queue exists and still delivers; a test that
kills a channel and sees consumption resume and readiness go red, then green; an identity action
that produces an audit record end to end.

#### 1B: Delivery integrity

| Task | Work                                                                                                                                                                                                                                      | Audit        | Likely files                                                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1B-1 | Held deliveries (D-07): a new delivery status, fan-out creates held rows for disabled subscribed endpoints, the claim function skips them, pending ones are moved to held rather than failed unsent. Add release and discard routes. ADR. | BE-02, MF-09 | `apps/ingest-service/src/fan-out/fan-out.service.ts`, `apps/dispatcher/src/delivery/delivery-processor.ts`, `apps/ingest-service/src/replay/replay.service.ts`, `apps/ingest-service/drizzle/`, `packages/contracts/src/messages.ts` |
| 1B-2 | Ajv `$id`: schemas with the same `$id` (same tenant edited, cache eviction, two tenants) no longer collide, and evicted schemas are removed so nothing leaks.                                                                             | BE-04        | `apps/ingest-service/src/event-types/payload-validator.ts`, `apps/ingest-service/src/event-types/payload-schema.ts`                                                                                                                  |
| 1B-3 | Custom header values: the contract accepts only what the HTTP client can send (visible ASCII and Latin-1). Existing endpoints with invalid values are found by a migration check and reported.                                            | BE-15        | `packages/contracts/src/endpoints.ts`, `apps/dispatcher/src/delivery/http-sender.ts`                                                                                                                                                 |
| 1B-4 | Reconcile accepted messages that have no deliveries (fan-out dead-lettered): a fan-out marker and a periodic job that re-runs fan-out.                                                                                                    | BE-17        | `apps/ingest-service/src/fan-out/`, `apps/ingest-service/src/maintenance.service.ts`, `packages/service-kit/src/messaging/event-consumer.ts`                                                                                         |
| 1B-5 | Attempt history follows DynamoDB continuation keys and reports truncation instead of hiding it.                                                                                                                                           | BE-18        | `packages/attempt-history/src/attempt-store.ts`                                                                                                                                                                                      |
| 1B-6 | Auto-disable counts only a continuous failure streak, not a first failure from 120 hours ago.                                                                                                                                             | BE-21        | `apps/dispatcher/src/database/endpoint-health.ts`                                                                                                                                                                                    |
| 1B-7 | Enforce the reserved `solmira.` prefix at ingestion and in event type create, edit, archive and schema changes.                                                                                                                           | SEC-04       | `packages/contracts/src/messages.ts`, `apps/ingest-service/src/test-send/test-send.service.ts`, `apps/ingest-service/src/event-types/`                                                                                               |

#### 1C: Identity correctness

| Task | Work                                                                                                                                                      | Audit         | Likely files                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1C-1 | Last-owner rule under concurrency: lock the organization's owner memberships before counting, for demote, suspend and remove. Add a concurrent test.      | BE-05         | `apps/identity-service/src/organizations/members.service.ts`                                                                                                                     |
| 1C-2 | Expired invitations: inviting the same email again replaces the expired row in the same transaction; the list can show expired invitations.               | BE-08         | `apps/identity-service/src/database/schema.ts`, `apps/identity-service/src/organizations/invitations.service.ts`                                                                 |
| 1C-3 | Refresh signs the user out only on authentication errors (invalid, expired, reused). Infrastructure errors return 503 and keep the cookies.               | BE-09         | `apps/identity-service/src/auth/auth.controller.ts`, `apps/identity-service/src/auth/auth.service.ts`                                                                            |
| 1C-4 | Resend verification email: a rate-limited route that issues a new token and invalidates the old one.                                                      | BE-10, MF-08  | `apps/identity-service/src/auth/`, `packages/contracts/src/`                                                                                                                     |
| 1C-5 | `SMTP_URL` is required in production. Mail failures are logged with context; invitation and verification can be resent (1C-4, P5).                        | BE-11         | `apps/identity-service/src/config.ts`, `apps/identity-service/src/mail/email-sender.ts`                                                                                          |
| 1C-6 | Email lookups use the `lower(email)` index.                                                                                                               | BE-13         | `apps/identity-service/src/auth/auth.service.ts`, `apps/identity-service/src/auth/account-recovery.service.ts`, `apps/identity-service/src/organizations/invitations.service.ts` |
| 1C-7 | Abuse limits: per-organization and per-user invitation limits and a cap on organizations per user; the invitation subject no longer leads with free text. | SEC-01        | `apps/identity-service/src/organizations/invitations.service.ts`, `apps/identity-service/src/organizations/`                                                                     |
| 1C-8 | Small fixes in the same code: invitation revoke checks rank; login lockout uses an atomic counter; password reset clears the lockout.                     | SEC-06, BE-14 | `apps/identity-service/src/organizations/invitations.service.ts`, `apps/identity-service/src/auth/auth.service.ts`, `apps/identity-service/src/auth/account-recovery.service.ts` |

#### 1D: Retention

| Task | Work                                                                                                                                                                                                                  | Audit        | Likely files                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1D-1 | Cleanup loops in batches until done (with a time budget) instead of one batch an hour.                                                                                                                                | BE-03        | `apps/ingest-service/src/maintenance.service.ts`, `apps/analytics-service/src/analytics/maintenance.service.ts`, `apps/audit-service/src/audit/maintenance.service.ts` |
| 1D-2 | Prune `messages` and `deliveries`, held deliveries included, past the configurable retention period (Q-05, default 30 days), expired signing secrets, published outbox rows, and `processed_events` in every service. | BE-03, BE-23 | `apps/ingest-service/src/maintenance.service.ts`, `apps/*/src/database/schema.ts`                                                                                      |
| 1D-3 | Add maintenance to identity (sessions, refresh tokens, email tokens, old invitations, outbox) and notification-service.                                                                                               | BE-12, BE-03 | `apps/identity-service/src/`, `apps/notification-service/src/`                                                                                                         |

Retention must not delete history the audit trail is required to keep. Audit records keep their
own policy.

#### 1E: Isolation hardening

| Task | Work                                                                                                                                | Audit  | Likely files                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1E-1 | Close realtime sockets when a member is removed, suspended or downgraded (react to member events) and re-check on a short interval. | SEC-02 | `apps/notification-service/src/realtime/realtime.gateway.ts`, `apps/notification-service/src/realtime/realtime.hub.ts` |
| 1E-2 | Tenant regular expressions cannot block ingestion. Spike first; ask the owner before adding `re2` (Q-04).                           | SEC-05 | `apps/ingest-service/src/event-types/json-schema.ts`                                                                   |

**Acceptance:** every task has a regression test that failed before the fix; the chaos suite still
passes; ADRs exist for held deliveries and for the messaging recovery design; `docs/api/README.md`
documents the new routes and the held status.

**Session log:** (empty)

### P2: Design system and application shell

**Goal:** a consistent, themeable, accessible foundation and a shell that always shows where the
user is. Existing pages are moved onto it without losing behaviour.

| Task  | Work                                                                                                                                                                                                                                                               | Audit               | Likely files                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| P2-1  | Tokens: semantic colours for light and dark (canvas, surface, raised, line, ink, muted, accent, ok, warn, danger, info and their soft variants), type scale, spacing, radius, shadow, motion, reduced motion.                                                      | FE-10               | `apps/web/src/app/globals.css`                                                                                            |
| P2-2  | Theme toggle (D-08) with a pre-paint script; dark mode checked on every page.                                                                                                                                                                                      | FE-10               | `apps/web/src/app/layout.tsx`, `apps/web/src/app/providers.tsx`, new `apps/web/src/components/shell/theme-toggle.tsx`     |
| P2-3  | Update primitives: Button (variants, sizes, icon-only with label), Badge and StatusBadge with icon and text, Field and Select (`aria-describedby` on errors), Dialog and ConfirmDialog (optional typed confirmation).                                              | FE-28, FE-29        | `apps/web/src/components/ui/button.tsx`, `badge.tsx`, `status-badge.tsx`, `field.tsx`, `dialog.tsx`, `confirm-dialog.tsx` |
| P2-4  | DropdownMenu: focus moves into the menu, arrow keys, Home and End, Escape returns focus.                                                                                                                                                                           | FE-27               | `apps/web/src/components/ui/dropdown-menu.tsx`                                                                            |
| P2-5  | Table: sortable headers, toolbar slot (search and filters), stacked rows below `md`, skeleton rows, empty state slot. Pagination stays the shared component.                                                                                                       | FE-12, FE-22        | `apps/web/src/components/ui/table.tsx`, `pagination.tsx`                                                                  |
| P2-6  | Toast: error toasts stay until dismissed; width adapts to the screen; announced politely.                                                                                                                                                                          | FE-16, FE-24        | `apps/web/src/components/ui/toast.tsx`                                                                                    |
| P2-7  | New primitives: Tabs (roving focus, URL-driven), Skeleton, EmptyState (with an action), CopyButton (resets, handles failure), CodeBlock and JsonViewer (highlighting, copy, collapse), RelativeTime (exact time on hover and focus), KeyValueList, Sheet (drawer). | FE-11, FE-13, FE-17 | new files in `apps/web/src/components/ui/`; `secret-display.tsx` uses CopyButton                                          |
| P2-8  | Charts (D-01): bar, stacked bar, line and sparkline in SVG, with axis labels, tooltips, and a visually hidden data table for screen readers.                                                                                                                       |                     | new `apps/web/src/components/charts/`                                                                                     |
| P2-9  | Shell: regrouped sidebar (section 2.3), collapsible on desktop, a Sheet drawer on mobile with focus moved in, trapped and returned; organizations inside the switcher.                                                                                             | FE-02, FE-26        | `apps/web/src/components/shell/navigation.ts`, `sidebar.tsx`, `top-bar.tsx`, `organization-switcher.tsx`                  |
| P2-10 | Breadcrumbs from route context with application and endpoint names; a compact form below `sm` instead of hiding them.                                                                                                                                              | FE-02, FE-25        | `apps/web/src/components/shell/top-bar.tsx`, new breadcrumb context in `apps/web/src/components/shell/`                   |
| P2-11 | Route files: `error.tsx`, `not-found.tsx`, `global-error.tsx` and `loading.tsx` at the app and console levels.                                                                                                                                                     | FE-03               | `apps/web/src/app/`, `apps/web/src/app/(console)/`                                                                        |
| P2-12 | Session-expired redirect keeps the query string.                                                                                                                                                                                                                   | FE-20               | `apps/web/src/components/auth/require-session.tsx`, `apps/web/src/lib/routing.ts`                                         |
| P2-13 | Application workspace layout with header and tabs. Split today's application page into the Overview, Endpoints, Messages, API keys and Settings tabs. Other tabs arrive with their content in P3 and P4.                                                           | FE-02               | new `apps/web/src/app/(console)/applications/[applicationId]/layout.tsx` and tab routes; `.../[applicationId]/page.tsx`   |
| P2-14 | Move every existing page onto the new primitives, with no change in behaviour.                                                                                                                                                                                     | FE-22               | all pages under `apps/web/src/app/(console)/` and `(auth)/`                                                               |

**Acceptance:** a component test for each new or changed primitive (keyboard behaviour included);
every existing test passes; every page works in both themes and at the four widths in section 1.3;
no control without a working action.

**Session log:** (empty)

### P3: Dashboard and onboarding

**Goal:** the first screen answers "is my webhook traffic healthy, and what needs me?" and guides
a new organization to its first successful delivery.

Backend:

| Task | Work                                                                                                                                                                                                                                | Audit        | Likely files                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| P3-1 | Time-series analytics for an organization and for an application: ranges 1 h, 24 h, 7 d and 30 d with fixed bucket sizes; deliveries succeeded and failed, success rate (D-10), latency p50 and p95. Index for the time-range scan. | MF-05, BE-22 | `apps/analytics-service/src/analytics/`, `apps/analytics-service/drizzle/`, `packages/contracts/src/analytics.ts`                  |
| P3-2 | Event volume (D-06): analytics consumes `message.created` into its own rows; the series includes events received. ADR.                                                                                                              | MF-05        | `apps/analytics-service/src/analytics/`, new consumer next to `delivery-attempts.consumer.ts`                                      |
| P3-3 | Analytics fixes: the 31-day cap applies when only `from` is given; an unknown application returns 404.                                                                                                                              | BE-23        | `packages/contracts/src/analytics.ts`, `apps/analytics-service/src/analytics/analytics.service.ts`                                 |
| P3-4 | Current delivery state from ingest: counts of pending, retrying, held and failed deliveries for an organization and an application; the organization's most recent failed deliveries.                                               | MF-07        | `apps/ingest-service/src/inspection/`, `packages/contracts/src/messages.ts`                                                        |
| P3-5 | Endpoint health in the endpoint view (failure streak, first failure, circuit state and open-until, trips, disabled time and reason) and an organization-wide "needs attention" list.                                                | BE-19, MF-06 | `apps/ingest-service/src/endpoints/endpoint-views.ts`, `apps/ingest-service/src/endpoints/`, `packages/contracts/src/endpoints.ts` |

Measure the time-series queries against a realistic seeded volume and record the figures. Add
roll-ups only if the measurement shows a need (D-09).

Frontend:

| Task  | Work                                                                                                                                                                                                                                                                                                                                            | Audit | Likely files                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| P3-6  | Overview page: range selector; stat tiles (events received, successful deliveries, failed deliveries, success rate, pending, average latency); charts for volume, succeeded versus failed, and success rate; endpoint performance table; recent activity (recent messages, recent failures, endpoints needing attention, latest notifications). | FE-01 | `apps/web/src/app/(console)/dashboard/page.tsx`, new `apps/web/src/components/dashboard/`, `apps/web/src/lib/queries.ts`         |
| P3-7  | Remove the permissions checklist and the fake `solmira.app/<slug>` address. Move the session list to a new `/account` page (Phase 5 extends it).                                                                                                                                                                                                | FE-01 | `apps/web/src/app/(console)/dashboard/page.tsx`, new `apps/web/src/app/(console)/account/page.tsx`                               |
| P3-8  | Onboarding checklist (D-05): create an application, create an event type, add an endpoint, create an API key, send a test event, see a successful delivery. Each step links to the place to do it.                                                                                                                                              |       | new `apps/web/src/components/dashboard/onboarding-checklist.tsx`                                                                 |
| P3-9  | Application Overview tab: the same tiles and charts scoped to the application; the delivery health panel gets the range selector.                                                                                                                                                                                                               | FE-21 | `apps/web/src/app/(console)/applications/[applicationId]/page.tsx`, `apps/web/src/components/webhooks/delivery-health-panel.tsx` |
| P3-10 | Live refresh through the existing realtime bridge, with polling only while the feed is down.                                                                                                                                                                                                                                                    |       | `apps/web/src/components/webhooks/live-feed-bridge.tsx`                                                                          |

**Acceptance:** every figure traces to an API response (unit tests for bucket and rate maths);
empty, loading and error states for each panel; a new organization sees the checklist and a
seeded one sees real figures; contract, integration and cross-tenant tests for the new routes.

**Session log:** (empty)

### P4: Core developer workflows

**Goal:** each resource is easy to create, inspect, change and recover, and a failed delivery can
be traced to its cause in a few clicks.

#### 4A: Resources

| Task | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Audit                       | Likely files                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4A-1 | Applications: list with search and an active or archived filter; create dialog; edit in the Settings tab (from the `console-gaps` work); archive and restore with confirmation.                                                                                                                                                                                                                                                                                                            | FE-04, MF-03                | `apps/web/src/app/(console)/applications/page.tsx`, `apps/web/src/components/webhooks/application-form.tsx`, `.../[applicationId]/settings/page.tsx`                                                                                                   |
| 4A-2 | Event types: list with search; schema viewer; edit; archive with confirmation; restore; reserved `solmira.*` types shown read-only; the application tab (D-02).                                                                                                                                                                                                                                                                                                                            | FE-18, FE-04, MF-03, SEC-04 | `apps/web/src/app/(console)/event-types/page.tsx`, `apps/web/src/components/webhooks/event-type-form.tsx`, new `.../[applicationId]/event-types/page.tsx`                                                                                              |
| 4A-3 | Endpoint list with a health column and status filter. Endpoint form on react-hook-form and zod with per-field errors and header validation that matches 1B-3.                                                                                                                                                                                                                                                                                                                              | FE-15, MF-06                | `.../[applicationId]/endpoints/page.tsx`, `apps/web/src/components/webhooks/endpoint-form.tsx`                                                                                                                                                         |
| 4A-4 | Endpoint detail page: header with a shortened URL and actions in an overflow menu; sections for configuration, delivery activity (default filter All), health, and signing secret (rotate with a configurable grace period in which both secrets are valid, showing when the old secret expires; "Reveal secret", its API route and permission removed per Q-03); disable and enable with confirmation and accurate copy; held deliveries with release and discard; restore when archived. | FE-05, FE-06, FE-23, BE-02  | `.../[applicationId]/endpoints/[endpointId]/page.tsx`, `apps/web/src/components/webhooks/secret-panel.tsx`, `apps/ingest-service/src/endpoints/endpoint-secrets.service.ts`, `packages/contracts/src/endpoints.ts`, `packages/contracts/src/access.ts` |
| 4A-5 | Test send result: the response already carries `messageId` and `deliveryId`. Show the delivery's status, response code and latency as they arrive, with links to the message and its attempts.                                                                                                                                                                                                                                                                                             | FE-05                       | `.../endpoints/[endpointId]/page.tsx`, new `apps/web/src/components/webhooks/test-send-result.tsx`, `apps/web/src/lib/webhook-queries.ts`                                                                                                              |
| 4A-6 | API keys tab: list with scopes and dates; create dialog that shows the key once with a send snippet (P6 fills the snippet); rename; revoke with confirmation; show revoked. The `messages:read` scope is removed from the create form until it grants something.                                                                                                                                                                                                                           | MF-03, BE-21                | new `.../[applicationId]/api-keys/page.tsx`, `apps/web/src/components/webhooks/api-keys-panel.tsx`, `packages/contracts/src/api-keys.ts`                                                                                                               |

#### 4B: Debugging and recovery

| Task | Work                                                                                                                                                                                                                                                                                           | Audit               | Likely files                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4B-1 | Backend: message lookup by id and by idempotency key; message filters by delivery status and endpoint; validated date range; an application-wide delivery list with a status filter; the `(endpoint_id, status)` index (D-09).                                                                 | MF-07, MF-04, BE-20 | `apps/ingest-service/src/inspection/inspection.service.ts`, `apps/ingest-service/src/database/schema.ts`, `apps/ingest-service/drizzle/`, `packages/contracts/src/messages.ts` |
| 4B-2 | Backend: "retry now" for a delivery that is waiting to retry; a dry-run count for range replay; message replay answers 409 for disabled endpoints as documented.                                                                                                                               | MF-10, BE-21        | `apps/ingest-service/src/replay/replay.service.ts`, `packages/contracts/src/messages.ts`, `docs/api/README.md`                                                                 |
| 4B-3 | Messages tab: toolbar with an ID and idempotency-key search, event type select (not free text), status, endpoint, and date range with presets; filters kept in the URL; pagination.                                                                                                            | FE-07, MF-04        | `.../[applicationId]/messages/page.tsx`                                                                                                                                        |
| 4B-4 | Deliveries tab: application-wide deliveries with a failed view, endpoint and status filters, and bulk recovery entry points.                                                                                                                                                                   | MF-07               | new `.../[applicationId]/deliveries/page.tsx`                                                                                                                                  |
| 4B-5 | Message inspector: metadata with copy buttons; JSON payload viewer; deliveries table (one row per endpoint); expanding a delivery shows its attempt timeline (request headers, response status, headers and body, duration, error class, next retry); history unavailable or truncated states. | FE-13, BE-18        | `.../messages/[messageId]/page.tsx`, `apps/web/src/components/webhooks/attempt-timeline.tsx`                                                                                   |
| 4B-6 | Replay and recovery with confirmation: retry now; replay one delivery; replay to all endpoints (shows the endpoint count); range replay (shows the dry-run count, typed confirmation above a threshold); a succeeded delivery offers "Resend" with confirmation.                               | FE-04, MF-10        | `.../messages/[messageId]/page.tsx`, `apps/web/src/components/webhooks/replay-range.tsx`                                                                                       |
| 4B-7 | Wire the top-bar "go to ID" search to message lookup.                                                                                                                                                                                                                                          | FE-02               | `apps/web/src/components/shell/top-bar.tsx`                                                                                                                                    |
| 4B-8 | Analytics tab: application time series and per-endpoint breakdown, reusing the P3 components.                                                                                                                                                                                                  | MF-05               | new `.../[applicationId]/analytics/page.tsx`                                                                                                                                   |

**Acceptance:** each create, edit, archive, restore, rename, revoke, retry and replay is
permission-gated in the UI and the API and refreshes the affected queries; destructive and bulk
actions confirm; new routes have contract, role and cross-tenant tests; a failed delivery can be
reached from the dashboard and replayed in the browser.

**Session log:** (empty)

### P5: Account and organization management

**Goal:** people can manage themselves, their team and their organization, and the audit log says
who did what.

| Task | Work                                                                                                                                                                      | Audit               | Likely files                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5-1 | `/account`: change name; change password (current password required); sessions with revoke; "sign out everywhere" (new backend route). Linked from the user menu.         | MF-02, MF-12        | `apps/web/src/app/(console)/account/`, `apps/web/src/components/shell/user-menu.tsx`, `apps/identity-service/src/auth/sessions.service.ts`                                       |
| P5-2 | Unverified-email banner gets a "Resend email" action (route from 1C-4).                                                                                                   | FE-19, MF-08        | console layout banner, `apps/web/src/lib/queries.ts`                                                                                                                             |
| P5-3 | Notifications page: unread and all, mark read, mark all read; a bell with an unread count in the top bar; live refresh. Read state per user (Q-07).                       | MF-01, BE-23        | new `apps/web/src/app/(console)/notifications/page.tsx`, `apps/web/src/components/shell/top-bar.tsx`, `apps/notification-service/src/notifications/`                             |
| P5-4 | New in-app notification types: deliveries exhausted (grouped so one outage is one notification) and circuit opened. Email channel deferred.                               | MF-11               | `apps/notification-service/src/notifications/notifications.service.ts`, `packages/contracts/src/`                                                                                |
| P5-5 | Members: responsive layout, status badges, role change that explains the last-owner rule, suspend and remove with confirmation, "leave organization" (new backend route). | FE-22, FE-29, MF-12 | `apps/web/src/app/(console)/settings/members/page.tsx`, `apps/identity-service/src/organizations/members.service.ts`                                                             |
| P5-6 | Invitations: show expired ones, resend (new backend route, rate limited), revoke within the rank rule.                                                                    | MF-08, BE-08        | `apps/web/src/app/(console)/settings/members/page.tsx`, `apps/identity-service/src/organizations/invitations.service.ts`                                                         |
| P5-7 | Organization settings: remove currency (Q-06); fix leftover comments; suspended organizations labelled in the switcher.                                                   | FE-09, BE-14        | `apps/web/src/app/(console)/settings/page.tsx`, `apps/web/src/components/access/permission-groups.ts`, `apps/identity-service/src/database/schema.ts`, `packages/contracts/src/` |
| P5-8 | Audit log: actor names (D-04), links to targets, filters by actor, target and date; the API rejects `from` later than `to`; identity events now appear (after 1A-4).      | FE-08, MF-04, BE-23 | `apps/web/src/app/(console)/settings/audit-log/page.tsx`, `apps/web/src/components/audit/audit-format.ts`, `packages/contracts/src/audit.ts`                                     |
| P5-9 | Roles page responsive. Renaming MANAGER and STAFF or merging STAFF and VIEWER stays out of scope (an owner decision).                                                     | FE-22, BE-14        | `apps/web/src/app/(console)/settings/roles/page.tsx`                                                                                                                             |

**Acceptance:** each new route has contract, role and cross-tenant tests; migrations for currency
and per-user read state; the last-owner rule is explained in the UI and enforced by the API; the
audit log shows names for current members.

**Session log:** (empty)

### P6: Developer experience and final polish

**Goal:** a developer can go from zero to a verified webhook using only the console, and the
product reads as one consistent piece of work.

| Task | Work                                                                                                                                                                                                                                                               | Audit        | Likely files                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| P6-1 | Getting started page: what Solmira does, the steps, and copyable snippets in cURL, Python and TypeScript for sending an event, built from `packages/contracts` and `docs/api/README.md`. The selected application's id is filled in; the API key is a placeholder. | FE-14, MF-15 | new `apps/web/src/app/(console)/developers/page.tsx`, new `apps/web/src/lib/snippets/`                                   |
| P6-2 | Delivered request reference: the exact headers and body a receiver gets, taken from the dispatcher's request builder, with a payload example from a real recent message of that event type when one exists.                                                        | FE-14        | `apps/dispatcher/src/delivery/delivery-request.ts` (read), `apps/web/src/lib/snippets/`                                  |
| P6-3 | Signature verification guide: the Node library from `packages/webhooks`, plus Python and a description of the algorithm. Unit tests run the snippet logic against the library's test vectors so the snippets cannot drift.                                         | FE-14        | `packages/webhooks/`, `apps/web/src/lib/snippets/`                                                                       |
| P6-4 | Contextual snippets: the application Overview "send your first event" card, the one-time API key dialog, and the endpoint page "verify signatures" section.                                                                                                        | MF-15        | application Overview tab, `api-keys` tab, endpoint detail page                                                           |
| P6-5 | API reference access: publish the OpenAPI document the services already build and link it from the console and docs. A public release of the verification library stays deferred.                                                                                  | MF-14        | `packages/service-kit/src/bootstrap.ts`, `docs/api/README.md`                                                            |
| P6-6 | Polish pass over every screen: terminology (message, delivery, attempt), empty states that point to the next action, skeletons, relative times, icon consistency, focus order, motion.                                                                             | FE-11        | all console pages                                                                                                        |
| P6-7 | Documentation matches the code: README, ARCHITECTURE, authorization, authentication, SECURITY and the API reference. Console screenshots in light and dark.                                                                                                        | BE-28        | `README.md`, `ARCHITECTURE.md`, `docs/architecture/*.md`, `SECURITY.md`, `docs/api/README.md`, `docs/security-review.md` |
| P6-8 | UX-visible identity fixes: refresh falls back to another organization when the active membership is gone; the session list hides idle-expired sessions.                                                                                                            | BE-14        | `apps/identity-service/src/auth/auth.service.ts`, `apps/identity-service/src/auth/sessions.service.ts`                   |

**Acceptance:** the snippet tests pass against the library's vectors; following the getting
started page on a fresh stack produces a verified delivery; no doc statement contradicts the code.

**Session log:** (empty)

### P7: Testing and QA

**Goal:** prove the product works end to end and keep it that way in CI.

| Task | Work                                                                                                                                                                                                                                       | Audit         | Likely files                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------- |
| P7-1 | Coverage measured in CI for the console and the services (Q-08), with an 80% threshold for the console and changed service code.                                                                                                           | BE-27, FE-30  | `.github/workflows/ci.yml`, `vitest.service.config.ts`, `apps/web/vitest.config.*` |
| P7-2 | Playwright journeys: sign up to first verified delivery; endpoint disable, held messages and release; failed delivery to replay; API key create, rename and revoke; application edit, archive and restore; password change; notifications. | FE-30         | `apps/web/e2e/`                                                                    |
| P7-3 | Accessibility checks in Playwright (Q-08) for every main page in both themes, plus a keyboard-only run of the first-delivery journey.                                                                                                      |               | `apps/web/e2e/`                                                                    |
| P7-4 | Responsive pass at 375, 768, 1280 and 1920 px in both themes, with screenshots kept as artifacts.                                                                                                                                          |               | `apps/web/e2e/`                                                                    |
| P7-5 | Security headers for console pages (HSTS, content security policy compatible with the theme script).                                                                                                                                       | SEC-06        | `apps/web/next.config.ts`, `infra/docker/gateway/templates/solmira.conf.template`  |
| P7-6 | Image vulnerability scanning in CI.                                                                                                                                                                                                        | BE-27, SEC-07 | `.github/workflows/ci.yml`                                                         |
| P7-7 | Full verification: format, lint, typecheck, unit, every integration suite, chaos suite, builds and Docker builds; a browser run of the main journey on a fresh stack.                                                                      |               |                                                                                    |
| P7-8 | Close out: update this file, `ROADMAP.md` status and `PROGRESS.md`; list what remains (section 6).                                                                                                                                         | GIT-04        | `docs/`                                                                            |

**Acceptance:** CI is green on the integration branch with coverage enforced; every journey in P7-2
passes; no accessibility violations of serious or critical impact remain.

**Session log:** (empty)

## 6. Deferred, with reasons

| Item                                                                                                                                                                        | Audit                | Reason                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| Dispatcher throughput per busy endpoint; claim and count costs at volume; connection pool                                                                                   | BE-16, BE-20         | Measure first (D-09).                                                   |
| Duplication across services                                                                                                                                                 | BE-24                | Refactor with no product effect; do it when a service is next reworked. |
| AWS routing and health checks; RLS readiness gate in AWS; RabbitMQ version skew                                                                                             | BE-25, SEC-03        | Terraform has never been applied; needs an AWS account (owner).         |
| Open items in the security review (MFA, IAM auth, CloudTrail, security contact and more)                                                                                    | SEC-07               | Owner decisions listed in `PROGRESS.md`.                                |
| Payload re-serialization; `Retry-After` and 410 handling                                                                                                                    | BE-21                | Behaviour changes for receivers; need their own ADR.                    |
| Remaining low items: forgot-password timing and quota, WebSocket pre-auth limits, SSRF port policy, realtime frame ids, unused columns, identity key rotation on its routes | SEC-06, BE-14, BE-23 | Low severity; pick up opportunistically.                                |
| Static analysis, secret scanning, dependency update automation                                                                                                              | BE-27                | Useful but outside the product scope of this roadmap.                   |
| Per-organization retention setting; email notification channel; public library release                                                                                      | MF-13, MF-11, MF-14  | After the core product lands.                                           |
| MFA, SSO, custom roles, organization and account deletion, email change, transformations, schema versions, customer portal, quotas, export, batch ingestion, hard delete    | audit section 9.3    | Confirmed absent and not recommended now.                               |

## 7. Mapping from `PROGRESS.md` Phases 13 to 15

| `PROGRESS.md` item                                                                           | Here                              |
| -------------------------------------------------------------------------------------------- | --------------------------------- |
| Phase 13: CI on phase branches; CI green from a clean checkout                               | P0-3 (verify), P7-7               |
| Phase 13: edit application, edit and restore event types, restore endpoints, rename API keys | P0-2 (merge), 4A                  |
| Phase 13: notifications screen                                                               | P5-3                              |
| Phase 13: profile name and password                                                          | P5-1                              |
| Phase 13: stale delivery status in the message list                                          | P0-3 (verify), 4B-3 if still open |
| Phase 13: dev-mode restarts                                                                  | P0-2 (`console-gaps`), P0-3       |
| Phase 13: validation errors; edits guarded, audited and tested                               | Merged already; verified in P0-3  |
| Phase 14: shadcn/ui and Radix                                                                | Replaced by D-01                  |
| Phase 14: shell, home, empty states, snippets, endpoint page, a11y, tests                    | P2, P3, P4, P6, P7                |
| Phase 15: docs and screenshots; image scanning; final summary                                | P6-7, P7-6, P7-8                  |

## 8. Audit traceability

Every audit finding has a home: a phase, or section 6.

| Phase | Findings                                                                                                                                                                                                                                                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | GIT-01, GIT-02, GIT-03, GIT-04, BE-26, MF-03 (merge)                                                                                                                                                                                                                       |
| P1    | BE-01, BE-02, BE-03, BE-04, BE-05, BE-06, BE-07, BE-08, BE-09, BE-10, BE-11, BE-12, BE-13, BE-15, BE-17, BE-18, BE-21 (auto-disable), BE-23 (processed events, feed signal), SEC-01, SEC-02, SEC-04, SEC-05, SEC-06 (rank, lockout), MF-08 (verification), MF-09 (backend) |
| P2    | FE-02, FE-03, FE-10, FE-11, FE-12, FE-13, FE-16, FE-17, FE-20, FE-22, FE-24, FE-25, FE-26, FE-27, FE-28, FE-29                                                                                                                                                             |
| P3    | FE-01, FE-21, BE-19, BE-22, BE-23 (cap, 404), MF-05, MF-06, MF-07 (organization failures)                                                                                                                                                                                  |
| P4    | FE-04, FE-05, FE-06, FE-07, FE-13, FE-15, FE-18, FE-23, BE-18 (UI), BE-20 (index), BE-21 (scope, 409), MF-03 (UI), MF-04 (messages), MF-07, MF-09 (UI), MF-10                                                                                                              |
| P5    | FE-08, FE-09, FE-19, FE-22, FE-29, BE-08 (UI), BE-14 (suspended organizations), BE-23 (notifications, audit), MF-01, MF-02, MF-04 (audit), MF-08 (invitations), MF-11 (in-app), MF-12                                                                                      |
| P6    | FE-11, FE-14, BE-14 (refresh fallback, sessions), BE-28, MF-14 (spec), MF-15                                                                                                                                                                                               |
| P7    | FE-30, BE-27 (coverage, image scan), SEC-06 (headers), SEC-07 (F8)                                                                                                                                                                                                         |
| Later | BE-16, BE-20 (rest), BE-21 (rest), BE-24, BE-25, SEC-03, SEC-06 (rest), SEC-07 (rest), BE-14 (rest), BE-23 (frame ids), MF-11 (email), MF-13, MF-14 (library)                                                                                                              |
