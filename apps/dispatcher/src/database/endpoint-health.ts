import type pg from 'pg';

export interface HealthPolicy {
  /** Consecutive failures that open the circuit. */
  readonly circuitFailureThreshold: number;
  readonly circuitCooldownBaseSeconds: number;
  readonly circuitCooldownMaxSeconds: number;
  /** An endpoint that has failed continuously for this long is disabled. */
  readonly autoDisableAfterHours: number;
}

type Queryable = Pick<pg.PoolClient, 'query'>;

/** A success ends the failure streak and closes the circuit (ADR-0033). */
export async function recordEndpointSuccess(db: Queryable, endpointId: string): Promise<void> {
  await db.query(
    `update endpoints
        set consecutive_failures = 0, first_failure_at = null, circuit_open_until = null, circuit_trips = 0
      where id = $1 and (consecutive_failures > 0 or circuit_trips > 0 or circuit_open_until is not null)`,
    [endpointId],
  );
}

/**
 * Counts a failure with atomic expressions, so concurrent attempts to one endpoint cannot lose an
 * update. The failure that reaches the threshold (or a failed probe after a cool-down) opens the
 * circuit for a doubling cool-down. When the streak has lasted long enough the endpoint is disabled
 * by a statement guarded on `enabled`: one worker wins, and only that one writes the event, so the
 * tenant is told exactly once.
 */
export async function recordEndpointFailure(
  db: Queryable,
  endpointId: string,
  policy: HealthPolicy,
): Promise<void> {
  const { rows } = await db.query<{
    url: string;
    application_id: string;
    organization_id: string;
    consecutive_failures: number;
    first_failure_at: Date;
  }>(
    `update endpoints
        set consecutive_failures = consecutive_failures + 1,
            first_failure_at = coalesce(first_failure_at, now()),
            circuit_trips = case
              when consecutive_failures + 1 >= $2 and (circuit_open_until is null or circuit_open_until <= now())
              then circuit_trips + 1 else circuit_trips end,
            circuit_open_until = case
              when consecutive_failures + 1 >= $2 and (circuit_open_until is null or circuit_open_until <= now())
              then now() + make_interval(secs => least($4::double precision, $3::double precision * power(2, circuit_trips)))
              else circuit_open_until end
      where id = $1
  returning url, application_id, organization_id, consecutive_failures, first_failure_at`,
    [
      endpointId,
      policy.circuitFailureThreshold,
      policy.circuitCooldownBaseSeconds,
      policy.circuitCooldownMaxSeconds,
    ],
  );
  const endpoint = rows[0];
  if (!endpoint) return;

  const disabled = await db.query(
    `update endpoints
        set enabled = false, disabled_reason = 'auto_failures', disabled_at = now(), updated_at = now()
      where id = $1 and enabled and first_failure_at <= now() - make_interval(hours => $2)`,
    [endpointId, policy.autoDisableAfterHours],
  );
  if ((disabled.rowCount ?? 0) === 0) return;

  await db.query(
    `insert into outbox_events (id, type, version, occurred_at, organization_id, actor_id, correlation_id, payload)
     values (uuidv7(), 'endpoint.auto_disabled', 1, now(), $1, null, 'dispatcher', $2::jsonb)`,
    [
      endpoint.organization_id,
      JSON.stringify({
        endpointId,
        applicationId: endpoint.application_id,
        host: hostOf(endpoint.url),
        failingSince: endpoint.first_failure_at.toISOString(),
        consecutiveFailures: endpoint.consecutive_failures,
      }),
    ],
  );
}

/** Only the host: URLs can carry tokens that must not travel in events. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}
