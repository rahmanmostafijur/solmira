-- How many deliveries are due and how long the oldest has waited (ADR-0039). The dispatcher reports
-- these as its main health signal. They are counts across all organizations, so the function reads
-- rows the dispatcher's role may not see one by one; it returns two numbers and nothing else.
CREATE FUNCTION delivery_backlog()
RETURNS TABLE (due bigint, oldest_due_seconds double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT count(*), COALESCE(EXTRACT(EPOCH FROM (now() - min(next_attempt_at))), 0)::double precision
    FROM deliveries
   WHERE (status = 'pending' AND next_attempt_at <= now())
      OR (status = 'in_progress' AND locked_until < now())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION delivery_backlog() FROM PUBLIC;
