# API reference

All APIs are served through the gateway under `/api/v1`. Interactive OpenAPI documentation for each
built service is available outside production at `http://localhost:8080/internal/docs/{service}/`.
This page records the conventions and the endpoints. Sections marked **Planned** describe the
contract being built; they are not available yet.

## Conventions

| Topic          | Rule                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Base path      | `/api/v1`                                                                                                                                   |
| Format         | JSON request and response bodies; times are ISO-8601 UTC; ids are UUIDv7.                                                                   |
| Console auth   | `Authorization: Bearer <access token>` (15-minute JWT from `POST /auth/login`). The tenant is taken from the token, never from the request. |
| Ingestion auth | `Authorization: Bearer <API key>`. A key belongs to one application.                                                                        |
| Request ids    | The gateway sets `X-Request-Id` and propagates `X-Correlation-Id`; both appear in error bodies and logs.                                    |
| Tenancy        | A resource of another organization answers `404`, not `403`.                                                                                |
| Idempotency    | Write endpoints that document it accept `Idempotency-Key` (8-100 characters of letters, digits and `- _ : .`).                              |
| Pagination     | Lists take `page` (default 1) and `pageSize` (default 25, max 100) and return `{ items, page, pageSize, total, totalPages }`.               |
| Rate limits    | Excess requests answer `429` with `Retry-After`.                                                                                            |

## Errors

Every error uses one envelope. A real answer to a message sent with `Idempotency-Key: short`:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Idempotency-Key is too short",
    "details": [
      {
        "path": "Idempotency-Key",
        "message": "Idempotency-Key must be 8 to 100 characters long (letters, digits, - _ : .); got 5. Example: order-1234-created",
        "rule": "too_short",
        "example": "order-1234-created",
        "minimum": 8,
        "maximum": 100
      }
    ],
    "requestId": "0192f000-0000-7000-8000-000000000000"
  }
}
```

How to read it:

| Field               | Meaning                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`              | Stable machine code (table below). Branch on this, never on the message.                                                                                      |
| `message`           | One line for people. For `VALIDATION_FAILED` it names the first problem and how many more there are; `details` has all of them.                               |
| `details`           | Present when the problem is in specific fields; one entry per problem.                                                                                        |
| `details[].path`    | The field: a dotted body path (`headers.x-tenant-id`, `eventTypeIds.0`), a query parameter, a path parameter or a header name. Empty for the body as a whole. |
| `details[].message` | What is wrong and what to send instead. It names the field and, when it helps, what was received and an example.                                              |
| `details[].rule`    | Optional machine code of the broken rule (table below).                                                                                                       |
| `details[].example` | Optional example of a valid value.                                                                                                                            |
| `details[].minimum` | Optional lower bound: a length for text and lists, a value for numbers.                                                                                       |
| `details[].maximum` | Optional upper bound, measured the same way (bytes for a payload).                                                                                            |
| `requestId`         | Quote it when contacting support; it finds the request in the logs.                                                                                           |

Messages may be reworded; `code`, `path` and `rule` are stable. Query and path parameters are
named as such, for example `GET /api/v1/event-types?pageSize=500` answers `message`
`Query parameter pageSize is too large` with the detail
`{ "path": "pageSize", "rule": "too_big", "message": "Query parameter pageSize must be between 1 and 100; got 500.", "minimum": 1, "maximum": 100 }`.
Messages never repeat a long or sensitive value back: they state a length, a number or a short
enum value at most.

| Rule               | The field                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `required`         | is missing.                                                                                            |
| `invalid_type`     | has the wrong JSON type, for example a string where an object is expected.                             |
| `too_short`        | is text shorter than `minimum` characters.                                                             |
| `too_long`         | is text longer than `maximum` characters.                                                              |
| `too_small`        | is a number below `minimum`, or a list with fewer than `minimum` items.                                |
| `too_big`          | is a number above `maximum`, a list with more than `maximum` items, or a payload over `maximum` bytes. |
| `invalid_format`   | does not have the expected format: UUID, email, ISO 8601 date-time or a name pattern.                  |
| `invalid_enum`     | is not one of the allowed values; the message lists them.                                              |
| `unrecognized_key` | is not a field of this request; remove it.                                                             |
| `invalid`          | breaks another rule the message explains, for example a range whose end is before its start.           |

