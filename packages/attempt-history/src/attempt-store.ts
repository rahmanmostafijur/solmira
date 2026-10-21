import {
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const GSI = 'gsi1';

/** What the dispatcher knows about one HTTP attempt (ADR-0032). */
export interface AttemptRecord {
  readonly organizationId: string;
  readonly messageId: string;
  readonly endpointId: string;
  readonly deliveryId: string;
  /** 1-based number of this attempt for the delivery. */
  readonly attempt: number;
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly statusCode: number | null;
  readonly errorClass: string | null;
  /** At most a few KiB of the response; never request headers, signatures, secrets or payloads. */
  readonly responseBody: string | null;
  readonly responseBodyTruncated: boolean;
  /** When the next attempt is scheduled, or null after a success or the last attempt. */
  readonly nextAttemptAt: Date | null;
}

export interface StoredAttempt extends Omit<AttemptRecord, 'startedAt' | 'nextAttemptAt'> {
  readonly startedAt: string;
  readonly nextAttemptAt: string | null;
}

const pad = (attempt: number) => String(attempt).padStart(4, '0');
const messageKey = (organizationId: string, messageId: string) =>
  'TENANT#' + organizationId + '#MESSAGE#' + messageId;
const endpointKey = (organizationId: string, endpointId: string) =>
  'TENANT#' + organizationId + '#ENDPOINT#' + endpointId;

/**
 * Attempt history (ADR-0032). Every key starts with the tenant and every method takes the
 * organization as an argument, so there is no way to read or write without one.
 */
export class AttemptStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
    private readonly retentionDays: number,
  ) {}

  /** Idempotent: the key holds the attempt number, so a repeated attempt overwrites its item. */
  async record(attempt: AttemptRecord): Promise<void> {
    const startedAt = attempt.startedAt.toISOString();
    await this.client.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          pk: messageKey(attempt.organizationId, attempt.messageId),
          sk: 'ENDPOINT#' + attempt.endpointId + '#ATTEMPT#' + pad(attempt.attempt),
          gsi1pk: endpointKey(attempt.organizationId, attempt.endpointId),
          gsi1sk: startedAt + '#' + attempt.deliveryId + '#' + pad(attempt.attempt),
          organizationId: attempt.organizationId,
          messageId: attempt.messageId,
          endpointId: attempt.endpointId,
          deliveryId: attempt.deliveryId,
          attempt: attempt.attempt,
          startedAt,
          durationMs: attempt.durationMs,
          statusCode: attempt.statusCode,
          errorClass: attempt.errorClass,
          responseBody: attempt.responseBody,
          responseBodyTruncated: attempt.responseBodyTruncated,
          nextAttemptAt: attempt.nextAttemptAt?.toISOString() ?? null,
          expiresAt: Math.floor(attempt.startedAt.getTime() / 1000) + this.retentionDays * 86_400,
        },
      }),
    );
  }

  /** Every attempt to every endpoint for one message, oldest endpoint first. */
  listForMessage(organizationId: string, messageId: string): Promise<StoredAttempt[]> {
    return this.query({
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': messageKey(organizationId, messageId) },
    });
  }

  /** The attempts of one delivery (one message to one endpoint), in order. */
  listForDelivery(organizationId: string, messageId: string, endpointId: string) {
    return this.query({
      KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': messageKey(organizationId, messageId),
        ':prefix': 'ENDPOINT#' + endpointId + '#ATTEMPT#',
      },
    });
  }

  /** The newest attempts to an endpoint, newest first. */
  listForEndpoint(
    organizationId: string,
    endpointId: string,
    limit = 100,
  ): Promise<StoredAttempt[]> {
    return this.query({
      IndexName: GSI,
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': endpointKey(organizationId, endpointId) },
      ScanIndexForward: false,
      Limit: limit,
    });
  }

  private async query(
    input: Omit<ConstructorParameters<typeof QueryCommand>[0], 'TableName'>,
  ): Promise<StoredAttempt[]> {
    const result = await this.client.send(new QueryCommand({ TableName: this.table, ...input }));
    return (result.Items ?? []) as StoredAttempt[];
  }
}

/** Throws unless the table exists and answers: the readiness check of anything that uses the history. */
export async function assertAttemptTable(client: DynamoDBClient, table: string): Promise<void> {
  await client.send(new DescribeTableCommand({ TableName: table }));
}

/** Creates the table and its TTL for development and tests; in AWS Terraform owns the table. */
export async function ensureAttemptTable(client: DynamoDBClient, table: string): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: table }));
    return;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  }
  await client.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
        { AttributeName: 'gsi1pk', AttributeType: 'S' },
        { AttributeName: 'gsi1sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: GSI,
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: table,
      TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiresAt' },
    }),
  );
}
