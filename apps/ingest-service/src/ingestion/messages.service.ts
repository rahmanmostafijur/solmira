import { Inject, Injectable } from '@nestjs/common';
import type { CreateMessageRequest, Message } from '@solmira/contracts';
import { MetricsRegistry, NotFoundError, withSpan } from '@solmira/service-kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { ApiKeyPrincipal } from '../api-keys/api-key-authenticator.js';
import type { IngestConfig } from '../config.js';
import { Database, type IngestTransaction } from '../database/database.module.js';
import { applications, eventTypes, idempotencyKeys, messages } from '../database/schema.js';
import { PayloadValidator } from '../event-types/payload-validator.js';
import { INGEST_CONFIG } from '../ingest.tokens.js';
import { recordEvent } from '../outbox/outbox.js';
import { requestHash } from './canonical-json.js';
import {
  IdempotencyConflictError,
  PayloadInvalidError,
  PayloadTooLargeError,
  UnknownEventTypeError,
} from './ingestion-errors.js';

export interface IngestResult {
  readonly message: Message;
  /** True when the Idempotency-Key matched an earlier request and nothing new was stored. */
  readonly replayed: boolean;
}

/** Another request claimed the same Idempotency-Key between our check and our insert. */
class IdempotencyRaceLost extends Error {}

const MAX_RACE_RETRIES = 3;

const toMessage = (
  id: string,
  applicationId: string,
  eventType: string,
  createdAt: Date,
): Message => ({
  id,
  applicationId,
  eventType,
  createdAt: createdAt.toISOString(),
});

