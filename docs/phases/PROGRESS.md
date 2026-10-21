# Progress log

One row per phase. Updated when a phase merges.

| Phase | Status | Date       | PR / description           | Decisions                                                                                                                                                                                                                                                                                                                                                                       | Deferred                                                                                                                                                |
| ----- | ------ | ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3     | Done   | 2026-10-21 | [phase-3.md](phase-3.md)   | Applications and API keys in ingest-service; baseline migration reset; unused web components deleted (restore from `v0-distribution`)                                                                                                                                                                                                                                           | Cross-tenant tests for ingest tables (Phase 4)                                                                                                          |
| 4     | Done   | 2026-10-21 | [phase-4.md](phase-4.md)   | Event types shared per organization; archive/revoke instead of delete; envelope-encrypted signing secrets with audited reveal; SHA-256 API key digests with a SECURITY DEFINER lookup; URL policy with a dev-only private-target flag                                                                                                                                           | API key HTTP guard and rate limits (Phase 5); secret rotation (Phase 7); send-time SSRF check (Phase 6)                                                 |
| 5     | Done   | 2026-10-21 | [phase-5.md](phase-5.md)   | Outbox relay and consumers with retry queue and DLQ; fan-out through the outbox; idempotency table with 24 h retention; rate limiter fails open; limits configurable                                                                                                                                                                                                            | Dispatcher (Phase 6); message inspection and replay (Phases 7, 8); broker-restart chaos test (Phase 11)                                                 |
| 6     | Done   | 2026-10-21 | [phase-6.md](phase-6.md)   | Dispatcher is a separate worker on the ingest database with a narrow role; claiming through one cross-tenant function with leases and a per-tenant cap; PostgreSQL state first-class, DynamoDB history derived; send-time SSRF guard inside the connection lookup; undici 8.12.3 pinned                                                                                         | Per-endpoint caps, rate limits, circuit breaking, replay, secret rotation (Phase 7); metrics and traces (Phase 12)                                      |
| 7     | Done   | 2026-10-21 | [phase-7.md](phase-7.md)   | Isolation decided at claim time (caps, circuits, half-open probe); breaker state in PostgreSQL; auto-disable emits one event; replay as a new cycle keeping attempt numbers; rotation keeps two valid secrets; in-app notifications                                                                                                                                             | Delivery and message listing and the attempt timeline (Phase 8); claim scan cost at scale (Phase 11)                                                    |
| 8     | Done   | 2026-10-21 | [phase-8.md](phase-8.md)   | Inspection reads attempts from the history store and degrades without it; test send is a reserved `solmira.test` event to one endpoint; console shaped by permissions, secrets shown once; polling until the realtime feed                                                                                                                                                      | Realtime feed and analytics (Phase 9); screens for notifications and for editing applications and event types                                           |
| 9     | Done   | 2026-10-21 | [phase-9.md](phase-9.md)   | `delivery.attempted` outbox event per real send; raw attempt rows with interpolated percentiles; WebSocket feed in notification-service with the token in the first frame and one queue per instance; views poll only while the feed is down                                                                                                                                    | Roll-ups and feed resumption if the load test needs them (Phase 11); audit consumer (Phase 10)                                                          |
| 10    | Done   | 2026-10-21 | [phase-10.md](phase-10.md) | Audit records built from the services' own outbox events; one compile-time exhaustive audit policy; append-only enforced by database role and trigger; refuse rather than guess; receiver library gets a guide, examples and independent test vectors                                                                                                                           | Names for actors; object-locked audit export (Phase 12)                                                                                                 |
| 11    | Done   | 2026-10-21 | [phase-11.md](phase-11.md) | Real processes and infrastructure for chaos and load; a control burst for isolation claims; only measured figures; claims serialized by an advisory lock and the worker waits for a free slot (ADR-0037)                                                                                                                                                                        | AWS figures and a soak test (Phase 12); an index-backed organization queue if the claim cost matters at scale                                           |
| 12    | Done   | 2026-10-21 | [phase-12.md](phase-12.md) | ECS Fargate with managed data stores, written as Terraform that is validated and planned offline and never applied (ADR-0038); metrics as EMF log lines, OpenTelemetry traces behind a collector, alarms and dashboard as code (ADR-0039); KMS envelope encryption; migrations and bootstrap as one-off tasks; runbooks and a security review that say they were not run on AWS | Apply in a non-production account and exercise the runbooks; image scanning, MFA, account-level detection, bulk re-encryption (see the security review) |

