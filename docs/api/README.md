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

| Code                                      | Status  | Meaning                                          |
| ----------------------------------------- | ------- | ------------------------------------------------ |
| `BAD_REQUEST`, `VALIDATION_FAILED`        | 400     | Malformed request or invalid fields (`details`). |
| `UNAUTHENTICATED`, `TOKEN_EXPIRED`        | 401     | Missing, invalid or expired credentials.         |
| `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED` | 401/403 | Login failed or the account is disabled.         |
| `FORBIDDEN`                               | 403     | Authenticated but missing the permission.        |
| `NOT_FOUND`                               | 404     | Missing, or belongs to another tenant.           |
| `CONFLICT`                                | 409     | State conflict, for example a duplicate.         |
| `PAYLOAD_TOO_LARGE`                       | 413     | Body over the size limit.                        |
| `RATE_LIMITED`                            | 429     | Too many requests.                               |
| `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`   | 500/503 | Failure on our side; nothing internal is leaked. |

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

## ingest-service (Planned)

Management endpoints (JWT, permission-checked; Phase 4):

| Resource     | Endpoints                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Applications | `POST\|GET /applications`, `GET\|PATCH\|DELETE /applications/{app}`                                     |
| API keys     | `POST\|GET /applications/{app}/api-keys` (the secret is returned once), `DELETE .../{key}` (revoke)     |
| Event types  | `POST\|GET /applications/{app}/event-types`, `PATCH .../{name}`, `POST .../{name}/archive`              |
| Endpoints    | `POST\|GET /applications/{app}/endpoints`, `GET\|PATCH\|DELETE .../{endpoint}`                          |
| Secrets      | `POST .../{endpoint}/secret/rotate`, `POST .../{endpoint}/secret/reveal` (separate, audited permission) |

Ingestion (API key; Phase 5):

```
POST /api/v1/applications/{app}/messages
Authorization: Bearer <API key>
Idempotency-Key: <unique per message>

{ "eventType": "invoice.paid", "payload": { ... } }
```

`202` returns the message id. A replay of the same `Idempotency-Key` and body within the retention
window (24 hours by default) returns the original message; a different body under the same key is
rejected with `409`. Unknown event types, payloads over the size limit, and payloads that fail the
event type's JSON Schema are rejected with distinct error codes.

Messages and deliveries (Phases 5 to 7): list and inspect messages and their attempts, replay one
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