More rules may be added: treat an unknown `rule` like `invalid` and show the message. Some field
errors raised after validation (an unknown event type, a URL the policy refuses) have no `rule`.

| Code                                      | Status  | Meaning                                                                                  |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `BAD_REQUEST`                             | 400     | Malformed request, for example a body that is not JSON.                                  |
| `VALIDATION_FAILED`                       | 400     | Invalid fields, headers or parameters (`details`).                                       |
| `UNAUTHENTICATED`, `TOKEN_EXPIRED`        | 401     | Missing, invalid or expired credentials.                                                 |
| `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED` | 401/403 | Login failed or the account is disabled.                                                 |
| `INVALID_CURRENT_PASSWORD`                | 400     | A password change gave the wrong current password.                                       |
| `FORBIDDEN`                               | 403     | Authenticated but missing the permission.                                                |
| `NOT_FOUND`                               | 404     | Missing, or belongs to another tenant.                                                   |
| `CONFLICT`                                | 409     | State conflict, for example a duplicate.                                                 |
| `IDEMPOTENCY_CONFLICT`                    | 409     | The Idempotency-Key was used with a different request.                                   |
| `PAYLOAD_TOO_LARGE`                       | 413     | Body or message payload over its limit; for a payload `details[0].maximum` is the limit. |
| `UNKNOWN_EVENT_TYPE`                      | 422     | The event type does not exist or is archived.                                            |
| `PAYLOAD_INVALID`                         | 422     | The payload does not match the event type schema (`details` name up to 10 fields).       |
| `RATE_LIMITED`                            | 429     | Too many requests; wait `Retry-After` seconds.                                           |
| `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`   | 500/503 | Failure on our side; nothing internal is leaked. Retry with backoff.                     |

## Limits

Defaults, with the allowed range for values a deployment can change. Request limits are defined in
`packages/contracts` and checked by the API and the console alike.