## Remaining work

Built on 2026-10-22 from the repository, the phase records, the security review and a route-by-route
comparison of the services with the console. Ticked when done; each item names its phase.

### Phase 13: product gaps (`phase-13/product-gaps`)

- [ ] CI runs on phase branches (it ran only on `main`, so no pivot phase had been checked by CI).
- [ ] CI green from a clean checkout: dependency audit (Next.js 16.3.7 and `source-map-js` advisories)
      and the Terraform offline plan fail on the integration branch.
- [ ] Applications: edit name and description in the console (the API exists).
- [ ] Event types: edit description and schema in the console; restore an archived event type (API and
      console).
- [ ] Endpoints: restore an archived endpoint (API and console).
- [ ] API keys: rename (API and console); show revoked keys on request.
- [ ] Notifications: the API exists, the console has no screen; add a list with mark-read and
      mark-all-read.
- [ ] Profile: change your name and your password while signed in (only the reset-by-email flow exists).
- [ ] Stale delivery status in the message list (root cause, fix, regression tests).
- [ ] Dev-mode restarts: compare with production images; graceful console behaviour while a service
      restarts; document in DEVELOPMENT.md.
- [ ] Validation errors name the field, the rule and an example; all limits in the API reference.
- [ ] Each edit, restore and rename is permission-guarded, audited and covered by role and cross-tenant
      tests.

### Phase 14: console redesign (`phase-14/console-redesign`)

- [ ] shadcn/ui on Tailwind CSS 4 with Radix primitives and lucide icons; obsolete components removed.
- [ ] Shell: collapsible sidebar, top bar with organization switcher, global search by ID, user menu,
      light/dark/system theme.
- [ ] Home: onboarding checklist that ticks itself off; success rate, recent failures, endpoints that
      need attention, quick actions.
- [ ] Empty states, skeletons, toasts, confirmations, relative times with exact time on hover, tables
      with search, filter, sort and pagination.
- [ ] One-time secret dialog, copy buttons, code snippets (curl, Node.js, Python) for sending and
      verifying, pre-filled with the application's ID.
- [ ] Endpoint page: test send with a live result; message inspector timeline with pretty JSON and
      one-click replay; consistent status badges with text.
- [ ] Responsive and WCAG 2.1 AA (keyboard, focus, labels, contrast).
- [ ] Component tests for the shared components; Playwright flows: sign up to first delivery, endpoint
      edit/disable, replay, API key create/revoke, application edit/archive.

### Phase 15: documentation and release hardening (`phase-15/docs-release`)

- [ ] README and docs match the product: console screenshots (light and dark) and the architecture
      diagram.
- [ ] Image vulnerability scanning in CI (security review F8).
- [ ] Final summary in this file.

## Owner review needed

Decisions that need the owner, or actions that must not be taken without them. Work continued
around each one.

- **`main` is still at the pre-pivot commit `cf9372f`.** Every phase merged into
  `pivot/webhook-platform`, which descends from `main`, so `main` can be fast-forwarded with no history
  rewrite. Moving the default branch is left to the owner.
- **Deleting an organization** is not offered: it spans six services' data and needs a retention
  decision (keep the audit trail? for how long?). Members can still be removed and resources archived.
- **Multi-factor authentication** (security review F9) is a product and security decision; not built.
- **A security contact** (F14) needs a real address that only the owner can give.
- **AWS**: nothing is applied (unchanged from Phase 12); the first deployment needs an account and
  credentials.

## Notes

- Pull requests are described in `docs/phases/phase-N.md` when the GitHub CLI is not
  authenticated. The branch for each phase is `phase-N/<name>`, merged into
  `pivot/webhook-platform`.
