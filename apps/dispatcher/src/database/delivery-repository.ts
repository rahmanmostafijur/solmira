import type { EncryptedSecret } from '@solmira/service-kit';
import type pg from 'pg';

export interface ClaimedDelivery {
  readonly deliveryId: string;
  readonly organizationId: string;
  readonly endpointId: string;
  readonly messageId: string;
  /** The number this try will have: recorded attempts plus one. */
  readonly attempt: number;
}

export interface StoredSecret extends EncryptedSecret {
  readonly status: 'active' | 'previous';
}

/** Everything needed to send one delivery, loaded inside the delivery's tenant. */
export interface DeliveryContext {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly enabled: boolean;
  readonly archived: boolean;
  readonly payload: unknown;
  readonly secrets: readonly StoredSecret[];
}

export type Outcome =
  | { readonly kind: 'succeeded'; readonly statusCode: number }
  | {
      readonly kind: 'retry';
      readonly at: Date;
      readonly statusCode: number | null;
      readonly errorClass: string;
    }
  | {
      readonly kind: 'failed';
      readonly statusCode: number | null;
      readonly errorClass: string;
    };

type Queryable = Pick<pg.PoolClient, 'query'>;

interface ClaimRow {
  delivery_id: string;
  organization_id: string;
  endpoint_id: string;
  message_id: string;
  attempt: number;
}

interface ContextRow {
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  archived_at: Date | null;
  payload: unknown;
  secret_status: 'active' | 'previous' | null;
  ciphertext: Buffer | null;
  wrapped_data_key: Buffer | null;
  key_id: string | null;
}

/**
 * The dispatcher's whole view of the database (ADR-0031): one cross-tenant call to claim work, then
 * every read and write happens inside the tenant of the delivery, so Row Level Security applies to
 * this role exactly as it does to the ingest service.
 */
export class DeliveryRepository {
  constructor(private readonly pool: pg.Pool) {}

  async claim(limit: number, perTenant: number, leaseSeconds: number): Promise<ClaimedDelivery[]> {
    const { rows } = await this.pool.query<ClaimRow>(
      'select * from claim_due_deliveries($1, $2, $3)',
      [limit, perTenant, leaseSeconds],
    );
    return rows.map((row) => ({
      deliveryId: row.delivery_id,
      organizationId: row.organization_id,
      endpointId: row.endpoint_id,
      messageId: row.message_id,
      attempt: row.attempt,
    }));
  }

  /** `null` when the message or the endpoint is gone. */
  loadContext(claimed: ClaimedDelivery): Promise<DeliveryContext | null> {
    return this.inTenant(claimed.organizationId, async (db) => {
      const { rows } = await db.query<ContextRow>(
        `select e.url, e.headers, e.enabled, e.archived_at, m.payload,
                s.status as secret_status, s.ciphertext, s.wrapped_data_key, s.key_id
           from deliveries d
           join messages m on m.organization_id = d.organization_id and m.id = d.message_id
           join endpoints e on e.organization_id = d.organization_id and e.id = d.endpoint_id
           left join endpoint_secrets s
             on s.organization_id = e.organization_id and s.endpoint_id = e.id
            and (s.status = 'active'
                 or (s.status = 'previous' and (s.expires_at is null or s.expires_at > now())))
          where d.id = $1 and d.organization_id = $2
          order by s.status`,
        [claimed.deliveryId, claimed.organizationId],
      );
      const first = rows[0];
      if (!first) return null;
      return {
        url: first.url,
        headers: first.headers,
        enabled: first.enabled,
        archived: first.archived_at !== null,
        payload: first.payload,
        secrets: rows.flatMap((row) =>
          row.secret_status && row.ciphertext && row.wrapped_data_key && row.key_id
            ? [
                {
                  status: row.secret_status,
                  ciphertext: row.ciphertext,
                  wrappedDataKey: row.wrapped_data_key,
                  keyId: row.key_id,
                },
              ]
            : [],
        ),
      };
    });
  }

  /**
   * Records the result of attempt `claimed.attempt`. Idempotent and monotonic: a stale worker that
   * finishes after another worker already recorded this attempt (or a later one) changes nothing.
   */
  recordOutcome(claimed: ClaimedDelivery, outcome: Outcome): Promise<boolean> {
    const status =
      outcome.kind === 'succeeded' ? 'succeeded' : outcome.kind === 'retry' ? 'pending' : 'failed';
    return this.inTenant(claimed.organizationId, async (db) => {
      const result = await db.query(
        `update deliveries
            set status = $3, attempt_count = $4,
                next_attempt_at = coalesce($5, next_attempt_at),
                locked_until = null, last_attempt_at = now(),
                last_status_code = $6, last_error_class = $7,
                completed_at = case when $3 = 'pending' then null else now() end,
                updated_at = now()
          where id = $1 and organization_id = $2 and attempt_count < $4`,
        [
          claimed.deliveryId,
          claimed.organizationId,
          status,
          claimed.attempt,
          outcome.kind === 'retry' ? outcome.at : null,
          outcome.statusCode,
          outcome.kind === 'succeeded' ? null : outcome.errorClass,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  private async inTenant<T>(
    organizationId: string,
    work: (db: Queryable) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.organization_id', $1, true)`, [organizationId]);
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
