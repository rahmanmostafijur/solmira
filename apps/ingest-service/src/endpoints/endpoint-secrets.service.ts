import { Inject, Injectable } from '@nestjs/common';
import type { RevealedSecret } from '@solmira/contracts';
import { NotFoundError, type TenantAuthContext } from '@solmira/service-kit';
import { and, eq } from 'drizzle-orm';
import { Database } from '../database/database.module.js';
import { endpointSecrets } from '../database/schema.js';
import { SECRET_CIPHER } from '../ingest.tokens.js';
import { recordEvent } from '../outbox/outbox.js';
import type { SecretCipher } from '../secrets/secret-cipher.js';
import { findEndpoint } from './endpoint-views.js';
import { secretContext } from '../secrets/secret-context.js';

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
}
