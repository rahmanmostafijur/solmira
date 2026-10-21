import { Inject, Injectable } from '@nestjs/common';
import type { RevealedSecret, RotatedSecret } from '@solmira/contracts';
import {
  NotFoundError,
  secretContext,
  type SecretCipher,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { Database } from '../database/database.module.js';
import { endpointSecrets } from '../database/schema.js';
import { SECRET_CIPHER } from '../ingest.tokens.js';
import { recordEvent } from '../outbox/outbox.js';
import { generateSigningSecret } from '../secrets/signing-secret.js';
import { findEndpoint } from './endpoint-views.js';

@Injectable()
export class EndpointSecretsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
  ) {}

  /** The only way to read a secret after creation. Audited in the same transaction. */
  reveal(auth: TenantAuthContext, applicationId: string, id: string): Promise<RevealedSecret> {
    return this.database.forTenant(auth, async (tx) => {
      await findEndpoint(tx, auth, applicationId, id, { live: true });
      const [secret] = await tx
        .select()
        .from(endpointSecrets)
        .where(
          and(
            eq(endpointSecrets.organizationId, auth.organizationId),
            eq(endpointSecrets.endpointId, id),
            eq(endpointSecrets.status, 'active'),
          ),
        );
      if (!secret) throw new NotFoundError('Signing secret not found');
      await recordEvent(tx, auth, 'endpoint_secret.revealed', {
        endpointId: id,
        applicationId,
        secretId: secret.id,
      });
      return { secret: this.cipher.decrypt(secret, secretContext(auth.organizationId, id)) };
    });
  }

  /**
   * Makes the active secret the previous one, valid for `windowHours`, and creates a new active
   * secret (returned once). Any older previous secret expires now, so at most two secrets are valid
   * and the dispatcher signs with both until the window closes (ADR-0033).
   */
  rotate(
    auth: TenantAuthContext,
    applicationId: string,
    id: string,
    windowHours: number,
  ): Promise<RotatedSecret> {
    const newSecret = generateSigningSecret();
    return this.database.forTenant(auth, async (tx) => {
      await findEndpoint(tx, auth, applicationId, id, { live: true });
      const validUntil = new Date(Date.now() + windowHours * 3_600_000);
      await tx
        .update(endpointSecrets)
        .set({ expiresAt: new Date() })
        .where(
          and(
            eq(endpointSecrets.organizationId, auth.organizationId),
            eq(endpointSecrets.endpointId, id),
            eq(endpointSecrets.status, 'previous'),
          ),
        );
      const [previous] = await tx
        .update(endpointSecrets)
        .set({ status: 'previous', expiresAt: validUntil })
        .where(
          and(
            eq(endpointSecrets.organizationId, auth.organizationId),
            eq(endpointSecrets.endpointId, id),
            eq(endpointSecrets.status, 'active'),
          ),
        )
        .returning({ id: endpointSecrets.id });
      if (!previous) throw new NotFoundError('Signing secret not found');
      await tx.insert(endpointSecrets).values({
        id: uuidv7(),
        organizationId: auth.organizationId,
        endpointId: id,
        status: 'active',
        ...this.cipher.encrypt(newSecret, secretContext(auth.organizationId, id)),
      });
      await recordEvent(tx, auth, 'endpoint_secret.rotated', {
        endpointId: id,
        applicationId,
        previousSecretId: previous.id,
        previousValidUntil: validUntil.toISOString(),
      });
      return { secret: newSecret, previousValidUntil: validUntil.toISOString() };
    });
  }
}
