# ADR-0028: Endpoint URL policy and SSRF defense at creation

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Endpoint URLs are addresses chosen by tenants (and by their customers) that the platform will call
from inside its own network. This is the main SSRF risk. Validation at creation gives fast
feedback; the authoritative check is at send time (Phase 6), because DNS can change.

## Decision

A shared, pure policy in `@solmira/service-kit` (`assertSafeEndpointUrl`) rejects:

- non-`https` URLs when the service runs in production (`http` allowed otherwise);
- URLs with credentials (`user:pass@`), fragments, or longer than 2048 characters;
- literal IP hosts in private, loopback, link-local (including 169.254.169.254), carrier-grade NAT,
  documentation, benchmarking, multicast and reserved ranges for IPv4, and for IPv6 anything outside
  global unicast `2000::/3` or inside the documentation, 6to4 and IETF protocol assignments. This
  covers IPv4-mapped (`::ffff:a.b.c.d`) and NAT64 addresses by rejecting them outright. Decimal,
  octal and hexadecimal IPv4 spellings are normalized by the WHATWG URL parser before the check;
- hostnames that are single labels, `localhost` or end in `.localhost`, `.local`, `.internal`,
  `.localdomain`, `.lan` or `.home.arpa`.

At creation and on URL changes the service additionally resolves the hostname and rejects it if
any returned address is forbidden, or if it does not resolve. This catches names that point at
internal addresses, and it is advisory only: the dispatcher resolves again and pins the address
at send time (Phase 6).

For local development and chaos tests, `ALLOW_PRIVATE_ENDPOINT_TARGETS=true` disables the address
checks and allows `http`. The configuration refuses to load when it is set in production.

## Alternatives considered

- **Validate at send time only.** Rejected: tenants would learn about a bad URL minutes later.
- **Use an allow-list of domains.** Rejected: the platform cannot know its tenants' customers.
- **A third-party SSRF library.** Considered; the rule set is small, security-critical and needs
  the exact semantics above, so it is implemented with `node:net` primitives and tested
  exhaustively instead of trusting an opaque dependency.

## Consequences

An endpoint on a private network cannot be registered in production, by design. Name resolution
at creation can fail transiently; the tenant retries.

## Failure, scaling, security and operational implications

Resolution has a short timeout and a result cap. The policy has no I/O, so it is unit tested with
a table of hostile inputs (see `endpoint-url.test.ts`).
