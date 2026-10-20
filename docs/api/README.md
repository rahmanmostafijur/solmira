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
| Ingestion auth | **Planned (Phase 5):** `Authorization: Bearer <API key>`. A key belongs to one application.                                                 |
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

Account: `GET /me`, `POST /invitations/accept`, `GET /roles`, `GET /permissions`.

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

Messages and deliveries (Phases 5 to 7, Planned): list and inspect messages and their attempts, replay one
message, and replay all failed messages of an endpoint within a time range.

## What a receiver gets (Planned, Phase 6)

An HTTP `POST` with the message payload as the body and the
[Standard Webhooks](https://www.standardwebhooks.com/) headers:

| Header              | Meaning                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `webhook-id`        | Stable per message. Deduplicate on it: delivery is at least once.                                   |
| `webhook-timestamp` | Unix seconds when the attempt was signed. Reject stale timestamps.                                  |
| `webhook-signature` | `v1,<base64 HMAC-SHA256>` over `id.timestamp.body`; several space-separated values during rotation. |

Any `2xx` response counts as success. Everything else, including timeouts, is retried with backoff.