| Limit                                 | Value                                                                                    | Where it is set                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idempotency-Key                       | 8 to 100 characters: letters, digits and `- _ : .`                                       | `IDEMPOTENCY_KEY_MIN_LENGTH`, `IDEMPOTENCY_KEY_MAX_LENGTH`, `packages/contracts/src/idempotency.ts`                                                      |
| Idempotency-Key retention             | 24 hours (60 s to 30 days)                                                               | `IDEMPOTENCY_RETENTION_SECONDS`, `apps/ingest-service/src/config.ts`                                                                                     |
| Message payload                       | 256 KiB (262144 bytes) of JSON (1024 to 1000000 bytes)                                   | `MAX_MESSAGE_PAYLOAD_BYTES`, `apps/ingest-service/src/config.ts`                                                                                         |
| JSON request body                     | 1 MB                                                                                     | `JSON_BODY_LIMIT`, `packages/service-kit/src/bootstrap.ts`                                                                                               |
| Request body at the local gateway     | 10 MB                                                                                    | `client_max_body_size`, `infra/docker/gateway/nginx.conf`                                                                                                |
| Payload the dispatcher sends          | 1000000 bytes (1024 to 1000000)                                                          | `DELIVERY_MAX_PAYLOAD_BYTES`, `apps/dispatcher/src/config.ts`                                                                                            |
| Application and API key name          | 1 to 100 characters                                                                      | `MAX_NAME_LENGTH`, `packages/contracts/src/resource-fields.ts`                                                                                           |
| Description                           | at most 500 characters                                                                   | `MAX_DESCRIPTION_LENGTH`, `packages/contracts/src/resource-fields.ts`                                                                                    |
| Event type name                       | 1 to 128 of `a-z 0-9 . _ -`, starting with a letter or digit; `solmira.` is reserved     | `EVENT_TYPE_NAME_PATTERN`, `packages/contracts/src/applications.ts`                                                                                      |
| Event type JSON Schema                | 64 KiB of JSON                                                                           | `MAX_EVENT_TYPE_SCHEMA_BYTES`, `packages/contracts/src/applications.ts`                                                                                  |
| Payload schema errors reported        | the first 10                                                                             | `apps/ingest-service/src/event-types/payload-validator.ts`                                                                                               |
| Endpoint URL                          | at most 2048 characters; https and public addresses only in production                   | `MAX_ENDPOINT_URL_LENGTH`, `packages/contracts/src/endpoints.ts`; [ADR-0028](../adr/0028-endpoint-url-policy.md)                                         |
| Custom headers per endpoint           | at most 10                                                                               | `MAX_CUSTOM_HEADERS`, `packages/contracts/src/endpoints.ts`                                                                                              |
| Custom header name                    | 1 to 64 lowercase letters, digits and dashes; reserved names are refused                 | `packages/contracts/src/endpoints.ts`                                                                                                                    |
| Custom header value                   | at most 1024 characters, no control characters                                           | `MAX_CUSTOM_HEADER_VALUE_LENGTH`, `packages/contracts/src/endpoints.ts`                                                                                  |
| Event type subscriptions per endpoint | at most 100                                                                              | `MAX_SUBSCRIPTIONS`, `packages/contracts/src/endpoints.ts`                                                                                               |
| Endpoint rate limit                   | optional, 1 to 1000 deliveries per second                                                | `MAX_ENDPOINT_RATE_LIMIT_PER_SECOND`, `packages/contracts/src/endpoints.ts`                                                                              |
| Secret rotation window                | 24 hours (1 to 168)                                                                      | `DEFAULT_ROTATION_WINDOW_HOURS`, `MAX_ROTATION_WINDOW_HOURS`, `packages/contracts/src/endpoints.ts`                                                      |
| Page size                             | 25 by default, at most 100; `page` at most 10000                                         | `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`, `packages/contracts/src/pagination.ts`                                                                             |
| Bulk replay                           | at most 5000 deliveries per call                                                         | `MAX_BULK_REPLAY`, `packages/contracts/src/replay.ts`                                                                                                    |
| Analytics range                       | 24 hours by default, at most 31 days                                                     | `DEFAULT_ANALYTICS_RANGE_HOURS`, `MAX_ANALYTICS_RANGE_DAYS`, `packages/contracts/src/analytics.ts`                                                       |
| Organization name and slug            | name 2 to 100 characters; slug 1 to 48 of `a-z 0-9 -`                                    | `packages/contracts/src/organizations.ts`                                                                                                                |
| Password                              | 12 to 128 characters                                                                     | `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `packages/contracts/src/auth.ts`                                                                           |
| Email and full name                   | at most 254 and 120 characters                                                           | `packages/contracts/src/auth.ts`                                                                                                                         |
| Ingestion rate                        | 600 requests per minute per API key (1 to 100000)                                        | `INGEST_RATE_LIMIT_PER_MINUTE`, `apps/ingest-service/src/config.ts`                                                                                      |
| Failed sign-ins                       | 5, then locked for 15 minutes                                                            | `LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_SECONDS`, `apps/identity-service/src/config.ts`                                                                     |
| Password reset emails                 | 3 per hour                                                                               | `RESET_REQUESTS_PER_HOUR`, `apps/identity-service/src/auth/account-recovery.service.ts`                                                                  |
| Requests per IP, local gateway        | 30 per second (burst 60); sign-in, registration and reset 10 per minute (burst 5)        | `infra/docker/gateway/nginx.conf`, `infra/docker/gateway/templates/solmira.conf.template`                                                                |
| Requests per IP, AWS                  | 30000 per 5 minutes; sign-in, registration and reset 300 per 5 minutes                   | `waf_rate_limit_per_5_minutes`, `waf_auth_rate_limit_per_5_minutes`, `infra/terraform/variables.tf`                                                      |
| Realtime feed                         | 50 connections per organization; send the `auth` frame within 5 s                        | `REALTIME_MAX_CONNECTIONS_PER_ORGANIZATION`, `apps/notification-service/src/config.ts`; `REALTIME_AUTH_TIMEOUT_MS`, `packages/contracts/src/realtime.ts` |
| Delivery timeouts                     | connect 5 s, whole request 30 s                                                          | `DELIVERY_CONNECT_TIMEOUT_MS`, `DELIVERY_TIMEOUT_MS`, `apps/dispatcher/src/config.ts`                                                                    |
| Retry schedule                        | 8 attempts: immediately, then after 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h, each ±20 % | `RETRY_SCHEDULE_SECONDS`, `RETRY_JITTER_RATIO`, `apps/dispatcher/src/config.ts`                                                                          |
| Endpoint auto-disable                 | after 120 hours of continuous failure                                                    | `AUTO_DISABLE_AFTER_HOURS`, `apps/dispatcher/src/config.ts`                                                                                              |
| Stored response body per attempt      | the first 4096 bytes (0 to 65536)                                                        | `DELIVERY_RESPONSE_BODY_LIMIT_BYTES`, `apps/dispatcher/src/config.ts`                                                                                    |
| Attempt history retention             | 30 days                                                                                  | `ATTEMPT_RETENTION_DAYS`, `apps/dispatcher/src/config.ts`                                                                                                |
| Access token lifetime                 | 15 minutes (60 s to 1 h)                                                                 | `ACCESS_TOKEN_TTL_SECONDS`, `apps/identity-service/src/config.ts`                                                                                        |

## identity-service (built)

Authentication (`/auth`): `POST /auth/register`, `/auth/login`, `/auth/refresh` (cookie),
`/auth/logout`, `/auth/switch-organization`, `/auth/verify-email`, `/auth/forgot-password`,
`/auth/reset-password`; `GET /auth/.well-known/jwks.json`; sessions: `GET /auth/sessions`,
`DELETE /auth/sessions/{sessionId}`.

Account: `GET|PATCH /me`, `POST /me/password`, `POST /invitations/accept`, `GET /roles`,
`GET /permissions`.

| Endpoint            | Body                               | Answer and rules                                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /me`         | `{ fullName }` (1-120, trimmed)    | `200` with the same body as `GET /me`. Any access token, no organization or permission needed. The email cannot be changed here.                                                                                                                                                   |
| `POST /me/password` | `{ currentPassword, newPassword }` | `204`. Any access token. `newPassword` follows the registration policy and must differ from the current one (`400 VALIDATION_FAILED`). A wrong current password is `400 INVALID_CURRENT_PASSWORD` and counts towards the login lockout (`429`). Every other session is signed out. |

