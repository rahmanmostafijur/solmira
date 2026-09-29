# ADR-0007: Nginx as the edge gateway

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The browser must see a single origin (no CORS in production) that fronts `web` and five
services. Something at the edge has to route by path prefix (`/api/v1/orders` to
operations-service, `/ws` to notification-service, `/graphql` to analytics-service, everything
else to web), assign request and correlation IDs before any service logs a line, apply coarse
rate limits (login brute force, scraping), set security headers once, and return errors in the
same JSON envelope the services use even when the upstream never answered.

The question is what runs there, and whether the edge authenticates requests.

## Decision

Run **Nginx** (`infra/docker/gateway`) as a thin reverse proxy with no business logic.

- **Routing** by `location` prefix per the table in ARCHITECTURE.md section 4; WebSocket upgrade
  headers for `/ws`.
- **IDs:** `X-Request-Id` is always generated at the edge (`$request_id`) and overwrites any
  client value; `X-Correlation-Id` is propagated if present and valid, otherwise set to the
  request ID. Both go upstream and back in the response.
- **Edge rate limiting** with `limit_req_zone` keyed by client IP: a tight zone for
  `/api/v1/auth/login` and `/auth/refresh`, a looser general zone. Per-tenant and per-user limits
  live in the services (Redis), where identity is known.
- **Security headers:** `Strict-Transport-Security`, `Content-Security-Policy`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors 'none'`; `server_tokens off`.
- **JSON access logs** via `log_format ... escape=json` with request ID, correlation ID,
  upstream, status, upstream response time, so edge and service logs join on the same IDs.
- **Custom JSON error bodies** via `error_page` for 429, 502, 503, 504, e.g.
  `{ "error": { "code": "RATE_LIMITED", "message": "...", "requestId": "<id>" } }`, so the web
  client handles one envelope whether the error came from Nginx or a service.
- **Authentication is not done at the gateway.** Each service verifies the asymmetric JWT locally
  with identity-service's public key (ADR-0002 guards). No `auth_request` subrequest.

In AWS, CloudFront and the ALB sit in front; the ALB can take over path routing, and Nginx
remains the place for IDs, headers and error shaping (revisited in phase 12).

## Alternatives considered

- **A NestJS gateway service (BFF).** Full TypeScript control, but it is another service on every
  request's critical path, with Node's per-request overhead, and it tempts teams to put
  aggregation and business rules at the edge. Nginx does the required job in configuration.
- **AWS API Gateway.** Managed throttling, usage plans and JWT authorizers. Rejected as the
  primary gateway because it cannot run in local Docker with parity, WebSocket support is a
  separate API type with a different model from Socket.IO, and per-request pricing and 29-second
  integration timeouts are awkward for the console. It stays an option for a public partner API.
- **Envoy / Traefik / Kong.** Capable, but more moving parts (xDS, plugins, databases for Kong)
  than a five-route proxy needs.
- **Gateway `auth_request` to identity-service.** Centralizes auth but makes identity a
  synchronous dependency of every request and, worse, lets services trust anything that arrives
  from inside the network.

## Tradeoffs

- **Zero trust over network position:** every service verifies tokens itself, so a request that
  bypasses the gateway (misrouted internal call, compromised sibling container) is still
  rejected. Cost: each service needs the public key and key rotation (JWKS with `kid`) must reach
  all of them.
- Nginx config is less testable than code; covered by a smoke test in CI that asserts routing,
  headers and JSON 502 bodies against the compose stack.
- IP-keyed limits are coarse behind NAT; accepted because fine-grained limits live in services.

## Consequences

**Positive**

- One origin, one header policy, one ID scheme, one error envelope at the edge.
- The gateway is stateless and trivial to scale or replace.
- No auth single point of failure at the edge.

**Negative**

- Duplicate concerns (rate limiting at edge and in service) must be kept coherent.
- Adding a new route prefix is a gateway change and a deploy.

## Failure, scaling, security and operational implications

- **Failure:** an unhealthy upstream yields a JSON 502/503/504 with a request ID; other prefixes
  keep working. Upstream timeouts are set per route (longer for `/graphql`, long-lived for `/ws`).
- **Scaling:** horizontally scalable; no shared state except per-instance rate-limit zones,
  which is acceptable for coarse edge limits.
- **Security:** client-supplied `X-Request-Id` is never trusted; `X-Forwarded-*` headers are
  overwritten, not appended from client input.
- **Operational:** edge JSON logs ship to the same pipeline as service logs; a support ticket's
  request ID finds the edge line and every service line for that call.
