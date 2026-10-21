-- Claiming with endpoint isolation (ADR-0033), replacing the version from migration 0007.
--
-- A worker slot spent on a dead endpoint is a slot another endpoint did not get, so deliveries to an
-- endpoint that is saturated or whose circuit is open are never claimed. Per endpoint at most
-- p_per_endpoint claims are held at any time (counted across all workers from unexpired leases); an
-- endpoint that has tripped its breaker and has not succeeded since carries one probe at a time.
-- Per organization at most p_per_tenant deliveries are taken per call, longest-waiting organization
-- first. The scan per organization is bounded and starts after the unavailable endpoints are
-- excluded, so a stalled endpoint's backlog cannot hide its healthy neighbours.
--
-- Concurrent calls can each count the same running claims, so across workers the endpoint cap is
-- approximate (at most workers times the cap); within one call it is exact.
DROP FUNCTION claim_due_deliveries(integer, integer, integer);
--> statement-breakpoint
CREATE FUNCTION claim_due_deliveries(
  p_limit integer, p_per_tenant integer, p_per_endpoint integer, p_lease_seconds integer
)
RETURNS TABLE (
  delivery_id uuid,
  organization_id uuid,
  endpoint_id uuid,
  message_id uuid,
  attempt integer,
  cycle_base integer
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH running AS (
    SELECT d.endpoint_id, count(*)::integer AS held
      FROM deliveries d
     WHERE d.status = 'in_progress' AND d.locked_until >= now()
     GROUP BY d.endpoint_id
  ), tenants AS (
    SELECT d.organization_id, min(d.next_attempt_at) AS waiting_since
      FROM deliveries d
     WHERE (d.status = 'pending' AND d.next_attempt_at <= now())
        OR (d.status = 'in_progress' AND d.locked_until < now())
     GROUP BY d.organization_id
     ORDER BY waiting_since
     LIMIT p_limit
  ), picked AS (
    SELECT c.id
      FROM tenants t
      CROSS JOIN LATERAL (
        SELECT s.id
          FROM (
            SELECT f.id, f.next_attempt_at, f.room,
                   row_number() OVER (PARTITION BY f.endpoint_id ORDER BY f.next_attempt_at, f.id)
                     AS endpoint_rank
              FROM (
                SELECT d.id, d.endpoint_id, d.next_attempt_at,
                       (CASE WHEN e.circuit_trips > 0 THEN 1 ELSE p_per_endpoint END)
                         - COALESCE(r.held, 0) AS room
                  FROM deliveries d
                  JOIN endpoints e ON e.organization_id = d.organization_id AND e.id = d.endpoint_id
                  LEFT JOIN running r ON r.endpoint_id = d.endpoint_id
                 WHERE d.organization_id = t.organization_id
                   AND ((d.status = 'pending' AND d.next_attempt_at <= now())
                     OR (d.status = 'in_progress' AND d.locked_until < now()))
                   AND (e.circuit_open_until IS NULL OR e.circuit_open_until <= now())
                   AND COALESCE(r.held, 0)
                       < (CASE WHEN e.circuit_trips > 0 THEN 1 ELSE p_per_endpoint END)
                 ORDER BY d.next_attempt_at, d.id
                 LIMIT p_per_tenant * 20
              ) f
          ) s
         WHERE s.endpoint_rank <= s.room
         ORDER BY s.next_attempt_at, s.id
         LIMIT p_per_tenant
      ) c
     LIMIT p_limit
  ), locked AS (
    SELECT d.id
      FROM deliveries d
     WHERE d.id IN (SELECT id FROM picked)
       AND ((d.status = 'pending' AND d.next_attempt_at <= now())
         OR (d.status = 'in_progress' AND d.locked_until < now()))
     ORDER BY d.id
       FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE deliveries d
       SET status = 'in_progress',
           locked_until = now() + make_interval(secs => p_lease_seconds),
           updated_at = now()
      FROM locked
     WHERE d.id = locked.id
    RETURNING d.id, d.organization_id, d.endpoint_id, d.message_id, d.attempt_count, d.cycle_base
  )
  SELECT id, organization_id, endpoint_id, message_id, attempt_count + 1, cycle_base FROM claimed
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_due_deliveries(integer, integer, integer, integer) FROM PUBLIC;
