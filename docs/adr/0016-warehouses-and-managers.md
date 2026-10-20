# ADR-0016: Warehouses, and managers who must belong to the same organization

- **Status:** Superseded by ADR-0023
- **Date:** 2026-09-30

## Context

Warehouses arrive in Phase 3 so that inventory (phase 4) has somewhere to live. A warehouse has a
short code printed on labels and pick lists, an address, and an optional manager: a person in the
organization. The manager is the first catalog field that refers to data owned by another
service. Members live in identity-service's database (ADR-0005: one database per service), so
operations cannot declare a foreign key to them, and it must not trust a member id sent by the
client ("Do not trust client supplied organization IDs"; the same applies to any id).

The requirement is that the manager belongs to the same organization, enforced both in the
application and in the database.

## Decision

- **Codes unique per organization.** `warehouses_org_code_key UNIQUE (organization_id, code)`,
  canonical form upper-case `[A-Z0-9][A-Z0-9-]{1,19}` (`warehouseCodeSchema`, plus
  `warehouses_code_check`). Two organizations can both have `WH-DHK`.
- **Deactivate, never delete.** Warehouses are `ACTIVE` or `INACTIVE`; stock movements will
  reference them.
- **Application check through identity, with the caller's own token.** When a request sets
  `managerMemberId`, operations calls identity-service
  `GET /organizations/{org}/members/{memberId}`, forwarding the caller's bearer token (token
  relay). Identity applies its own authorization and RLS: a member of another organization is
  simply not found. Operations requires the member to exist and be `active`; otherwise the
  request fails with a `400` on `managerMemberId`. The lookup has a 3-second timeout; identity
  being down is a `503`, never a silent acceptance.
- **Database check through a local directory.** The verified member is upserted into
  `member_directory (organization_id, member_id, full_name, email)` in the same transaction as the
  warehouse write, and `warehouses_manager_fk` is a composite foreign key
  `(organization_id, manager_member_id) → member_directory (organization_id, member_id)`
  `ON DELETE SET NULL (manager_member_id)`. The database therefore refuses a manager id that was
  never verified for this organization, and a cross-tenant id cannot satisfy the key.
- **Permissions.** Assigning a manager needs `warehouses.create` or `warehouses.update` in
  operations, and the relayed token needs `users.read` in identity, which managers, admins and
  owners have. The web console hides the picker for roles without `users.read`.
- **Display** comes from `member_directory` (joined into warehouse responses), so listing
  warehouses never calls identity.

## Alternatives considered

- **Trust the id from the client.** Anyone could assign a person from another tenant, or a
  made-up id. Rejected.
- **A service account for operations → identity calls.** Needs a new, powerful credential that
  can read every tenant's members. Token relay keeps the caller's own rights and tenant, and needs
  no new secret. Rejected for now; system-initiated calls (for example event consumers) will
  need a scoped service identity in a later phase.
- **Replicate members into operations through events.** The eventual design once the event
  backbone exists (phase 7): `member.joined`, `member.status_changed` and `member.removed` will
  keep `member_directory` current. Today the directory is written on verification only.
- **Store only the member id, no foreign key.** The database could not enforce the same-tenant
  rule. Rejected, because the requirement is database-level enforcement.
- **A foreign key across databases.** Not possible with a database per service.

## Tradeoffs

- The manager's name and email in `member_directory` are a snapshot taken at assignment time;
  they can go stale until member events update them (phase 7). A suspended or removed member
  stays assigned until then.
- Assigning a manager couples the request to identity's availability.

## Consequences

**Positive**

- A warehouse can only name a manager who was an active member of the same organization at the
  time of assignment, checked by identity and guaranteed by a composite foreign key.
- No new service credential exists.

**Negative**

- Background processes cannot use token relay; they will need their own path.
- `member_directory` is a second copy of member data that must be maintained.

## Failure, scaling, security and operational implications

- **Failure:** member not found or not active → `400`; identity says `403` → `403`; timeout or
  other errors → `503`. The warehouse is not written in any of these cases.
- **Scaling:** one identity call per manager change, none on reads.
- **Security:** proven by integration tests for a suspended member and a member of another
  organization, and by database tests that the composite key rejects an unverified or foreign
  member even for the owner role.
- **Operational:** `IDENTITY_INTERNAL_URL` must point at identity inside the network
  (`http://identity-service:4001` in Compose); the call does not go through the public gateway.
