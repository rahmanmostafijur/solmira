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

### Errors

Every error uses one envelope:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "Enter a valid email address" }],
    "requestId": "0192f000-0000-7000-8000-000000000000"
  }
}
```

| Code                                      | Status  | Meaning                                                                       |
| ----------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `BAD_REQUEST`, `VALIDATION_FAILED`        | 400     | Malformed request or invalid fields (`details`).                              |
| `UNAUTHENTICATED`, `TOKEN_EXPIRED`        | 401     | Missing, invalid or expired credentials.                                      |
| `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED` | 401/403 | Login failed or the account is disabled.                                      |
| `INVALID_CURRENT_PASSWORD`                | 400     | A password change gave the wrong current password.                            |
| `FORBIDDEN`                               | 403     | Authenticated but missing the permission.                                     |
| `NOT_FOUND`                               | 404     | Missing, or belongs to another tenant.                                        |
| `CONFLICT`                                | 409     | State conflict, for example a duplicate.                                      |
| `PAYLOAD_TOO_LARGE`                       | 413     | Body over the size limit.                                                     |
| `UNKNOWN_EVENT_TYPE`                      | 422     | The event type does not exist or is archived.                                 |
| `PAYLOAD_INVALID`                         | 422     | The payload does not match the event type schema (`details` name the fields). |
| `IDEMPOTENCY_CONFLICT`                    | 409     | The Idempotency-Key was used with a different request.                        |
| `RATE_LIMITED`                            | 429     | Too many requests.                                                            |
| `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`   | 500/503 | Failure on our side; nothing internal is leaked.                              |

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
