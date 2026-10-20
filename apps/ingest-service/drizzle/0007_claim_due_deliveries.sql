-- How the dispatcher takes work (ADR-0031).
--
-- Claiming is the one cross-tenant read of the delivery path, so it is a single function with the
-- owner's rights and nothing else. It picks due deliveries, at most p_per_tenant for each
-- organization (so one tenant's backlog cannot fill a batch) starting with the organization that
-- has waited longest, skips rows another worker holds, marks them in_progress and sets a lease.
-- A delivery is due when it is pending and its time has come, or when it is in progress and its
-- lease has expired (the worker that held it is gone). attempt is the number this try will have;
-- the count only advances when the outcome is recorded, so a repeated try keeps its number.
CREATE FUNCTION claim_due_deliveries(p_limit integer, p_per_tenant integer, p_lease_seconds integer)
RETURNS TABLE (
  delivery_id uuid,
  organization_id uuid,
  endpoint_id uuid,
  message_id uuid,
  attempt integer
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH tenants AS (
    SELECT d.organization_id, min(d.next_attempt_at) AS waiting_since
      FROM deliveries d
     WHERE (d.status = 'pending' AND d.next_attempt_at <= now())
        OR (d.status = 'in_progress' AND d.locked_until < now())
     GROUP BY d.organization_id
     ORDER BY waiting_since
  ), picked AS (
    SELECT c.id
      FROM tenants t
      CROSS JOIN LATERAL (
        SELECT d.id
          FROM deliveries d
         WHERE d.organization_id = t.organization_id
           AND ((d.status = 'pending' AND d.next_attempt_at <= now())
             OR (d.status = 'in_progress' AND d.locked_until < now()))
         ORDER BY d.next_attempt_at, d.id
         LIMIT p_per_tenant
           FOR UPDATE SKIP LOCKED
      ) c
     LIMIT p_limit
  ), claimed AS (
    UPDATE deliveries d
       SET status = 'in_progress',
           locked_until = now() + make_interval(secs => p_lease_seconds),
           updated_at = now()
      FROM picked
     WHERE d.id = picked.id
    RETURNING d.id, d.organization_id, d.endpoint_id, d.message_id, d.attempt_count
  )
  SELECT id, organization_id, endpoint_id, message_id, attempt_count + 1 FROM claimed
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_due_deliveries(integer, integer, integer) FROM PUBLIC;