Organizations: `POST /organizations`, `GET /organizations`, `GET|PATCH /organizations/{id}`;
members: `GET /organizations/{id}/members`, `GET|PATCH|DELETE /organizations/{id}/members/{memberId}`;
invitations: `GET|POST /organizations/{id}/invitations`,
`DELETE /organizations/{id}/invitations/{invitationId}`.

Behavior and rules: [authentication](../architecture/authentication.md) and
[authorization](../architecture/authorization.md).

## ingest-service

### Management (built, Phase 4)

JWT, permission-checked, scoped to the organization in the token. Resources are archived or revoked,
never hard deleted ([ADR-0025](../adr/0025-webhook-resource-model.md)). List endpoints take
`includeArchived` (`includeRevoked` for API keys).

| Resource     | Endpoints                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applications | `POST                                                                                                                                                                                    | GET /applications`, `GET                                                                         | PATCH /applications/{app}`, `POST /applications/{app}/archive`, `/restore`                                  |
| Event types  | `POST                                                                                                                                                                                    | GET /event-types`, `GET                                                                          | PATCH /event-types/{id}`, `POST /event-types/{id}/archive` (shared by all applications of the organization) |
| Endpoints    | `POST                                                                                                                                                                                    | GET /applications/{app}/endpoints`, `GET                                                         | PATCH                                                                                                       | DELETE /applications/{app}/endpoints/{id}` (`DELETE` archives) |
| Secrets      | The signing secret is returned once by `POST .../endpoints`. `POST .../endpoints/{id}/secret/reveal` returns it again, needs `endpoint_secrets.reveal` (owner and admin) and is audited. |
| API keys     | `POST                                                                                                                                                                                    | GET /applications/{app}/api-keys`(the key is returned once),`DELETE .../api-keys/{id}` (revokes) |

Endpoint URLs are validated against the [URL policy](../adr/0028-endpoint-url-policy.md): https in
production, no credentials, no private, loopback, link-local, multicast or reserved addresses (IPv4
and IPv6), and the host must resolve to public addresses only. Custom headers cannot override
`host`, `content-*`, `webhook-*` and similar. An endpoint with no subscribed event types receives
all of them.

### Ingestion (built, Phase 5)