@Injectable()
export class MessagesService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(PayloadValidator) private readonly validator: PayloadValidator,
    @Inject(INGEST_CONFIG) private readonly config: IngestConfig,
    @Inject(MetricsRegistry) private readonly metrics: MetricsRegistry,
  ) {}

  /**
   * Stores one message with its outbox event in a single transaction (ADR-0030). Retrying with the
   * same Idempotency-Key and body returns the original message; fan-out happens afterwards, from
   * the outbox event.
   */
  async ingest(
    principal: ApiKeyPrincipal,
    applicationId: string,
    idempotencyKey: string,
    input: CreateMessageRequest,
  ): Promise<IngestResult> {
    try {
      const result = await withSpan(
        'message.ingest',
        { 'organization.id': principal.organizationId, 'application.id': applicationId },
        () => this.store(principal, applicationId, idempotencyKey, input),
      );
      this.metrics.count(result.replayed ? 'MessagesReplayed' : 'MessagesAccepted');
      return result;
    } catch (error) {
      // By the error's code (a fixed set), never by its text, so the dimension stays small.
      const reason = (error as { code?: unknown }).code;
      this.metrics.count('MessagesRejected', 1, {
        Reason: typeof reason === 'string' ? reason : 'INTERNAL',
      });
      throw error;
    }
  }

  private async store(
    principal: ApiKeyPrincipal,
    applicationId: string,
    idempotencyKey: string,
    input: CreateMessageRequest,
  ): Promise<IngestResult> {
    if (principal.applicationId !== applicationId) throw new NotFoundError('Application not found');
    const payloadBytes = Buffer.byteLength(JSON.stringify(input.payload), 'utf8');
    if (payloadBytes > this.config.MAX_MESSAGE_PAYLOAD_BYTES)
      throw new PayloadTooLargeError(this.config.MAX_MESSAGE_PAYLOAD_BYTES, payloadBytes);
    const hash = requestHash(input.eventType, input.payload);
    const scope = { organizationId: principal.organizationId, userId: null };

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.database.forTenant(scope, (tx) =>
          this.ingestInTransaction(tx, principal, idempotencyKey, hash, payloadBytes, input),
        );
      } catch (error) {
        if (!(error instanceof IdempotencyRaceLost) || attempt >= MAX_RACE_RETRIES) throw error;
        // The competing request has committed by now; the next attempt sees its record and replays.
      }
    }
  }

  private async ingestInTransaction(
    tx: IngestTransaction,
    principal: ApiKeyPrincipal,
    key: string,
    hash: string,
    payloadBytes: number,
    input: CreateMessageRequest,
  ): Promise<IngestResult> {
    const { organizationId, applicationId } = principal;
    const [application] = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.organizationId, organizationId),
          eq(applications.id, applicationId),
          isNull(applications.archivedAt),
        ),
      );
    if (!application) throw new NotFoundError('Application not found');

    const replay = await this.findLiveReplay(tx, principal, key, hash);
    if (replay) return { message: replay, replayed: true };

    const [eventType] = await tx
      .select()
      .from(eventTypes)
      .where(
        and(
          eq(eventTypes.organizationId, organizationId),
          eq(eventTypes.name, input.eventType),
          isNull(eventTypes.archivedAt),
        ),
      );
    if (!eventType) throw new UnknownEventTypeError(input.eventType);
    if (eventType.schema) {
      const issues = this.validator.validate(
        eventType.id,
        eventType.updatedAt.getTime(),
        eventType.schema as Record<string, unknown>,
        input.payload,
      );
      if (issues.length > 0) throw new PayloadInvalidError(issues);
    }

    const id = uuidv7();
    const [row] = await tx
      .insert(messages)
      .values({
        id,
        organizationId,
        applicationId,
        eventTypeId: eventType.id,
        payload: input.payload,
        payloadBytes,
        idempotencyKey: key,
      })
      .returning();

    const expiresAt = new Date(Date.now() + this.config.IDEMPOTENCY_RETENTION_SECONDS * 1000);
    // Claims the key, replacing a record that has expired; a live record means we lost a race.
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({ organizationId, applicationId, key, requestHash: hash, messageId: id, expiresAt })
      .onConflictDoUpdate({
        target: [idempotencyKeys.applicationId, idempotencyKeys.key],
        set: { requestHash: hash, messageId: id, createdAt: sql`now()`, expiresAt },
        setWhere: sql`${idempotencyKeys.expiresAt} <= now()`,
      })
      .returning({ key: idempotencyKeys.key });
    if (claimed.length === 0) throw new IdempotencyRaceLost();

    await recordEvent(tx, { organizationId, userId: null }, 'message.created', {
      messageId: id,
      applicationId,
      eventTypeId: eventType.id,
    });
    return {
      message: toMessage(row!.id, applicationId, input.eventType, row!.createdAt),
      replayed: false,
    };
  }

  /** The original message when the key was used within the retention window with the same request. */
  private async findLiveReplay(
    tx: IngestTransaction,
    principal: ApiKeyPrincipal,
    key: string,
    hash: string,
  ): Promise<Message | null> {
    const [existing] = await tx
      .select({
        requestHash: idempotencyKeys.requestHash,
        messageId: idempotencyKeys.messageId,
        createdAt: messages.createdAt,
        eventType: eventTypes.name,
      })
      .from(idempotencyKeys)
      .innerJoin(
        messages,
        and(
          eq(messages.organizationId, idempotencyKeys.organizationId),
          eq(messages.id, idempotencyKeys.messageId),
        ),
      )
      .innerJoin(
        eventTypes,
        and(
          eq(eventTypes.organizationId, messages.organizationId),
          eq(eventTypes.id, messages.eventTypeId),
        ),
      )
      .where(
        and(
          eq(idempotencyKeys.applicationId, principal.applicationId),
          eq(idempotencyKeys.key, key),
          sql`${idempotencyKeys.expiresAt} > now()`,
        ),
      );
    if (!existing) return null;
    if (existing.requestHash !== hash) throw new IdempotencyConflictError();
    return toMessage(
      existing.messageId,
      principal.applicationId,
      existing.eventType,
      existing.createdAt,
    );
  }
}