```
POST /api/v1/applications/{app}/messages
Authorization: Bearer <API key>
Idempotency-Key: <unique per message, 8-100 characters>

{ "eventType": "invoice.paid", "payload": { "id": "inv_1", "amount": 5 } }
```

The key needs the `messages:write` scope and must belong to `{app}`. The response is `202` with the
message (`id`, `applicationId`, `eventType`, `createdAt`). Delivery to endpoints happens afterwards.

| Case                                                                          | Answer                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Missing, malformed, revoked, expired or unknown key (or archived application) | `401 UNAUTHENTICATED`                                  |
| Key without the `messages:write` scope                                        | `403 FORBIDDEN`                                        |
| Key of another application or organization                                    | `404 NOT_FOUND`                                        |
| More than 600 requests per minute per key (configurable)                      | `429 RATE_LIMITED` with `Retry-After`                  |
| Missing or malformed `Idempotency-Key`, or a malformed body                   | `400 VALIDATION_FAILED`                                |
| Event type unknown or archived                                                | `422 UNKNOWN_EVENT_TYPE`                               |
| Payload over 256 KiB (configurable)                                           | `413 PAYLOAD_TOO_LARGE`                                |
| Payload fails the event type's JSON Schema                                    | `422 PAYLOAD_INVALID`                                  |
| Same key and request again within 24 hours (configurable)                     | `200` with the original message; nothing new is stored |
| Same key with a different event type or payload                               | `409 IDEMPOTENCY_CONFLICT`                             |

A rejected request does not consume its Idempotency-Key, so it can be corrected and sent again with
the same key. JSON Schema formats such as `email` and `date-time` are checked.

### Replay and secret rotation (built, Phase 7)

| Call                                                                            | Needs                     | Effect                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /applications/{app}/messages/{id}/replay` with `{ "endpointId"? }`        | `deliveries.replay`       | Sends the message again to its endpoints as a new retry cycle (finished deliveries only).                                                                          |
| `POST /applications/{app}/endpoints/{id}/replay` with `{ from, to, limit? }`    | `deliveries.replay`       | Replays the endpoint's failed deliveries for messages created in `[from, to)`, at most `limit` (default and maximum 5000) per call; `more: true` means call again. |
| `POST /applications/{app}/endpoints/{id}/secret/rotate` with `{ windowHours? }` | `endpoint_secrets.rotate` | The current secret keeps signing for `windowHours` (default 24) next to the new one, which is returned once.                                                       |

Both replay calls answer `{ replayed, more }` and are idempotent: deliveries that are already waiting
are not touched. A disabled endpoint must be enabled first (`409`); enabling an endpoint resets its
failure history. Replayed requests carry the same `webhook-id` as the first delivery.

### Notifications (built, Phase 7)

`GET /notifications` (`unreadOnly`, pagination) and `POST /notifications/{id}/read` on
notification-service. An endpoint that fails continuously for five days (configurable) is disabled and
the organization gets one notification.

### Inspection and test send (built, Phase 8)

| Call                                                                   | Needs              | Effect                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /applications/{app}/messages` (`eventType`, `from`, `to`, paging) | `messages.read`    | Messages, newest first, each with delivery counts by status.                                                                                                |
| `GET /applications/{app}/messages/{id}`                                | `messages.read`    | The payload, every delivery, and the attempt timeline from the history store. `attemptsAvailable: false` means the history is unreachable; state is intact. |
| `GET /applications/{app}/endpoints/{id}/deliveries` (`status`, paging) | `messages.read`    | An endpoint's deliveries, newest first, filterable by status.                                                                                               |
| `POST /applications/{app}/endpoints/{id}/test`                         | `endpoints.update` | Sends a `solmira.test` event to this endpoint only. Answers `{ messageId, deliveryId }`.                                                                    |

The `solmira.` event-type prefix is reserved for the platform (ADR-0034). Stored response bodies in
the timeline are truncated at the dispatcher's limit and marked `responseBodyTruncated`.

## notification-service: realtime delivery feed (built, Phase 9)

`GET /ws/v1/deliveries` upgrades to a WebSocket (ADR-0035). The client sends one frame within five
seconds, `{ "type": "auth", "token": "<access token>" }`, and the server answers
`{ "type": "ready", "organizationId": "..." }`. From then on it receives only events of the organization
in the token, as `{ "type", "occurredAt", "data" }`:

| `type`                   | `data`                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `message.created`        | `messageId`, `applicationId`                                                                                                                                                                           |
| `delivery.attempted`     | `deliveryId`, `messageId`, `endpointId`, `applicationId`, `eventType`, `attempt`, `result` (`succeeded`, `retrying`, `failed`), `statusCode`, `errorClass`, `durationMs`, `startedAt`, `nextAttemptAt` |
| `endpoint.auto_disabled` | `endpointId`, `applicationId`, `host`                                                                                                                                                                  |

Needs `messages.read`. The feed is live only: events that happened while a client was away are not
replayed, so reload from the REST API after reconnecting. Close codes: `4400` protocol error (the first
frame was not an auth frame, or a client sent anything after it), `4401` token invalid, revoked, expired
or not sent in time (also sent when the token expires while connected; reconnect with a fresh one),
`4403` no organization selected or no `messages.read`, `1013` too many connections for the organization
(50 by default) or the client could not keep up.

## analytics-service (built, Phase 9)

| Call                                               | Needs            | Effect                                                                                                   |
| -------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /analytics/applications` (`from`, `to`)       | `analytics.read` | One row per application with figures for the range.                                                      |
| `GET /analytics/applications/{app}` (`from`, `to`) | `analytics.read` | The same figures for the application as a whole (`summary`) and for each of its endpoints (`endpoints`). |

The range defaults to the last 24 hours and may span at most 31 days (`from` inclusive, `to` exclusive).
Each row has `attempts` (real sends; a refusal that sent nothing is not one), `successfulAttempts`,
`successRate` (successful over attempts), `deliveries` (distinct deliveries with an attempt in the range),
`attemptsPerDelivery` and `latencyMs` with `p50`, `p95` and `p99` (milliseconds, linearly interpolated
over the duration of every attempt). With no attempts the rates and percentiles are `null`, not zero.

## audit-service (built, Phase 10)

| Call                                                                                    | Needs             | Effect                                                              |
| --------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------- |
| `GET /audit-logs` (`action`, `actorId`, `targetType`, `targetId`, `from`, `to`, paging) | `audit_logs.read` | The organization's administrative actions, newest first (ADR-0036). |

Each record has `id`, `action` (an event type such as `endpoint_secret.revealed`), `actorType` (`user` or
`system`), `actorId` (null for the platform), `targetType` (`organization`, `member`, `invitation`,
`application`, `api_key`, `event_type`, `endpoint` or `message`), `targetId`, `occurredAt`,
`correlationId` and `details` (ids and field names from the event, never secrets). Records cannot be
changed or removed through the API or by the runtime database role.

Audited actions: organization created and updated; members invited, joined, role changed, status
changed and removed; invitations revoked; applications created, updated, archived and restored; API keys
created and revoked; event types created, updated and archived; endpoints created, updated, archived,
tested and automatically disabled; endpoint secrets revealed and rotated; deliveries replayed. Sign-ins
and the delivery data plane are not part of the trail.

## What a receiver gets (built, Phase 6)

To verify what you receive use [`@solmira/webhooks`](../../packages/webhooks/README.md): it has the
reference vector, examples for `node:http`, Next.js and Express, and the verification recipe for other
languages.

An HTTP `POST` with the message payload as the body and the
[Standard Webhooks](https://www.standardwebhooks.com/) headers:

| Header              | Meaning                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `webhook-id`        | Stable per message. Deduplicate on it: delivery is at least once.                                   |
| `webhook-timestamp` | Unix seconds when the attempt was signed. Reject stale timestamps.                                  |
| `webhook-signature` | `v1,<base64 HMAC-SHA256>` over `id.timestamp.body`; several space-separated values during rotation. |

Any `2xx` response counts as success. Everything else, including timeouts, redirects (which are
not followed) and connection errors, is retried with backoff and jitter: by default immediately,
after 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours and 10 hours (eight attempts).
The request has a 5 second connect timeout and a 30 second overall timeout. The `webhook-id`
stays the same for every attempt of a message, so deduplicate on it. Verify with
[`@solmira/webhooks`](../../packages/webhooks) (`verifyWebhook`) or any Standard Webhooks library.
